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
 *
 * ## Idempotency and Turn Version Design
 *
 * Every action submission (`POST /api/games/:id/actions`) must include:
 *   - `action_id`             – a client-generated UUID used as an idempotency key.
 *   - `expected_turn_version` – the turn version the client believes is current.
 *
 * ### Idempotency
 * Before processing a new action the handler looks up `action_id` in the
 * `action_requests` table.  If a matching row already exists **for the same
 * game**, the current game state is returned immediately with `idempotent:true`
 * and no move is applied again.  This makes retried network requests safe.
 *
 * To guard against race conditions (two concurrent requests with the same
 * `action_id`), the handler attempts to insert the `action_requests` row
 * **before** applying the move.  If the insert fails due to a unique-constraint
 * violation (another concurrent request already inserted the row), the handler
 * treats the request as a duplicate and returns the idempotent response.
 *
 * ### Turn Version
 * After the idempotency check, `expected_turn_version` is compared with the
 * game's current `turn_version`.  A mismatch means the client's view of the
 * game is stale (e.g., the AI already moved), and the server returns HTTP 409
 * with `error:"stale_turn_version"` and the actual `current_turn_version` so
 * the client can re-sync.
 *
 * ### Game Status Guard
 * Actions are only accepted when the game is in `human_turn` status.
 * Submitting an action while the game is in `ai_thinking` or `finished` state
 * returns HTTP 409 with `error:"not_your_turn"` or `error:"game_finished"`
 * respectively, preventing duplicate or out-of-order submissions.
 */
import "./env.js";
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
import { sseSubscribe, sseUnsubscribe } from "./sse.js";
import { processAiTurn } from "./worker.js";

const SESSION_COOKIE = "bg_session_id";
const SUPPORTED_BOARD_SIZES = new Set([9, 19]);

function normalizeBoardSize(value) {
  return SUPPORTED_BOARD_SIZES.has(value) ? value : 9;
}

// ---------------------------------------------------------------------------
// Idempotency helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a database error is a unique-constraint violation.
 *
 * SQLite surfaces unique constraint failures with the message text
 * "UNIQUE constraint failed".  This helper lets the action handler
 * distinguish a race-condition duplicate insert from other unexpected errors.
 *
 * @param {unknown} err  The caught error value.
 * @returns {boolean}
 */
function isUniqueConstraintError(err) {
  if (!(err instanceof Error)) return false;
  const msg = err.message ?? "";
  // SQLite: "UNIQUE constraint failed: action_requests.action_id"
  // PostgreSQL: 'duplicate key value violates unique constraint "..."'
  return (
    msg.includes("UNIQUE constraint failed") ||
    msg.includes("unique constraint") ||
    msg.includes("duplicate key value")
  );
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
      const boardSize = normalizeBoardSize(req.body?.board_size);

      let gameRecord = null;
      let isNew = false;

      if (!forceNew) {
        gameRecord = await data.getActiveGameBySessionId(req.session.id);
        if (gameRecord && gameRecord.board_size !== boardSize) {
          gameRecord = null;
        }
      }

      if (!gameRecord) {
        gameRecord = await createGame({
          sessionId: req.session.id,
          boardSize,
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
  //
  // Processing order:
  //   1. Validate request ownership (session).
  //   2. Validate required fields (action_id, action, expected_turn_version).
  //   3. Idempotency check – return early if action_id already processed.
  //   4. Game status guard – reject if game is not in human_turn.
  //   5. Turn version check – reject if expected_turn_version is stale.
  //   6. Attempt to record the action_request row (race-condition guard).
  //   7. Apply the move and update action_request status.

  app.post("/api/games/:id/actions", async (req, res, next) => {
    try {
      // ── 1. Ownership check ──────────────────────────────────────────────
      const gameRecord = await data.getGameById(req.params.id);
      if (!gameRecord || gameRecord.session_id !== req.session.id) {
        return res.status(404).json({ error: "not_found" });
      }

      // ── 2. Required field validation ────────────────────────────────────
      const actionId =
        typeof req.body?.action_id === "string" ? req.body.action_id.trim() : null;
      if (!actionId) {
        return res.status(400).json({ error: "missing_action_id" });
      }

      const action =
        typeof req.body?.action === "string" ? req.body.action.toLowerCase() : null;
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

      // ── 3. Idempotency check ────────────────────────────────────────────
      //
      // Look up the action_id in action_requests.  If a row already exists
      // for this game, the client is retrying a previously submitted (or
      // in-flight) action – return the current game state without re-applying
      // the move.
      //
      // The game_id check ensures that a client cannot reuse an action_id
      // from a different game to get a spurious idempotent response.
      const existing = await data.findActionRequestByActionId(actionId);
      if (existing) {
        if (existing.game_id !== req.params.id) {
          // action_id was used for a different game – treat as a new, distinct
          // request and let it proceed through normal validation below.
          // (The unique constraint on action_id will prevent insertion, so we
          // return a conflict error to signal the client should generate a
          // fresh action_id.)
          return res.status(409).json({ error: "action_id_conflict" });
        }
        // Same game: idempotent response.
        const gamePayload = await getGameForApi(req.params.id);
        return res.status(200).json({ game: gamePayload, idempotent: true });
      }

      // ── 4. Turn version check ───────────────────────────────────────────
      //
      // The client must supply the turn_version it last observed.  If the
      // server's current turn_version differs, the client's view is stale
      // (e.g., the AI has already moved since the client last polled).
      // Return 409 with the current version so the client can re-sync.
      //
      // This check runs before the game status guard so that a client with a
      // stale turn_version receives the most actionable error: "re-sync first".
      // Once the client has the correct turn_version it will also learn the
      // current game status (e.g., ai_thinking) and can react accordingly.
      if (gameRecord.turn_version !== expectedTurnVersion) {
        return res.status(409).json({
          error: "stale_turn_version",
          current_turn_version: gameRecord.turn_version,
        });
      }

      // ── 5. Game status guard ────────────────────────────────────────────
      //
      // Actions are only accepted when it is the human player's turn.
      // Submitting during ai_thinking or after the game is finished is
      // rejected with a descriptive error so the client can update its UI.
      // This check runs after the turn version check so that stale clients
      // always get the more actionable stale_turn_version error first.
      if (gameRecord.status === "finished") {
        return res.status(409).json({ error: "game_finished" });
      }
      if (gameRecord.status !== "human_turn") {
        // Covers ai_thinking and any other non-human-turn states.
        return res.status(409).json({ error: "not_your_turn" });
      }

      // ── 6. Record action_request (race-condition guard) ─────────────────
      //
      // Insert the action_requests row before applying the move.  If two
      // concurrent requests arrive with the same action_id, only one will
      // succeed; the other will hit the unique constraint and be treated as
      // an idempotent duplicate.
      try {
        await data.recordActionRequest({
          game_id: req.params.id,
          action_id: actionId,
          expected_turn_version: expectedTurnVersion,
          status: "processing",
          error_code: null,
        });
      } catch (insertErr) {
        if (isUniqueConstraintError(insertErr)) {
          // A concurrent request already inserted this action_id.
          // Return the current game state as an idempotent response.
          const gamePayload = await getGameForApi(req.params.id);
          return res.status(200).json({ game: gamePayload, idempotent: true });
        }
        throw insertErr;
      }

      await data.updateGame(req.params.id, { pending_action: actionId });

      // ── 7. Apply move ───────────────────────────────────────────────────
      const game = await getGame(req.params.id);
      if (!game) {
        return res.status(404).json({ error: "not_found" });
      }

      const result = await applyMove(game, { player: "human", action, x, y });

      if (!result.ok) {
        await data.updateActionRequest(actionId, {
          status: "failed",
          error_code: result.reason,
        });
        await data.updateGame(req.params.id, { pending_action: null });
        return res.status(400).json({ error: result.reason });
      }

      await data.updateActionRequest(actionId, { status: "completed" });

      const gamePayload = await getGameForApi(req.params.id);
      res.status(200).json({ game: gamePayload, idempotent: false });

      // Trigger the AI turn asynchronously after the response is sent.
      // Pass the injected data module so tests can use their in-memory DB.
      if (gamePayload.status === "ai_thinking") {
        setImmediate(() => processAiTurn(req.params.id, data));
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
