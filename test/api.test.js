/**
 * @file api.test.js
 * @description Integration tests for the BetaGo HTTP API endpoints.
 *
 * Each test suite spins up an isolated in-memory SQLite database and injects
 * it into the Express app via the `createApp` factory.  No real port is bound;
 * `supertest` drives the app directly.
 *
 * Covered endpoints:
 *   GET    /api/health
 *   POST   /api/games
 *   GET    /api/games/:id
 *   POST   /api/games/:id/actions
 *   GET    /api/games/:id/events  (SSE – basic connection test)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import knex from "knex";
import supertest from "supertest";
import { createApp } from "../src/app.js";
import { setTestProvider } from "../src/ai/client.js";
import { processAiTurn } from "../src/worker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "../db/migrations");

// ---------------------------------------------------------------------------
// Test database helpers
// ---------------------------------------------------------------------------

/**
 * Build an isolated in-memory Knex instance and run all migrations.
 */
async function buildTestDb() {
  const db = knex({
    client: "sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
    migrations: { directory: MIGRATION_PATH },
  });
  await db.migrate.latest();
  return db;
}

/**
 * Build a data module backed by the given Knex instance.
 * Mirrors the real `src/data.js` API but operates on the test DB.
 */
function buildDataModule(db) {
  return {
    async createSession() {
      const id = randomUUID();
      const session = { id, created_at: new Date(), updated_at: new Date() };
      await db("sessions").insert(session);
      return session;
    },
    async ensureSession(sessionId) {
      if (sessionId) {
        const session = await db("sessions").where({ id: sessionId }).first();
        if (session) {
          await db("sessions").where({ id: sessionId }).update({ updated_at: new Date() });
          return session;
        }
      }
      const id = randomUUID();
      const session = { id, created_at: new Date(), updated_at: new Date() };
      await db("sessions").insert(session);
      return session;
    },
    async createGame(data) {
      const id = randomUUID();
      const game = { id, ...data, created_at: new Date(), updated_at: new Date() };
      await db("games").insert(game);
      return game;
    },
    async getGameById(gameId) {
      return db("games").where({ id: gameId }).first();
    },
    async getActiveGameBySessionId(sessionId) {
      return db("games")
        .where({ session_id: sessionId })
        .whereNot({ status: "finished" })
        .orderBy("created_at", "desc")
        .first();
    },
    async getLatestGameBySessionId(sessionId) {
      return db("games")
        .where({ session_id: sessionId })
        .orderBy("created_at", "desc")
        .first();
    },
    async getMovesByGameId(gameId) {
      return db("moves").where({ game_id: gameId }).orderBy("move_index");
    },
    async createMove(data) {
      const id = randomUUID();
      const move = { id, ...data, created_at: new Date() };
      await db("moves").insert(move);
      return move;
    },
    async logAITurn(data) {
      const id = randomUUID();
      const log = { id, ...data, created_at: new Date() };
      await db("ai_turn_logs").insert(log);
      return log;
    },
    async findActionRequestByActionId(actionId) {
      return db("action_requests").where({ action_id: actionId }).first();
    },
    async recordActionRequest(data) {
      const id = randomUUID();
      const request = { id, ...data, created_at: new Date() };
      await db("action_requests").insert(request);
      return request;
    },
    async updateActionRequest(actionId, data) {
      await db("action_requests").where({ action_id: actionId }).update(data);
    },
    async updateGame(gameId, data) {
      await db("games").where({ id: gameId }).update({ ...data, updated_at: new Date() });
    },
    async acquireAiTurnLock(gameId, timeoutMs) {
      const now = new Date();
      const timeout = new Date(now.getTime() - timeoutMs);
      const result = await db("games")
        .where({ id: gameId, status: "ai_thinking" })
        .andWhere(function () {
          this.whereNull("ai_turn_locked_at").orWhere("ai_turn_locked_at", "<", timeout);
        })
        .update({ ai_turn_locked_at: now, ai_turn_worker_id: "test-worker" });
      return result > 0;
    },
    async releaseAiTurnLock(gameId) {
      await db("games").where({ id: gameId }).update({
        ai_turn_locked_at: null,
        ai_turn_worker_id: null,
      });
    },
    async getGamesForAiProcessing() {
      return db("games").where({ status: "ai_thinking" }).select("id");
    },
  };
}

/**
 * Build a supertest agent backed by an isolated in-memory DB.
 * Returns `{ agent, db, data, close }` for direct DB inspection.
 * Call `close()` in the `finally` block of each test to properly tear down
 * the internal HTTP server and SQLite connection.
 */
async function buildTestAgent({
  scheduleAiTurn = () => {},
} = {}) {
  const db = await buildTestDb();
  const data = buildDataModule(db);
  const app = createApp({ data, scheduleAiTurn });
  const agent = supertest.agent(app);
  async function close() {
    // Close the internal server created by supertest.agent().
    if (agent.app && typeof agent.app.close === "function") {
      await new Promise((resolve) => agent.app.close(resolve));
    }
    await db.destroy();
  }
  return { agent, db, data, close };
}

function captureEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

test("GET /api/health returns 200 with ok:true", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const res = await agent.get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(typeof res.body.ts === "string", "ts must be a string");
  } finally {
    await close();
  }
});

test("OPTIONS preflight returns CORS headers for an allowlisted origin", async () => {
  const envSnapshot = captureEnv([
    "ENABLE_CORS",
    "CORS_ALLOWED_ORIGINS",
    "CORS_ALLOW_PRIVATE_LAN",
  ]);
  process.env.ENABLE_CORS = "true";
  process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3001";
  process.env.CORS_ALLOW_PRIVATE_LAN = "false";

  const { agent, close } = await buildTestAgent();
  try {
    const res = await agent
      .options("/api/games")
      .set("Origin", "http://localhost:3001")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Content-Type");

    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], "http://localhost:3001");
    assert.equal(res.headers["access-control-allow-credentials"], "true");
    assert.match(res.headers.vary ?? "", /Origin/);
  } finally {
    restoreEnv(envSnapshot);
    await close();
  }
});

test("OPTIONS preflight allows private LAN origins when enabled", async () => {
  const envSnapshot = captureEnv([
    "ENABLE_CORS",
    "CORS_ALLOWED_ORIGINS",
    "CORS_ALLOW_PRIVATE_LAN",
  ]);
  process.env.ENABLE_CORS = "true";
  process.env.CORS_ALLOWED_ORIGINS = "";
  process.env.CORS_ALLOW_PRIVATE_LAN = "true";

  const { agent, close } = await buildTestAgent();
  try {
    const res = await agent
      .options("/api/games")
      .set("Origin", "http://192.168.1.50:3001")
      .set("Access-Control-Request-Method", "POST");

    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], "http://192.168.1.50:3001");
  } finally {
    restoreEnv(envSnapshot);
    await close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/games
// ---------------------------------------------------------------------------

test("POST /api/games creates a new game and returns 201", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const res = await agent.post("/api/games").send({});
    assert.equal(res.status, 201);
    assert.ok(res.body.game, "response must include game");
    assert.ok(res.body.game.id, "game must have an id");
    assert.equal(res.body.game.board_size, 9, "board_size must be 9");
    assert.equal(res.body.game.status, "human_turn", "initial status must be human_turn");
    assert.equal(res.body.game.turn_version, 0, "initial turn_version must be 0");
    assert.ok(Array.isArray(res.body.game.board), "board must be an array");
    assert.ok(Array.isArray(res.body.game.legal_moves), "legal_moves must be an array");
    assert.ok(res.body.game.legal_moves.length > 0, "legal_moves must be non-empty at game start");
    assert.deepEqual(res.body.game.captures, { B: 0, W: 0 }, "captures must start at zero");
  } finally {
    await close();
  }
});

test("POST /api/games accepts board_size=19", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const res = await agent.post("/api/games").send({ board_size: 19 });
    assert.equal(res.status, 201);
    assert.equal(res.body.game.board_size, 19, "board_size must be 19");
    assert.equal(res.body.game.board.length, 19, "board must have 19 rows");
    assert.equal(res.body.game.board[0].length, 19, "board rows must have 19 columns");
  } finally {
    await close();
  }
});

test("POST /api/games sets a session cookie", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const res = await agent.post("/api/games").send({});
    assert.equal(res.status, 201);
    const setCookie = res.headers["set-cookie"];
    assert.ok(setCookie, "set-cookie header must be present");
    assert.ok(
      setCookie.some((c) => c.startsWith("bg_session_id=")),
      "bg_session_id cookie must be set",
    );
  } finally {
    await close();
  }
});

test("POST /api/games resumes existing game when force_new is not set", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const first = await agent.post("/api/games").send({});
    assert.equal(first.status, 201);
    const firstId = first.body.game.id;

    const second = await agent.post("/api/games").send({});
    assert.equal(second.status, 200, "second call must return 200 (resumed)");
    assert.equal(second.body.game.id, firstId, "must resume the same game");
  } finally {
    await close();
  }
});

test("POST /api/games creates a new game when requested board_size differs", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const first = await agent.post("/api/games").send({ board_size: 9 });
    const second = await agent.post("/api/games").send({ board_size: 19 });

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(second.body.game.id, first.body.game.id, "different board sizes should not reuse the same game");
    assert.equal(second.body.game.board_size, 19);
  } finally {
    await close();
  }
});

test("POST /api/games with force_new:true creates a fresh game", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const first = await agent.post("/api/games").send({});
    assert.equal(first.status, 201);
    const firstId = first.body.game.id;

    const second = await agent.post("/api/games").send({ force_new: true });
    assert.equal(second.status, 201, "force_new must return 201");
    assert.notEqual(second.body.game.id, firstId, "must create a new game");
  } finally {
    await close();
  }
});

test("POST /api/games respects ai_level parameter", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const res = await agent.post("/api/games").send({ ai_level: "hard" });
    assert.equal(res.status, 201);
    assert.equal(res.body.game.ai_level, "hard", "ai_level must be hard");
  } finally {
    await close();
  }
});

test("POST /api/games defaults ai_level to medium when not provided", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const res = await agent.post("/api/games").send({});
    assert.equal(res.status, 201);
    assert.equal(res.body.game.ai_level, "medium", "ai_level must default to medium");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// GET /api/games/:id
// ---------------------------------------------------------------------------

test("GET /api/games/:id returns the game for the owning session", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    const res = await agent.get(`/api/games/${gameId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.game.id, gameId);
  } finally {
    await close();
  }
});

test("GET /api/games/:id returns 404 for a non-existent game", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const res = await agent.get(`/api/games/${randomUUID()}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "not_found");
  } finally {
    await close();
  }
});

test("GET /api/games/:id returns 404 for a game owned by a different session", async () => {
  const { agent: agent1, close: close1 } = await buildTestAgent();
  const { agent: agent2, close: close2 } = await buildTestAgent();
  try {
    // Create a game with agent1.
    const created = await agent1.post("/api/games").send({});
    const gameId = created.body.game.id;
    // Try to access it with a completely separate agent (different session).
    const res = await agent2.get(`/api/games/${gameId}`);
    assert.equal(res.status, 404, "must return 404 for a foreign session");
  } finally {
    await close1();
    await close2();
  }
});

test("GET /api/games/:id includes legal_moves when status is human_turn", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    const res = await agent.get(`/api/games/${gameId}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.game.legal_moves), "legal_moves must be an array");
    assert.ok(res.body.game.legal_moves.length > 0, "legal_moves must be non-empty at game start");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/games/:id/actions – validation
// ---------------------------------------------------------------------------

test("POST /api/games/:id/actions returns 400 for missing action_id", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      expected_turn_version: 0,
      // action_id intentionally omitted
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "missing_action_id");
  } finally {
    await close();
  }
});

test("POST /api/games/:id/actions returns 400 for invalid action", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "invalid_action",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_action");
  } finally {
    await close();
  }
});

test("POST /api/games/:id/actions returns 400 for missing expected_turn_version", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      // expected_turn_version intentionally omitted
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "missing_expected_turn_version");
  } finally {
    await close();
  }
});

test("POST /api/games/:id/actions returns 400 for place without coordinates", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "place",
      action_id: randomUUID(),
      expected_turn_version: 0,
      // x and y intentionally omitted
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_coordinate");
  } finally {
    await close();
  }
});

test("POST /api/games/:id/actions returns 404 for a non-existent game", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const res = await agent.post(`/api/games/${randomUUID()}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "not_found");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/games/:id/actions – pass
// ---------------------------------------------------------------------------

test("POST /api/games/:id/actions pass succeeds and increments turn_version", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;
    const initialVersion = created.body.game.turn_version;

    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: initialVersion,
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.game, "response must include game");
    assert.equal(res.body.idempotent, false, "first submission must not be idempotent");
    assert.ok(
      res.body.game.turn_version > initialVersion,
      "turn_version must be incremented",
    );
  } finally {
    await close();
  }
});

test("POST /api/games/:id/actions pass transitions status to ai_thinking", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });
    assert.equal(res.status, 200);
    assert.equal(
      res.body.game.status,
      "ai_thinking",
      "status must transition to ai_thinking after human pass",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/games/:id/actions – place
// ---------------------------------------------------------------------------

test("POST /api/games/:id/actions place succeeds with valid coordinates", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "place",
      action_id: randomUUID(),
      expected_turn_version: 0,
      x: 4,
      y: 4,
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.game, "response must include game");
    assert.equal(res.body.idempotent, false);
    // After placing, the board should have a stone at (4,4).
    const cell = res.body.game.board[4][4];
    assert.equal(cell, "B", "black stone must be placed at (4,4)");
  } finally {
    await close();
  }
});

test("POST /api/games/:id/actions place returns 400 for occupied cell", async () => {
  const { agent, close } = await buildTestAgent({
    scheduleAiTurn: (gameId, data) => {
      void processAiTurn(gameId, data);
    },
  });
  try {
    setTestProvider(() => ({ action: "pass", rationale: "Test AI pass" }));

    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    // Place a stone at (4,4).
    await agent.post(`/api/games/${gameId}/actions`).send({
      action: "place",
      action_id: randomUUID(),
      expected_turn_version: 0,
      x: 4,
      y: 4,
    });

    // The game is now in ai_thinking; wait briefly for the AI turn to complete
    // by polling until status is human_turn again (up to 2s).
    let game;
    for (let i = 0; i < 20; i++) {
      const poll = await agent.get(`/api/games/${gameId}`);
      game = poll.body.game;
      if (game.status === "human_turn") break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Now try to place at the same cell (which the AI may have placed on, but
    // the human's original stone is still there at (4,4)).
    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "place",
      action_id: randomUUID(),
      expected_turn_version: game.turn_version,
      x: 4,
      y: 4,
    });
    assert.equal(res.status, 400, "placing on an occupied cell must return 400");
  } finally {
    setTestProvider(null);
    await close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/games/:id/actions – resign
// ---------------------------------------------------------------------------

test("POST /api/games/:id/actions resign ends the game with ai as winner", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "resign",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.game.status, "finished", "status must be finished after resign");
    assert.equal(res.body.game.winner, "W", "AI (white) must win when human resigns");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/games/:id/actions – idempotency
// ---------------------------------------------------------------------------

test("POST /api/games/:id/actions returns idempotent:true for duplicate action_id", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;
    const actionId = randomUUID();

    // First submission.
    const first = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: actionId,
      expected_turn_version: 0,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.idempotent, false);

    // Duplicate submission with the same action_id.
    const second = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: actionId,
      expected_turn_version: 0,
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.idempotent, true, "duplicate action_id must return idempotent:true");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// POST /api/games/:id/actions – stale turn version
// ---------------------------------------------------------------------------

test("POST /api/games/:id/actions returns 409 for stale expected_turn_version", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    // Submit a pass to increment turn_version.
    await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });

    // Now submit with the old turn_version (0) – should be stale.
    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0, // stale
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "stale_turn_version");
    assert.ok(
      typeof res.body.current_turn_version === "number",
      "current_turn_version must be returned",
    );
    assert.ok(
      res.body.current_turn_version > 0,
      "current_turn_version must be greater than the stale version",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// GET /api/games/:id/events – SSE
// ---------------------------------------------------------------------------

test("GET /api/games/:id/events returns 200 with text/event-stream content type", async () => {
  const sseDb = await buildTestDb();
  const sseData = buildDataModule(sseDb);
  const sseApp = createApp({ data: sseData });
  // Bind a real HTTP server on a random port so we can use http.get to
  // connect to the SSE endpoint and close the connection immediately.
  const server = http.createServer(sseApp);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const sseAgent = supertest.agent(sseApp);
  try {
    const created = await sseAgent.post("/api/games").send({});
    const gameId = created.body.game.id;
    // Extract the session cookie so the SSE request is authenticated.
    const cookieHeader = created.headers["set-cookie"]?.join("; ") ?? "";
    const result = await new Promise((resolve, reject) => {
      const req = http.get(
        `http://127.0.0.1:${port}/api/games/${gameId}/events`,
        { headers: { Cookie: cookieHeader } },
        (res) => {
          resolve({ status: res.statusCode, contentType: res.headers["content-type"] });
          res.destroy(); // close immediately – we only need headers
        },
      );
      req.on("error", reject);
      setTimeout(() => { req.destroy(); reject(new Error("SSE header timeout")); }, 3000);
    });
    assert.equal(result.status, 200);
    assert.ok(
      result.contentType?.includes("text/event-stream"),
      "content-type must be text/event-stream",
    );
  } finally {
    // Close all open connections before closing the server.
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    // Close the supertest agent's internal server.
    if (sseAgent.app && typeof sseAgent.app.close === "function") {
      await new Promise((resolve) => sseAgent.app.close(resolve));
    }
    await sseDb.destroy();
  }
});

test("GET /api/games/:id/events returns 404 for a non-existent game", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const res = await agent.get(`/api/games/${randomUUID()}/events`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "not_found");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Game response shape
// ---------------------------------------------------------------------------

test("game response includes all required fields", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const res = await agent.post("/api/games").send({});
    const game = res.body.game;
    const requiredFields = [
      "id",
      "board_size",
      "komi",
      "ai_level",
      "status",
      "winner",
      "turn",
      "turn_version",
      "pending_action",
      "ai_status",
      "captures",
      "board",
      "legal_moves",
      "moves",
      "move_count",
      "moves_truncated",
      "last_ai_rationale",
    ];
    for (const field of requiredFields) {
      assert.ok(field in game, `game response must include field: ${field}`);
    }
    assert.ok("B" in game.captures, "captures must have B key");
    assert.ok("W" in game.captures, "captures must have W key");
  } finally {
    await close();
  }
});
