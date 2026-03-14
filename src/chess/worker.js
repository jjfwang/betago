import "../env.js";
import * as defaultData from "../data.js";
import { ssePublish } from "../sse.js";
import { aiLog } from "../ai/logger.js";
import { listLegalMoves } from "./engine.js";
import { applyChessMove, getChessGame, getChessGameForApi, setChessDataModule } from "./service.js";
import { selectChessAIMove } from "./ai_client.js";

let data = defaultData;

export function setChessWorkerDataModule(module) {
  data = module;
  setChessDataModule(module);
}

const AI_TURN_TIMEOUT_MS = Number.parseInt(process.env.AI_TURN_TIMEOUT_MS ?? "30000", 10);
const MAX_AI_RETRIES = Number.parseInt(process.env.MAX_AI_RETRIES ?? "2", 10);

function selectFallbackChessMove(legalMoves, errorCode) {
  const rankedMoves = [...legalMoves].sort((a, b) => {
    const captureDelta = Number(Boolean(b.capturedPiece)) - Number(Boolean(a.capturedPiece));
    if (captureDelta !== 0) {
      return captureDelta;
    }

    const centerDistance = (move) => {
      const file = move.to.charCodeAt(0) - "a".charCodeAt(0);
      const rank = Number.parseInt(move.to[1], 10) - 1;
      return Math.abs(file - 3.5) + Math.abs(rank - 3.5);
    };

    const distanceDelta = centerDistance(a) - centerDistance(b);
    if (distanceDelta !== 0) {
      return distanceDelta;
    }

    return a.uci.localeCompare(b.uci);
  });

  const move = rankedMoves[0];
  if (!move) {
    return {
      action: "resign",
      rationale: `Fallback move after AI failure (${errorCode ?? "unknown_error"}): resigning because no legal moves remain.`,
    };
  }

  return {
    action: "move",
    move: move.uci,
    rationale: `Fallback move after AI failure (${errorCode ?? "unknown_error"}): choosing a safe legal move.`,
  };
}

export async function processChessAiTurn(gameId, dataOverride) {
  const d = dataOverride ?? data;
  const lockAcquired = await d.acquireChessAiTurnLock(gameId, AI_TURN_TIMEOUT_MS);
  if (!lockAcquired) {
    return;
  }

  const startMs = Date.now();

  try {
    const game = await getChessGame(gameId);
    if (!game || game.status !== "ai_thinking") {
      return;
    }

    await d.updateChessGame(gameId, { ai_status: "thinking" });

    const legalMoves = listLegalMoves(game.state, "black");
    let aiMove = null;
    let lastError = null;
    let success = false;
    let retryCount = 0;
    let fallbackUsed = false;

    for (let i = 0; i <= MAX_AI_RETRIES; i += 1) {
      retryCount = i;
      try {
        await d.updateChessGame(gameId, { ai_status: i === 0 ? "thinking" : "retrying" });
        const moveAttempt = await selectChessAIMove(
          game,
          legalMoves,
        );
        aiMove = moveAttempt;

        const result =
          moveAttempt.action === "resign"
            ? await applyChessMove(game, {
                player: "ai",
                action: "resign",
                rationale: moveAttempt.rationale ?? null,
              })
            : await applyChessMove(game, {
                player: "ai",
                action: "move",
                uci: moveAttempt.move,
                rationale: moveAttempt.rationale ?? null,
              });

        if (result.ok) {
          success = true;
          break;
        }

        lastError = result.reason;
      } catch (error) {
        lastError = error.message;
      }
    }

    if (!success) {
      const fallbackMove = selectFallbackChessMove(legalMoves, lastError);
      const result =
        fallbackMove.action === "resign"
          ? await applyChessMove(game, {
              player: "ai",
              action: "resign",
              rationale: fallbackMove.rationale,
            })
          : await applyChessMove(game, {
              player: "ai",
              action: "move",
              uci: fallbackMove.move,
              rationale: fallbackMove.rationale,
            });

      if (result.ok) {
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
      } else {
        lastError = result.reason;
      }
    }

    const latencyMs = Date.now() - startMs;
    await d.logChessAITurn({
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

    if (!success) {
      await d.updateChessGame(gameId, { ai_status: "error" });
    }
  } catch (error) {
    aiLog("chess.worker.process.unhandled_error", { game_id: gameId, error: error.message });
    try {
      await d.updateChessGame(gameId, { ai_status: "error" });
    } catch {}
  } finally {
    await d.releaseChessAiTurnLock(gameId);
    const payload = await getChessGameForApi(gameId);
    if (payload) {
      ssePublish(gameId, payload);
    }
  }
}
