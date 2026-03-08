/**
 * Database schema integration tests.
 *
 * These tests verify that the five core tables (sessions, games, moves,
 * action_requests, ai_turn_logs) are created correctly by the migration and
 * that the data-layer helper functions in src/data.js can insert and query
 * rows as expected.
 *
 * An in-memory SQLite database is used so the tests are fully isolated and
 * leave no files on disk.
 */

import test from "node:test";
import assert from "node:assert/strict";
import knex from "knex";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "../db/migrations");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an isolated in-memory Knex instance and run all migrations against it.
 * Returns the configured Knex client.
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

// ---------------------------------------------------------------------------
// Schema existence tests
// ---------------------------------------------------------------------------

test("sessions table exists with required columns", async () => {
  const db = await buildTestDb();
  try {
    const columns = await db("sessions").columnInfo();
    assert.ok(columns.id, "id column must exist");
    assert.ok(columns.client_fingerprint, "client_fingerprint column must exist");
    assert.ok(columns.created_at, "created_at column must exist");
    assert.ok(columns.updated_at, "updated_at column must exist");
  } finally {
    await db.destroy();
  }
});

test("games table exists with required columns", async () => {
  const db = await buildTestDb();
  try {
    const columns = await db("games").columnInfo();
    assert.ok(columns.id, "id column must exist");
    assert.ok(columns.session_id, "session_id column must exist");
    assert.ok(columns.board_size, "board_size column must exist");
    assert.ok(columns.komi, "komi column must exist");
    assert.ok(columns.status, "status column must exist");
    assert.ok(columns.winner, "winner column must exist");
    assert.ok(columns.turn_version, "turn_version column must exist");
    assert.ok(columns.created_at, "created_at column must exist");
    assert.ok(columns.updated_at, "updated_at column must exist");
    // Columns added by the api_fields migration.
    assert.ok(columns.ai_level, "ai_level column must exist");
    assert.ok("pending_action" in columns, "pending_action column must exist");
    assert.ok(columns.ai_status, "ai_status column must exist");
    assert.ok("score_detail" in columns, "score_detail column must exist");
  } finally {
    await db.destroy();
  }
});

test("moves table exists with required columns", async () => {
  const db = await buildTestDb();
  try {
    const columns = await db("moves").columnInfo();
    assert.ok(columns.id, "id column must exist");
    assert.ok(columns.game_id, "game_id column must exist");
    assert.ok(columns.move_index, "move_index column must exist");
    assert.ok(columns.player, "player column must exist");
    assert.ok(columns.action, "action column must exist");
    assert.ok(columns.coordinate, "coordinate column must exist");
    assert.ok(columns.captures, "captures column must exist");
    assert.ok(columns.board_hash, "board_hash column must exist");
    assert.ok(columns.created_at, "created_at column must exist");
    // Column added by the api_fields migration.
    assert.ok("rationale" in columns, "rationale column must exist");
  } finally {
    await db.destroy();
  }
});

test("action_requests table exists with required columns", async () => {
  const db = await buildTestDb();
  try {
    const columns = await db("action_requests").columnInfo();
    assert.ok(columns.id, "id column must exist");
    assert.ok(columns.game_id, "game_id column must exist");
    assert.ok(columns.action_id, "action_id column must exist");
    assert.ok(columns.expected_turn_version, "expected_turn_version column must exist");
    assert.ok(columns.status, "status column must exist");
    assert.ok(columns.error_code, "error_code column must exist");
    assert.ok(columns.created_at, "created_at column must exist");
  } finally {
    await db.destroy();
  }
});

test("ai_turn_logs table exists with required columns", async () => {
  const db = await buildTestDb();
  try {
    const columns = await db("ai_turn_logs").columnInfo();
    assert.ok(columns.id, "id column must exist");
    assert.ok(columns.game_id, "game_id column must exist");
    assert.ok(columns.move_index, "move_index column must exist");
    assert.ok(columns.model, "model column must exist");
    assert.ok(columns.prompt_version, "prompt_version column must exist");
    assert.ok(columns.response_id, "response_id column must exist");
    assert.ok(columns.retry_count, "retry_count column must exist");
    assert.ok(columns.fallback_used, "fallback_used column must exist");
    assert.ok(columns.latency_ms, "latency_ms column must exist");
    assert.ok(columns.created_at, "created_at column must exist");
  } finally {
    await db.destroy();
  }
});

// ---------------------------------------------------------------------------
// Data insertion and retrieval tests
// ---------------------------------------------------------------------------

test("can insert and retrieve a session row", async () => {
  const db = await buildTestDb();
  try {
    const id = randomUUID();
    await db("sessions").insert({ id, created_at: new Date(), updated_at: new Date() });
    const row = await db("sessions").where({ id }).first();
    assert.equal(row.id, id, "retrieved session id must match inserted id");
  } finally {
    await db.destroy();
  }
});

test("can insert and retrieve a game row", async () => {
  const db = await buildTestDb();
  try {
    const sessionId = randomUUID();
    await db("sessions").insert({ id: sessionId, created_at: new Date(), updated_at: new Date() });

    const gameId = randomUUID();
    await db("games").insert({
      id: gameId,
      session_id: sessionId,
      board_size: 9,
      komi: 6.5,
      status: "human_turn",
      turn_version: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const row = await db("games").where({ id: gameId }).first();
    assert.equal(row.id, gameId, "retrieved game id must match inserted id");
    assert.equal(row.session_id, sessionId, "game must reference the correct session");
    assert.equal(row.board_size, 9, "board_size must be 9");
    assert.equal(Number(row.komi), 6.5, "komi must be 6.5");
    assert.equal(row.status, "human_turn", "initial status must be human_turn");
    assert.equal(row.turn_version, 0, "initial turn_version must be 0");
  } finally {
    await db.destroy();
  }
});

test("can insert and retrieve a move row", async () => {
  const db = await buildTestDb();
  try {
    const sessionId = randomUUID();
    await db("sessions").insert({ id: sessionId, created_at: new Date(), updated_at: new Date() });

    const gameId = randomUUID();
    await db("games").insert({
      id: gameId,
      session_id: sessionId,
      board_size: 9,
      komi: 6.5,
      status: "human_turn",
      turn_version: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const moveId = randomUUID();
    await db("moves").insert({
      id: moveId,
      game_id: gameId,
      move_index: 0,
      player: "human",
      action: "place",
      coordinate: "D5",
      captures: 0,
      board_hash: "abc123",
      created_at: new Date(),
    });

    const row = await db("moves").where({ id: moveId }).first();
    assert.equal(row.id, moveId, "retrieved move id must match inserted id");
    assert.equal(row.game_id, gameId, "move must reference the correct game");
    assert.equal(row.player, "human", "player must be human");
    assert.equal(row.action, "place", "action must be place");
    assert.equal(row.coordinate, "D5", "coordinate must be D5");
    assert.equal(row.captures, 0, "captures must be 0");
  } finally {
    await db.destroy();
  }
});

test("can insert and retrieve an action_request row", async () => {
  const db = await buildTestDb();
  try {
    const sessionId = randomUUID();
    await db("sessions").insert({ id: sessionId, created_at: new Date(), updated_at: new Date() });

    const gameId = randomUUID();
    await db("games").insert({
      id: gameId,
      session_id: sessionId,
      board_size: 9,
      komi: 6.5,
      status: "human_turn",
      turn_version: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const requestId = randomUUID();
    const actionId = randomUUID();
    await db("action_requests").insert({
      id: requestId,
      game_id: gameId,
      action_id: actionId,
      expected_turn_version: 0,
      status: "accepted",
      error_code: null,
      created_at: new Date(),
    });

    const row = await db("action_requests").where({ id: requestId }).first();
    assert.equal(row.id, requestId, "retrieved request id must match inserted id");
    assert.equal(row.game_id, gameId, "request must reference the correct game");
    assert.equal(row.action_id, actionId, "action_id must match");
    assert.equal(row.expected_turn_version, 0, "expected_turn_version must be 0");
    assert.equal(row.status, "accepted", "status must be accepted");
  } finally {
    await db.destroy();
  }
});

test("action_requests enforces unique action_id constraint", async () => {
  const db = await buildTestDb();
  try {
    const sessionId = randomUUID();
    await db("sessions").insert({ id: sessionId, created_at: new Date(), updated_at: new Date() });

    const gameId = randomUUID();
    await db("games").insert({
      id: gameId,
      session_id: sessionId,
      board_size: 9,
      komi: 6.5,
      status: "human_turn",
      turn_version: 0,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const actionId = randomUUID();
    await db("action_requests").insert({
      id: randomUUID(),
      game_id: gameId,
      action_id: actionId,
      expected_turn_version: 0,
      status: "accepted",
      error_code: null,
      created_at: new Date(),
    });

    // Attempting to insert a duplicate action_id must throw a unique constraint error.
    await assert.rejects(
      () =>
        db("action_requests").insert({
          id: randomUUID(),
          game_id: gameId,
          action_id: actionId, // duplicate
          expected_turn_version: 0,
          status: "accepted",
          error_code: null,
          created_at: new Date(),
        }),
      (err) => {
        assert.ok(err, "error must be thrown for duplicate action_id");
        return true;
      },
    );
  } finally {
    await db.destroy();
  }
});

test("can insert and retrieve an ai_turn_log row", async () => {
  const db = await buildTestDb();
  try {
    const sessionId = randomUUID();
    await db("sessions").insert({ id: sessionId, created_at: new Date(), updated_at: new Date() });

    const gameId = randomUUID();
    await db("games").insert({
      id: gameId,
      session_id: sessionId,
      board_size: 9,
      komi: 6.5,
      status: "ai_thinking",
      turn_version: 1,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const logId = randomUUID();
    await db("ai_turn_logs").insert({
      id: logId,
      game_id: gameId,
      move_index: 1,
      model: "gpt-4o",
      prompt_version: "v1",
      response_id: "resp_abc",
      retry_count: 0,
      fallback_used: false,
      latency_ms: 320,
      created_at: new Date(),
    });

    const row = await db("ai_turn_logs").where({ id: logId }).first();
    assert.equal(row.id, logId, "retrieved log id must match inserted id");
    assert.equal(row.game_id, gameId, "log must reference the correct game");
    assert.equal(row.model, "gpt-4o", "model must match");
    assert.equal(row.retry_count, 0, "retry_count must be 0");
    assert.equal(row.fallback_used, 0, "fallback_used must be false (0 in SQLite)");
    assert.equal(row.latency_ms, 320, "latency_ms must be 320");
  } finally {
    await db.destroy();
  }
});

// ---------------------------------------------------------------------------
// Migration rollback test
// ---------------------------------------------------------------------------

test("migration rollback drops all tables", async () => {
  const db = await buildTestDb();
  try {
    await db.migrate.rollback();

    // After rollback, none of the application tables should exist.
    for (const table of ["sessions", "games", "moves", "action_requests", "ai_turn_logs"]) {
      const exists = await db.schema.hasTable(table);
      assert.equal(exists, false, `table ${table} must not exist after rollback`);
    }
  } finally {
    await db.destroy();
  }
});
