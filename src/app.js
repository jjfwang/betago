/**
 * @fileoverview Express app factory for BetaGo.
 *
 * This module exports a `createApp` factory function that wires up all routes
 * and middleware.  Separating the app construction from the server startup
 * (`app.listen`) allows the same app to be imported in integration tests
 * without binding to a real port.
 *
 * The factory accepts an optional `deps` object for dependency injection,
 * which is used in tests to swap in an in-memory database.
 */
import express from "express";
import cookieParser from "cookie-parser";
import {
  createGame,
  getGame,
  getGameForApi,
  applyMove,
  normalizeAiLevel,
  setDataModule,
} from "./game/service.js";
import * as defaultData from "./data.js";
import { selectAIMove } from "./ai/client.js";
import { listLegalPlacements } from "./game/rules.js";

const SESSION_COOKIE = "bg_session_id";

// ---------------------------------------------------------------------------
// SSE subscriber registry (module-level so it persists across requests)
// ---------------------------------------------------------------------------

/**
 * Map of gameId -> Set of SSE response objects.
 * @type {Map<string, Set<import('express').Response>>}
 */
const sseSubscribers = new Map();

function sseSubscribe(gameId, res) {
  if (!sseSubscribers.has(gameId)) {
    sseSubscribers.set(gameId, new Set());
  }
  sseSubscribers.get(gameId).add(res);
}

function sseUnsubscribe(gameId, res) {
  sseSubscribers.get(gameId)?.delete(res);
}

/**
 * Publish a game state update to all SSE subscribers for a game.
 * @param {string} gameId
 * @param {object} gamePayload
 */
export function ssePublish(gameId, gamePayload) {
  const subscribers = sseSubscribers.get(gameId);
  if (!subscribers || subscribers.size === 0) return;
  const payload = `data: ${JSON.stringify(gamePayload)}\n\n`;
  for (const res of subscribers) {
    try {
      res.write(`event: game\n${payload}`);
    } catch {
      subscribers.delete(res);
    }
  }
}

// ---------------------------------------------------------------------------
// AI background worker
// ---------------------------------------------------------------------------

/**
 * Run the AI turn for a game asynchronously.
 * @param {string} gameId
 * @param {object} data  Data module (injected for testing).
 */
async function runAiTurn(gameId, data) {
  try {
    await data.updateGame(gameId, { ai_status: "thinking" });

    const game = await getGame(gameId);
    if (!game) return;
    if (game.status !== "ai_thinking") return;

    const legalPlacements = listLegalPlacements({
      board: game.board,
      color: "W",
      positionHistory: game.positionHistory,
    });

    let aiMove;
    try {
      aiMove = await selectAIMove(game, legalPlacements);
    } catch {
      await data.updateGame(gameId, { ai_status: "error" });
      const errorPayload = await getGameForApi(gameId);
      if (errorPayload) ssePublish(gameId, errorPayload);
      return;
    }

    try {
      await data.logAITurn({
        game_id: gameId,
        move_index: game.moves.length,
        model: aiMove.model ?? null,
        prompt_version: null,
        response_id: aiMove.responseId ?? null,
        retry_count: 0,
        fallback_used: aiMove.source !== "external" && aiMove.source !== "katago",
        latency_ms: null,
        external_error: aiMove.externalError ?? null,
        status: "ok",
        error_code: null,
      });
    } catch {
      // Non-critical.
    }

    const result = await applyMove(game, {
      player: "ai",
      action: aiMove.action,
      x: aiMove.x,
      y: aiMove.y,
      rationale: aiMove.rationale ?? null,
    });

    if (!result.ok) {
      await data.updateGame(gameId, { ai_status: "error" });
    }

    const updatedPayload = await getGameForApi(gameId);
    if (updatedPayload) ssePublish(gameId, updatedPayload);
  } catch {
    try {
      await data.updateGame(gameId, { ai_status: "error" });
      const errorPayload = await getGameForApi(gameId);
      if (errorPayload) ssePublish(gameId, errorPayload);
    } catch {
      // Nothing more we can do.
    }
  }
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

/**
 * Create and configure the Express application.
 *
 * @param {{ data?: object }} [deps={}]  Optional dependency overrides.
 *   - `data`: Data module to use instead of the default `./data.js`.
 *             Useful in tests to inject an in-memory database.
 * @returns {import('express').Application}
 */
export function createApp({ data = defaultData } = {}) {
  // Inject the data module into the game service so that service functions
  // (createGame, getGame, applyMove, etc.) use the same database as the
  // route handlers.  This is especially important in tests where an
  // in-memory SQLite database is injected.
  setDataModule(data);

  const app = express();

  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  /** Ensure every request has a session cookie and a session row in the DB. */
  app.use(async (req, res, next) => {
    try {
      const existing = req.cookies?.[SESSION_COOKIE];
      const session = await data.ensureSession(existing);
      if (!existing || existing !== session.id) {
        res.cookie(SESSION_COOKIE, session.id, {
          httpOnly: true,
          sameSite: "lax",
        });
      }
      req.session = session;
      next();
    } catch (err) {
      next(err);
    }
  });

  // ── Health check ──────────────────────────────────────────────────────────

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: new Date().toISOString() });
  });

  // ── POST /api/games ───────────────────────────────────────────────────────

  app.post("/api/games", async (req, res, next) => {
    try {
      const forceNew = req.body?.force_new === true;
      const aiLevel = normalizeAiLevel(req.body?.ai_level);

      let gameRecord = null;
      let isNew = false;

      if (!forceNew) {
        gameRecord = await data.getActiveGameBySessionId(req.session.id);
      }

      if (!gameRecord) {
        gameRecord = await createGame({
          sessionId: req.session.id,
          boardSize: 9,
          komi: 5.5,
          aiLevel,
        });
        isNew = true;
      }

      const gamePayload = await getGameForApi(gameRecord.id);
      res.status(isNew ? 201 : 200).json({ game: gamePayload });
    } catch (err) {
      next(err);
    }
  });

  // ── GET /api/games/:id ────────────────────────────────────────────────────

  app.get("/api/games/:id", async (req, res, next) => {
    try {
      const gameRecord = await data.getGameById(req.params.id);
      if (!gameRecord || gameRecord.session_id !== req.session.id) {
        return res.status(404).json({ error: "not_found" });
      }
      const gamePayload = await getGameForApi(req.params.id);
      res.json({ game: gamePayload });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /api/games/:id/actions ───────────────────────────────────────────

  app.post("/api/games/:id/actions", async (req, res, next) => {
    try {
      const gameRecord = await data.getGameById(req.params.id);
      if (!gameRecord || gameRecord.session_id !== req.session.id) {
        return res.status(404).json({ error: "not_found" });
      }

      const actionId = typeof req.body?.action_id === "string" ? req.body.action_id.trim() : null;
      if (!actionId) {
        return res.status(400).json({ error: "missing_action_id" });
      }

      const action = typeof req.body?.action === "string" ? req.body.action.toLowerCase() : null;
      if (!["place", "pass", "resign"].includes(action)) {
        return res.status(400).json({ error: "invalid_action" });
      }

      const expectedTurnVersion = req.body?.expected_turn_version;
      if (!Number.isInteger(expectedTurnVersion)) {
        return res.status(400).json({ error: "missing_expected_turn_version" });
      }

      const x = req.body?.x;
      const y = req.body?.y;
      if (action === "place" && (!Number.isInteger(x) || !Number.isInteger(y))) {
        return res.status(400).json({ error: "invalid_coordinate" });
      }

      // Idempotency check.
      const existing = await data.findActionRequestByActionId(actionId);
      if (existing) {
        const gamePayload = await getGameForApi(req.params.id);
        return res.status(200).json({ game: gamePayload, idempotent: true });
      }

      // Stale turn version check.
      if (gameRecord.turn_version !== expectedTurnVersion) {
        return res.status(409).json({
          error: "stale_turn_version",
          current_turn_version: gameRecord.turn_version,
        });
      }

      // Record the action request.
      await data.recordActionRequest({
        game_id: req.params.id,
        action_id: actionId,
        expected_turn_version: expectedTurnVersion,
        status: "processing",
        error_code: null,
      });

      await data.updateGame(req.params.id, { pending_action: actionId });

      const game = await getGame(req.params.id);
      if (!game) {
        return res.status(404).json({ error: "not_found" });
      }

      const result = await applyMove(game, { player: "human", action, x, y });

      if (!result.ok) {
        await data.updateActionRequest(actionId, { status: "failed", error_code: result.reason });
        await data.updateGame(req.params.id, { pending_action: null });
        return res.status(400).json({ error: result.reason });
      }

      await data.updateActionRequest(actionId, { status: "completed" });

      const gamePayload = await getGameForApi(req.params.id);
      res.status(200).json({ game: gamePayload, idempotent: false });

      if (gamePayload.status === "ai_thinking") {
        setImmediate(() => runAiTurn(req.params.id, data));
      }
    } catch (err) {
      next(err);
    }
  });

  // ── GET /api/games/:id/events (SSE) ───────────────────────────────────────

  app.get("/api/games/:id/events", async (req, res, next) => {
    try {
      const gameRecord = await data.getGameById(req.params.id);
      if (!gameRecord || gameRecord.session_id !== req.session.id) {
        return res.status(404).json({ error: "not_found" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const gamePayload = await getGameForApi(req.params.id);
      res.write(`event: game\ndata: ${JSON.stringify(gamePayload)}\n\n`);

      sseSubscribe(req.params.id, res);

      const pingInterval = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          clearInterval(pingInterval);
        }
      }, 25_000);

      req.on("close", () => {
        clearInterval(pingInterval);
        sseUnsubscribe(req.params.id, res);
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Static files & SPA fallback ───────────────────────────────────────────

  app.use(express.static("public"));
  app.get("*", (_req, res) => {
    res.sendFile("index.html", { root: "public" });
  });

  // ── Error handler ─────────────────────────────────────────────────────────

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error("[server] unhandled error:", err);
    res.status(500).json({ error: "internal_server_error" });
  });

  return app;
}
