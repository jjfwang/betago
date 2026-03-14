#!/usr/bin/env node

/**
 * @fileoverview Background worker for processing AI turns.
 *
 * This module provides the core AI turn processing logic, which can be used in
 * two modes:
 *
 * 1. **In-process mode** (default for the HTTP server): The `processAiTurn`
 *    function is exported and called directly from the HTTP request handler
 *    via `setImmediate` after a human move is accepted.
 *
 * 2. **Standalone worker mode**: When run directly (`node src/worker.js`), this
 *    module starts a polling loop that periodically scans for games in
 *    `ai_thinking` status and processes them. This is useful for deployments
 *    where the HTTP server and AI worker are separate processes.
 *
 * ## Retry Policy
 *
 * The worker attempts to select a valid AI move up to `MAX_AI_RETRIES + 1`
 * times. On each attempt, the selected move is validated by the server-side
 * rule engine. If all attempts fail, the worker applies a deterministic local
 * fallback move. The game's `ai_status` is only set to `error` if both the
 * provider and the fallback fail.
 *
 * ## Distributed Locking
 *
 * To prevent duplicate processing in multi-worker deployments, the worker
 * uses an optimistic database-level lock (`ai_turn_locked_at`,
 * `ai_turn_worker_id`) before processing each game. The lock expires after
 * `AI_TURN_TIMEOUT_MS` milliseconds to handle worker crashes.
 */

import "./env.js";
import * as defaultData from "./data.js";
import { getGame, applyMove, getGameForApi, setDataModule } from "./game/service.js";
import { ssePublish } from "./sse.js";
import { listLegalPlacements } from "./game/rules.js";
import { selectAIMove } from "./ai/client.js";
import { aiLog } from "./ai/logger.js";
import { processChessAiTurn } from "./chess/worker.js";

/**
 * The active data module.  Defaults to the real data module but can be
 * overridden in tests via `setWorkerDataModule()`.
 * @type {object}
 */
let data = defaultData;

/**
 * Override the data module used by this worker.
 * Intended for use in integration tests that inject an in-memory database.
 * @param {object} module  A data module with the same API as `../data.js`.
 */
export function setWorkerDataModule(module) {
  data = module;
  setDataModule(module);
}

/** How often the standalone worker polls for new games (milliseconds). */
const WORKER_POLL_INTERVAL_MS = Number.parseInt(
  process.env.WORKER_POLL_INTERVAL_MS ?? "2000",
  10,
);

/** How long before an AI turn lock is considered stale and can be re-acquired (milliseconds). */
const AI_TURN_TIMEOUT_MS = Number.parseInt(
  process.env.AI_TURN_TIMEOUT_MS ?? "30000",
  10,
);

/** Maximum number of retries for an invalid AI move before surfacing an error. */
const MAX_AI_RETRIES = Number.parseInt(process.env.MAX_AI_RETRIES ?? "2", 10);

function selectFallbackGoMove(game, legalPlacements, errorCode) {
  if (!Array.isArray(legalPlacements) || legalPlacements.length === 0) {
    return {
      action: "pass",
      rationale: `Fallback move after AI failure (${errorCode ?? "unknown_error"}): passing because no legal placements remain.`,
    };
  }

  const center = (game.boardSize - 1) / 2;
  const rankedMoves = [...legalPlacements].sort((a, b) => {
    const captureDelta = (b.captures ?? 0) - (a.captures ?? 0);
    if (captureDelta !== 0) {
      return captureDelta;
    }

    const distanceA = Math.abs(a.x - center) + Math.abs(a.y - center);
    const distanceB = Math.abs(b.x - center) + Math.abs(b.y - center);
    if (distanceA !== distanceB) {
      return distanceA - distanceB;
    }

    if (a.y !== b.y) {
      return a.y - b.y;
    }

    return a.x - b.x;
  });

  const move = rankedMoves[0];
  return {
    action: "place",
    x: move.x,
    y: move.y,
    rationale: `Fallback move after AI failure (${errorCode ?? "unknown_error"}): choosing a safe legal move.`,
  };
}

/**
 * Processes a single AI turn for a given game.
 *
 * This function:
 * 1. Acquires a distributed lock on the game to prevent duplicate processing.
 * 2. Loads the current game state and computes legal placements.
 * 3. Calls `selectAIMove` to get a move from the configured AI provider.
 * 4. Validates the move against the rule engine via `applyMove`.
 * 5. Retries up to `MAX_AI_RETRIES` times on invalid moves.
 * 6. Applies a deterministic fallback move if all retries fail.
 * 7. Marks the game as errored only if both retries and fallback fail.
 * 8. Logs the AI turn result and publishes an SSE event.
 *
 * @param {string} gameId The ID of the game to process.
 * @param {object} [dataOverride] Optional data module override (for testing).
 */
export async function processAiTurn(gameId, dataOverride) {
  const d = dataOverride ?? data;
  const lockAcquired = await d.acquireAiTurnLock(gameId, AI_TURN_TIMEOUT_MS);
  if (!lockAcquired) {
    aiLog("worker.skip_locked", { game_id: gameId });
    return;
  }

  aiLog("worker.process", { game_id: gameId });

  const startMs = Date.now();

  try {
    const game = await getGame(gameId);
    if (!game || game.status !== "ai_thinking") {
      // Game was already processed or cancelled; release lock and return.
      return;
    }

    await d.updateGame(gameId, { ai_status: "thinking" });

    const legalPlacements = listLegalPlacements({
      board: game.board,
      color: "W", // AI is always White
      positionHistory: game.positionHistory,
    });

    let aiMove = null;
    let lastError = null;
    let success = false;
    let retryCount = 0;
    let fallbackUsed = false;

    // ── Retry loop ──────────────────────────────────────────────────────────
    for (let i = 0; i <= MAX_AI_RETRIES; i++) {
      retryCount = i;
      try {
        await d.updateGame(gameId, { ai_status: i === 0 ? "thinking" : "retrying" });

        const moveAttempt = await selectAIMove(game, legalPlacements);
        aiMove = moveAttempt;
        const validationResult = await applyMove(game, {
          player: "ai",
          action: moveAttempt.action,
          x: moveAttempt.x,
          y: moveAttempt.y,
          rationale: moveAttempt.rationale ?? null,
        });

        if (validationResult.ok) {
          aiMove = moveAttempt;
          success = true;
          break; // Exit retry loop on success
        } else {
          lastError = validationResult.reason;
          aiLog("worker.ai_move.invalid", {
            game_id: gameId,
            reason: lastError,
            attempt: i + 1,
            action: moveAttempt.action,
            x: moveAttempt.x ?? null,
            y: moveAttempt.y ?? null,
          });
        }
      } catch (e) {
        lastError = e.message;
        aiLog("worker.ai_move.error", { game_id: gameId, error: lastError, attempt: i + 1 });
      }
    }

    if (!success) {
      aiLog("worker.ai_turn.provider_failed", {
        game_id: gameId,
        final_error: lastError,
        retry_count: retryCount,
      });

      const fallbackMove = selectFallbackGoMove(game, legalPlacements, lastError);
      const fallbackResult = await applyMove(game, {
        player: "ai",
        action: fallbackMove.action,
        x: fallbackMove.x,
        y: fallbackMove.y,
        rationale: fallbackMove.rationale,
      });

      if (fallbackResult.ok) {
        aiMove = {
          ...fallbackMove,
          source: "local-fallback",
          responseId: null,
          model: "local-fallback",
          promptVersion: "local-fallback",
          externalError: lastError,
        };
        success = true;
        fallbackUsed = true;
        aiLog("worker.ai_turn.fallback_applied", {
          game_id: gameId,
          action: fallbackMove.action,
          x: fallbackMove.x ?? null,
          y: fallbackMove.y ?? null,
          previous_error: lastError,
        });
      } else {
        lastError = fallbackResult.reason;
        aiLog("worker.ai_turn.fallback_failed", {
          game_id: gameId,
          error: lastError,
        });
      }
    }

    // ── Log AI turn ─────────────────────────────────────────────────────────
    const latencyMs = Date.now() - startMs;

    try {
      await d.logAITurn({
        game_id: gameId,
        move_index: game.moves.length,
        model: aiMove?.model ?? null,
        prompt_version: aiMove?.promptVersion ?? null,
        response_id: aiMove?.responseId ?? null,
        retry_count: retryCount,
        fallback_used: fallbackUsed,
        latency_ms: latencyMs,
        external_error: aiMove?.externalError ?? lastError ?? null,
        status: success ? "ok" : "error",
        error_code: success ? null : lastError,
      });
    } catch (logErr) {
      // Non-critical: log failure should not block the game.
      aiLog("worker.log_ai_turn.error", { game_id: gameId, error: logErr.message });
    }

    if (!success) {
      await d.updateGame(gameId, { ai_status: "error" });
    }

  } catch (error) {
    aiLog("worker.process.unhandled_error", { game_id: gameId, error: error.message });
    try {
      await d.updateGame(gameId, { ai_status: "error" });
    } catch {
      // Nothing more we can do.
    }
  } finally {
    await d.releaseAiTurnLock(gameId);
    const finalPayload = await getGameForApi(gameId);
    if (finalPayload) {
      ssePublish(gameId, finalPayload);
    }
  }
}

// ---------------------------------------------------------------------------
// Standalone worker entry point
// ---------------------------------------------------------------------------

/**
 * The main polling loop for the standalone worker.
 * Scans for games in `ai_thinking` status and processes them.
 */
async function runWorkerLoop() {
  console.log("[worker] Starting AI turn processor.");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const [goGames, chessGames] = await Promise.all([
        data.getGamesForAiProcessing(),
        data.getChessGamesForAiProcessing?.() ?? [],
      ]);

      if (goGames.length > 0) {
        aiLog("worker.poll.found_games", { count: goGames.length, variant: "go" });
        await Promise.all(goGames.map((game) => processAiTurn(game.id)));
      }

      if (chessGames.length > 0) {
        aiLog("worker.poll.found_games", { count: chessGames.length, variant: "chess" });
        await Promise.all(chessGames.map((game) => processChessAiTurn(game.id)));
      }
    } catch (error) {
      console.error("[worker] Error in main loop:", error);
    }
    await new Promise((resolve) => setTimeout(resolve, WORKER_POLL_INTERVAL_MS));
  }
}

// Only start the polling loop when this file is run directly.
const isMain = process.argv[1]?.endsWith("worker.js");
if (isMain) {
  runWorkerLoop().catch((err) => {
    console.error("[worker] Exited with fatal error:", err);
    process.exit(1);
  });
}
