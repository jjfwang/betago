/**
 * @file idempotency.test.js
 * @description Tests for idempotency and turn-version enforcement in the
 * `POST /api/games/:id/actions` endpoint.
 *
 * These tests verify that:
 *   1. Duplicate submissions with the same `action_id` return `idempotent:true`
 *      and do not re-apply the move.
 *   2. Stale `expected_turn_version` values are rejected with HTTP 409 and the
 *      current turn version is returned for client re-sync.
 *   3. Actions submitted while the game is in `ai_thinking` state are rejected
 *      with `not_your_turn` (after the turn-version check).
 *   4. Actions submitted on a finished game are rejected with `game_finished`.
 *   5. An `action_id` used for one game cannot be reused for a different game
 *      (`action_id_conflict`).
 *   6. Concurrent duplicate requests (race-condition scenario) are handled
 *      safely via the unique-constraint guard.
 *
 * Each test uses an isolated in-memory SQLite database to prevent cross-test
 * contamination.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import knex from "knex";
import supertest from "supertest";
import { createApp } from "../src/app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "../db/migrations");

// ---------------------------------------------------------------------------
// Test database helpers (mirrors api.test.js for consistency)
// ---------------------------------------------------------------------------

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
  };
}

/**
 * Build a supertest agent backed by an isolated in-memory DB.
 * Returns `{ agent, db, data, close }` for direct DB inspection.
 */
async function buildTestAgent() {
  const db = await buildTestDb();
  const data = buildDataModule(db);
  const app = createApp({ data });
  const agent = supertest.agent(app);
  async function close() {
    if (agent.app && typeof agent.app.close === "function") {
      await new Promise((resolve) => agent.app.close(resolve));
    }
    await db.destroy();
  }
  return { agent, db, data, close };
}

/**
 * Build two supertest agents that share the same in-memory database.
 * This is needed for cross-game action_id conflict tests, where both games
 * must be visible in the same DB.
 */
async function buildSharedDbAgents() {
  const db = await buildTestDb();
  const data = buildDataModule(db);
  const app1 = createApp({ data });
  const app2 = createApp({ data });
  const agent1 = supertest.agent(app1);
  const agent2 = supertest.agent(app2);
  async function close() {
    if (agent1.app && typeof agent1.app.close === "function") {
      await new Promise((resolve) => agent1.app.close(resolve));
    }
    if (agent2.app && typeof agent2.app.close === "function") {
      await new Promise((resolve) => agent2.app.close(resolve));
    }
    await db.destroy();
  }
  return { agent1, agent2, db, data, close };
}

/**
 * Poll the game state until it reaches `human_turn` status or a timeout.
 * Returns the final game payload.
 */
async function waitForHumanTurn(agent, gameId, maxAttempts = 30, delayMs = 100) {
  for (let i = 0; i < maxAttempts; i++) {
    const poll = await agent.get(`/api/games/${gameId}`);
    if (poll.body.game?.status === "human_turn") return poll.body.game;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Game ${gameId} did not return to human_turn within timeout`);
}

// ---------------------------------------------------------------------------
// Idempotency – basic duplicate detection
// ---------------------------------------------------------------------------

test("idempotency: duplicate action_id returns idempotent:true and HTTP 200", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    assert.equal(created.status, 201);
    const gameId = created.body.game.id;
    const actionId = randomUUID();

    // First submission – should be processed normally.
    const first = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: actionId,
      expected_turn_version: 0,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.idempotent, false, "first submission must not be idempotent");

    // Second submission with the same action_id – must be idempotent.
    const second = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: actionId,
      expected_turn_version: 0,
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.idempotent, true, "duplicate action_id must return idempotent:true");
    assert.ok(second.body.game, "idempotent response must include game state");
  } finally {
    await close();
  }
});

test("idempotency: duplicate action_id does not apply the move a second time", async () => {
  const { agent, db, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;
    const actionId = randomUUID();

    // Place a stone at (2, 2).
    const first = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "place",
      action_id: actionId,
      expected_turn_version: 0,
      x: 2,
      y: 2,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.idempotent, false);

    // Duplicate submission – must return idempotent:true without applying another move.
    const second = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "place",
      action_id: actionId,
      expected_turn_version: 0,
      x: 2,
      y: 2,
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.idempotent, true);

    // Verify at the database level that exactly one human move was recorded.
    // (The AI background worker may also have added a move, but we only care
    // that the human's duplicate submission did not create a second human move.)
    const humanMoves = await db("moves")
      .where({ game_id: gameId, player: "human" })
      .orderBy("move_index");
    assert.equal(
      humanMoves.length,
      1,
      "exactly one human move must be recorded; the duplicate submission must not add another",
    );
  } finally {
    await close();
  }
});

test("idempotency: idempotent response includes current game state", async () => {
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

    // Duplicate submission.
    const second = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: actionId,
      expected_turn_version: 0,
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.idempotent, true);

    // Both responses must report the same turn_version (the current state at
    // the time of each response – the AI may have moved between the two calls,
    // but the idempotent response reflects the live game state).
    assert.ok(
      typeof second.body.game.turn_version === "number",
      "idempotent response must include a numeric turn_version",
    );
    assert.ok(second.body.game.id, "idempotent response must include game id");
    assert.ok(Array.isArray(second.body.game.board), "idempotent response must include board");
    assert.ok(
      second.body.game.turn_version >= first.body.game.turn_version,
      "idempotent response turn_version must be >= the original response (AI may have moved)",
    );
  } finally {
    await close();
  }
});

test("idempotency: different action_ids are treated as independent actions", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    // First action.
    const first = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.idempotent, false);

    // Poll until the AI has moved and it is human_turn again.
    const game = await waitForHumanTurn(agent, gameId);
    assert.equal(game.status, "human_turn", "game must return to human_turn after AI move");

    // Second action with a fresh action_id – must not be idempotent.
    const second = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: game.turn_version,
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.idempotent, false, "fresh action_id must not be idempotent");
    assert.ok(
      second.body.game.turn_version > game.turn_version,
      "turn_version must be incremented for a new action",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Idempotency – action_id cross-game conflict
// ---------------------------------------------------------------------------

test("idempotency: action_id used for a different game returns 409 action_id_conflict", async () => {
  // Both agents share the same in-memory database so both games are visible
  // to both agents.  Agent 1 and agent 2 have different session cookies,
  // giving them separate sessions and therefore separate game ownership.
  const { agent1, agent2, close } = await buildSharedDbAgents();
  try {
    // Create game A with agent1.
    const gameA = await agent1.post("/api/games").send({});
    assert.equal(gameA.status, 201);
    const gameIdA = gameA.body.game.id;

    // Create game B with agent2.
    const gameB = await agent2.post("/api/games").send({});
    assert.equal(gameB.status, 201);
    const gameIdB = gameB.body.game.id;
    assert.notEqual(gameIdA, gameIdB, "two separate games must have different IDs");

    // Use the same action_id for game A (agent1's game).
    const sharedActionId = randomUUID();
    const resA = await agent1.post(`/api/games/${gameIdA}/actions`).send({
      action: "pass",
      action_id: sharedActionId,
      expected_turn_version: 0,
    });
    assert.equal(resA.status, 200);
    assert.equal(resA.body.idempotent, false);

    // Attempt to reuse the same action_id for game B (agent2's game).
    // The action_id already exists in action_requests for game A, but
    // game B is a different game – must return action_id_conflict.
    const resB = await agent2.post(`/api/games/${gameIdB}/actions`).send({
      action: "pass",
      action_id: sharedActionId,
      expected_turn_version: 0,
    });
    assert.equal(resB.status, 409, "reusing action_id for a different game must return 409");
    assert.equal(
      resB.body.error,
      "action_id_conflict",
      "error must be action_id_conflict",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Turn version – stale version rejection
// ---------------------------------------------------------------------------

test("turn version: stale expected_turn_version returns 409 stale_turn_version", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    // Submit a pass to advance the turn_version.
    const first = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });
    assert.equal(first.status, 200);
    assert.ok(first.body.game.turn_version > 0, "turn_version must be incremented");

    // Submit with the old (stale) turn_version.
    const stale = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0, // stale
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, "stale_turn_version");
  } finally {
    await close();
  }
});

test("turn version: stale response includes current_turn_version for client re-sync", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    // Advance the turn_version by passing.
    await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });

    // Retrieve the current state to know the real turn_version (the AI may
    // have also moved, so we poll for the live state).
    const poll = await agent.get(`/api/games/${gameId}`);
    const currentVersion = poll.body.game.turn_version;
    assert.ok(currentVersion > 0, "turn_version must have advanced");

    // Submit with a stale version (0).
    const stale = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0, // stale
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, "stale_turn_version");
    assert.ok(
      typeof stale.body.current_turn_version === "number",
      "current_turn_version must be a number",
    );
    // The returned current_turn_version must match the server's actual value.
    // We re-poll to get the definitive current version (the AI background
    // worker may have incremented it between our poll and the stale request).
    const repoll = await agent.get(`/api/games/${gameId}`);
    const definitiveVersion = repoll.body.game.turn_version;
    assert.equal(
      stale.body.current_turn_version,
      definitiveVersion,
      "current_turn_version in error response must match the server's actual turn_version",
    );
  } finally {
    await close();
  }
});

test("turn version: correct turn_version is accepted", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;
    const initialVersion = created.body.game.turn_version;

    // Submit with the correct turn_version.
    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: initialVersion,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.idempotent, false);
    assert.ok(
      res.body.game.turn_version > initialVersion,
      "turn_version must be incremented after a successful action",
    );
  } finally {
    await close();
  }
});

test("turn version: future (too-high) turn_version is also rejected as stale", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    // Submit with a turn_version that is higher than the server's current value.
    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 9999,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "stale_turn_version");
    assert.equal(
      res.body.current_turn_version,
      0,
      "current_turn_version must be the actual server version (0)",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Game status guard – not_your_turn
// ---------------------------------------------------------------------------

test("game status guard: action during ai_thinking (with correct turn_version) returns 409 not_your_turn", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    // Submit a pass – transitions game to ai_thinking.
    const first = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.game.status, "ai_thinking");

    const currentVersion = first.body.game.turn_version;

    // Immediately submit another action with the updated turn_version.
    // The game is still in ai_thinking so this must be rejected.
    const second = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: currentVersion,
    });
    assert.equal(second.status, 409);
    assert.equal(
      second.body.error,
      "not_your_turn",
      "submitting during ai_thinking with correct turn_version must return not_your_turn",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Game status guard – game_finished
// ---------------------------------------------------------------------------

test("game status guard: action on a finished game returns 409 game_finished", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    // Resign to finish the game.
    const resign = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "resign",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });
    assert.equal(resign.status, 200);
    assert.equal(resign.body.game.status, "finished");

    const finishedVersion = resign.body.game.turn_version;

    // Attempt another action on the finished game.
    const after = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: finishedVersion,
    });
    assert.equal(after.status, 409);
    assert.equal(
      after.body.error,
      "game_finished",
      "submitting an action on a finished game must return game_finished",
    );
  } finally {
    await close();
  }
});

test("game status guard: stale turn_version on finished game returns stale_turn_version (not game_finished)", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    // Resign to finish the game.
    const resign = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "resign",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });
    assert.equal(resign.status, 200);
    assert.equal(resign.body.game.status, "finished");

    // Submit with the original stale turn_version (0) – turn_version check
    // fires before the game_finished check.
    const stale = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0, // stale – game is now at version 1+
    });
    assert.equal(stale.status, 409);
    assert.equal(
      stale.body.error,
      "stale_turn_version",
      "stale turn_version must be reported even when game is finished",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// action_requests table – persistence and status tracking
// ---------------------------------------------------------------------------

test("action_requests: successful action is recorded with status completed", async () => {
  const { agent, db, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;
    const actionId = randomUUID();

    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: actionId,
      expected_turn_version: 0,
    });
    assert.equal(res.status, 200);

    const row = await db("action_requests").where({ action_id: actionId }).first();
    assert.ok(row, "action_request row must exist");
    assert.equal(row.game_id, gameId, "action_request must reference the correct game");
    assert.equal(row.status, "completed", "action_request status must be completed");
    assert.equal(row.expected_turn_version, 0, "expected_turn_version must be stored");
  } finally {
    await close();
  }
});

test("action_requests: failed action (illegal move) is recorded with status failed", async () => {
  const { agent, db, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    // Place a stone at (3, 3).
    await agent.post(`/api/games/${gameId}/actions`).send({
      action: "place",
      action_id: randomUUID(),
      expected_turn_version: 0,
      x: 3,
      y: 3,
    });

    // Poll until the AI has moved and it is human_turn again.
    const game = await waitForHumanTurn(agent, gameId);
    assert.equal(game.status, "human_turn");

    // Attempt to place on the already-occupied cell (3, 3).
    const illegalActionId = randomUUID();
    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "place",
      action_id: illegalActionId,
      expected_turn_version: game.turn_version,
      x: 3,
      y: 3,
    });
    assert.equal(res.status, 400);

    const row = await db("action_requests").where({ action_id: illegalActionId }).first();
    assert.ok(row, "action_request row must exist for failed action");
    assert.equal(row.status, "failed", "action_request status must be failed for illegal move");
    assert.ok(row.error_code, "error_code must be set for failed action");
  } finally {
    await close();
  }
});

test("action_requests: stale turn_version does not create an action_request row", async () => {
  const { agent, db, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    // Advance the turn_version.
    await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });

    // Submit with a stale turn_version.
    const staleActionId = randomUUID();
    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: staleActionId,
      expected_turn_version: 0, // stale
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "stale_turn_version");

    // No action_request row should have been created for the stale request.
    const row = await db("action_requests").where({ action_id: staleActionId }).first();
    assert.equal(
      row,
      undefined,
      "stale turn_version must not create an action_request row",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Race condition – concurrent duplicate requests
// ---------------------------------------------------------------------------

test("race condition: concurrent duplicate action_ids result in exactly one move applied", async () => {
  const { agent, db, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;
    const actionId = randomUUID();

    // Fire two requests with the same action_id simultaneously.
    const [res1, res2] = await Promise.all([
      agent.post(`/api/games/${gameId}/actions`).send({
        action: "pass",
        action_id: actionId,
        expected_turn_version: 0,
      }),
      agent.post(`/api/games/${gameId}/actions`).send({
        action: "pass",
        action_id: actionId,
        expected_turn_version: 0,
      }),
    ]);

    // Both must return HTTP 200.
    assert.equal(res1.status, 200, "first concurrent request must return 200");
    assert.equal(res2.status, 200, "second concurrent request must return 200");

    // Exactly one must be non-idempotent and one idempotent (or both idempotent
    // if the unique-constraint guard fires for both after the first insert).
    const nonIdempotentCount = [res1, res2].filter((r) => r.body.idempotent === false).length;
    assert.ok(
      nonIdempotentCount <= 1,
      "at most one concurrent request must be processed as non-idempotent",
    );

    // Exactly one action_request row must exist.
    const rows = await db("action_requests").where({ action_id: actionId });
    assert.equal(rows.length, 1, "exactly one action_request row must exist for the action_id");

    // The game must have advanced by exactly one human move.
    const moves = await db("moves").where({ game_id: gameId });
    const humanMoves = moves.filter((m) => m.player === "human");
    assert.equal(humanMoves.length, 1, "exactly one human move must have been applied");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Ordering: stale_turn_version takes priority over not_your_turn
// ---------------------------------------------------------------------------

test("ordering: stale_turn_version is returned before not_your_turn when both conditions hold", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;

    // Submit a pass – transitions game to ai_thinking and increments turn_version.
    const first = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.game.status, "ai_thinking");
    // Game is now in ai_thinking AND turn_version > 0.

    // Submit with the OLD turn_version (0) – both conditions hold:
    //   - stale turn_version (0 vs current)
    //   - game is in ai_thinking (not_your_turn)
    // The stale_turn_version error must take priority.
    const res = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: randomUUID(),
      expected_turn_version: 0, // stale
    });
    assert.equal(res.status, 409);
    assert.equal(
      res.body.error,
      "stale_turn_version",
      "stale_turn_version must take priority over not_your_turn",
    );
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Ordering: idempotency check takes priority over all other checks
// ---------------------------------------------------------------------------

test("ordering: idempotent response is returned even when game is in ai_thinking", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;
    const actionId = randomUUID();

    // Submit a pass – transitions game to ai_thinking.
    const first = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: actionId,
      expected_turn_version: 0,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.game.status, "ai_thinking");

    // Resubmit the same action_id while game is in ai_thinking.
    // Idempotency check fires first – must return idempotent:true.
    const second = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "pass",
      action_id: actionId,
      expected_turn_version: 0,
    });
    assert.equal(second.status, 200);
    assert.equal(
      second.body.idempotent,
      true,
      "idempotency check must fire before game status guard",
    );
  } finally {
    await close();
  }
});

test("ordering: idempotent response is returned even when game is finished", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/games").send({});
    const gameId = created.body.game.id;
    const actionId = randomUUID();

    // Resign to finish the game.
    const resign = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "resign",
      action_id: actionId,
      expected_turn_version: 0,
    });
    assert.equal(resign.status, 200);
    assert.equal(resign.body.game.status, "finished");

    // Resubmit the same action_id on the finished game.
    // Idempotency check fires first – must return idempotent:true.
    const second = await agent.post(`/api/games/${gameId}/actions`).send({
      action: "resign",
      action_id: actionId,
      expected_turn_version: 0,
    });
    assert.equal(second.status, 200);
    assert.equal(
      second.body.idempotent,
      true,
      "idempotency check must fire before game_finished guard",
    );
  } finally {
    await close();
  }
});
