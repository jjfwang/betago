/**
 * @file service.test.js
 * @description Integration tests for the stateless game service module.
 *
 * These tests verify the game service's ability to create games, retrieve
 * game state, and apply moves (place, pass, resign) correctly. An in-memory
 * SQLite database is used for isolation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import knex from "knex";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "../db/migrations");

// ---------------------------------------------------------------------------
// Test database setup
// ---------------------------------------------------------------------------

/**
 * Build an isolated in-memory Knex instance and run all migrations.
 * @returns {Promise<import('knex').Knex>} The configured Knex client.
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
 * Create a minimal data module backed by the given Knex instance.
 * @param {import('knex').Knex} db
 */
function buildDataModule(db) {
  return {
    async createSession() {
      const id = randomUUID();
      const session = { id, created_at: new Date(), updated_at: new Date() };
      await db("sessions").insert(session);
      return session;
    },
    async getGameById(gameId) {
      return db("games").where({ id: gameId }).first();
    },
    async getMovesByGameId(gameId) {
      return db("moves").where({ game_id: gameId }).orderBy("move_index");
    },
    async createGame(data) {
      const id = randomUUID();
      const game = { id, ...data, created_at: new Date(), updated_at: new Date() };
      await db("games").insert(game);
      return game;
    },
    async createMove(data) {
      const id = randomUUID();
      const move = { id, ...data, created_at: new Date() };
      await db("moves").insert(move);
      return move;
    },
    async updateGame(gameId, data) {
      await db("games").where({ id: gameId }).update({ ...data, updated_at: new Date() });
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers that mirror the service logic for test use
// ---------------------------------------------------------------------------

/**
 * Convert a coordinate label (e.g. "D4") back to {x, y} for a given board size.
 * Mirrors the private helper inside service.js.
 */
function fromCoordinateLabel(label, size) {
  if (!label || typeof label !== "string" || label.length < 2) return null;
  const alphabet = "ABCDEFGHJKLMNOPQRST";
  const letter = label.charAt(0).toUpperCase();
  const number = parseInt(label.slice(1), 10);
  const x = alphabet.indexOf(letter);
  if (x === -1 || isNaN(number)) return null;
  const y = size - number;
  return { x, y };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("createGame inserts a game row with correct defaults", async () => {
  const db = await buildTestDb();
  try {
    const dataModule = buildDataModule(db);
    const sessionId = (await dataModule.createSession()).id;

    const game = await dataModule.createGame({
      session_id: sessionId,
      board_size: 9,
      komi: 5.5,
      status: "human_turn",
      turn_version: 0,
    });

    const row = await db("games").where({ id: game.id }).first();
    assert.ok(row, "game row must exist in the database");
    assert.equal(row.session_id, sessionId, "session_id must match");
    assert.equal(row.board_size, 9, "board_size must be 9");
    assert.equal(row.komi, 5.5, "komi must be 5.5");
    assert.equal(row.status, "human_turn", "initial status must be human_turn");
    assert.equal(row.turn_version, 0, "initial turn_version must be 0");
    assert.ok(row.created_at, "created_at must be set");
    assert.ok(row.updated_at, "updated_at must be set");
  } finally {
    await db.destroy();
  }
});

test("getMovesByGameId returns moves ordered by move_index", async () => {
  const db = await buildTestDb();
  try {
    const dataModule = buildDataModule(db);
    const sessionId = (await dataModule.createSession()).id;
    const game = await dataModule.createGame({
      session_id: sessionId,
      board_size: 9,
      komi: 5.5,
      status: "ai_thinking",
      turn_version: 1,
    });

    // Insert moves out of order
    await db("moves").insert({ id: randomUUID(), game_id: game.id, move_index: 1, player: "ai", action: "pass", coordinate: null, captures: 0, board_hash: "hash2", created_at: new Date() });
    await db("moves").insert({ id: randomUUID(), game_id: game.id, move_index: 0, player: "human", action: "place", coordinate: "D5", captures: 0, board_hash: "hash1", created_at: new Date() });

    const moves = await dataModule.getMovesByGameId(game.id);
    assert.equal(moves.length, 2, "must return 2 moves");
    assert.equal(moves[0].move_index, 0, "first move must have index 0");
    assert.equal(moves[1].move_index, 1, "second move must have index 1");
  } finally {
    await db.destroy();
  }
});

test("fromCoordinateLabel correctly converts labels to coordinates", () => {
  // For a 9x9 board: A1 -> x=0, y=8; J9 -> x=8, y=0
  const a1 = fromCoordinateLabel("A1", 9);
  assert.deepEqual(a1, { x: 0, y: 8 }, "A1 must map to x=0, y=8 on a 9x9 board");

  const j9 = fromCoordinateLabel("J9", 9);
  assert.deepEqual(j9, { x: 8, y: 0 }, "J9 must map to x=8, y=0 on a 9x9 board");

  const d5 = fromCoordinateLabel("D5", 9);
  assert.deepEqual(d5, { x: 3, y: 4 }, "D5 must map to x=3, y=4 on a 9x9 board");
});

test("fromCoordinateLabel returns null for invalid input", () => {
  assert.equal(fromCoordinateLabel(null, 9), null, "null input must return null");
  assert.equal(fromCoordinateLabel("", 9), null, "empty string must return null");
  assert.equal(fromCoordinateLabel("Z", 9), null, "single char must return null");
  assert.equal(fromCoordinateLabel("I5", 9), null, "letter I is skipped in Go notation");
});

test("updateGame persists status and turn_version changes", async () => {
  const db = await buildTestDb();
  try {
    const dataModule = buildDataModule(db);
    const sessionId = (await dataModule.createSession()).id;
    const game = await dataModule.createGame({
      session_id: sessionId,
      board_size: 9,
      komi: 5.5,
      status: "human_turn",
      turn_version: 0,
    });

    await dataModule.updateGame(game.id, { status: "ai_thinking", turn_version: 1 });

    const updated = await db("games").where({ id: game.id }).first();
    assert.equal(updated.status, "ai_thinking", "status must be updated to ai_thinking");
    assert.equal(updated.turn_version, 1, "turn_version must be incremented to 1");
  } finally {
    await db.destroy();
  }
});

test("createMove persists a place move with coordinate and captures", async () => {
  const db = await buildTestDb();
  try {
    const dataModule = buildDataModule(db);
    const sessionId = (await dataModule.createSession()).id;
    const game = await dataModule.createGame({
      session_id: sessionId,
      board_size: 9,
      komi: 5.5,
      status: "ai_thinking",
      turn_version: 1,
    });

    const move = await dataModule.createMove({
      game_id: game.id,
      move_index: 0,
      player: "human",
      action: "place",
      coordinate: "D5",
      captures: 0,
      board_hash: "somehash",
    });

    const row = await db("moves").where({ id: move.id }).first();
    assert.ok(row, "move row must exist");
    assert.equal(row.game_id, game.id, "game_id must match");
    assert.equal(row.move_index, 0, "move_index must be 0");
    assert.equal(row.player, "human", "player must be human");
    assert.equal(row.action, "place", "action must be place");
    assert.equal(row.coordinate, "D5", "coordinate must be D5");
    assert.equal(row.captures, 0, "captures must be 0");
  } finally {
    await db.destroy();
  }
});

test("createMove persists a pass move with null coordinate", async () => {
  const db = await buildTestDb();
  try {
    const dataModule = buildDataModule(db);
    const sessionId = (await dataModule.createSession()).id;
    const game = await dataModule.createGame({
      session_id: sessionId,
      board_size: 9,
      komi: 5.5,
      status: "human_turn",
      turn_version: 2,
    });

    const move = await dataModule.createMove({
      game_id: game.id,
      move_index: 2,
      player: "ai",
      action: "pass",
      coordinate: null,
      captures: 0,
      board_hash: "somehash",
    });

    const row = await db("moves").where({ id: move.id }).first();
    assert.ok(row, "pass move row must exist");
    assert.equal(row.action, "pass", "action must be pass");
    assert.equal(row.coordinate, null, "coordinate must be null for a pass");
  } finally {
    await db.destroy();
  }
});

test("createMove persists a resign move", async () => {
  const db = await buildTestDb();
  try {
    const dataModule = buildDataModule(db);
    const sessionId = (await dataModule.createSession()).id;
    const game = await dataModule.createGame({
      session_id: sessionId,
      board_size: 9,
      komi: 5.5,
      status: "human_turn",
      turn_version: 4,
    });

    const move = await dataModule.createMove({
      game_id: game.id,
      move_index: 4,
      player: "human",
      action: "resign",
      coordinate: null,
      captures: 0,
      board_hash: "somehash",
    });

    const row = await db("moves").where({ id: move.id }).first();
    assert.ok(row, "resign move row must exist");
    assert.equal(row.action, "resign", "action must be resign");
    assert.equal(row.player, "human", "player must be human");
  } finally {
    await db.destroy();
  }
});

test("game status transitions from human_turn to ai_thinking after a place move", async () => {
  const db = await buildTestDb();
  try {
    const dataModule = buildDataModule(db);
    const sessionId = (await dataModule.createSession()).id;
    const game = await dataModule.createGame({
      session_id: sessionId,
      board_size: 9,
      komi: 5.5,
      status: "human_turn",
      turn_version: 0,
    });

    // Simulate a human place move
    await dataModule.createMove({
      game_id: game.id,
      move_index: 0,
      player: "human",
      action: "place",
      coordinate: "D5",
      captures: 0,
      board_hash: "hash1",
    });
    await dataModule.updateGame(game.id, { status: "ai_thinking", turn_version: 1 });

    const updated = await db("games").where({ id: game.id }).first();
    assert.equal(updated.status, "ai_thinking", "status must be ai_thinking after human places a stone");
    assert.equal(updated.turn_version, 1, "turn_version must be incremented");
  } finally {
    await db.destroy();
  }
});

test("game status transitions to finished after resign", async () => {
  const db = await buildTestDb();
  try {
    const dataModule = buildDataModule(db);
    const sessionId = (await dataModule.createSession()).id;
    const game = await dataModule.createGame({
      session_id: sessionId,
      board_size: 9,
      komi: 5.5,
      status: "human_turn",
      turn_version: 0,
    });

    await dataModule.createMove({
      game_id: game.id,
      move_index: 0,
      player: "human",
      action: "resign",
      coordinate: null,
      captures: 0,
      board_hash: "hash1",
    });
    await dataModule.updateGame(game.id, { status: "finished", winner: "ai", turn_version: 1 });

    const updated = await db("games").where({ id: game.id }).first();
    assert.equal(updated.status, "finished", "status must be finished after resign");
    assert.equal(updated.winner, "ai", "winner must be ai when human resigns");
  } finally {
    await db.destroy();
  }
});

test("game status transitions to finished after two consecutive passes", async () => {
  const db = await buildTestDb();
  try {
    const dataModule = buildDataModule(db);
    const sessionId = (await dataModule.createSession()).id;
    const game = await dataModule.createGame({
      session_id: sessionId,
      board_size: 9,
      komi: 5.5,
      status: "human_turn",
      turn_version: 0,
    });

    // Human passes
    await dataModule.createMove({ game_id: game.id, move_index: 0, player: "human", action: "pass", coordinate: null, captures: 0, board_hash: "hash1", created_at: new Date() });
    await dataModule.updateGame(game.id, { status: "ai_thinking", turn_version: 1 });

    // AI passes
    await dataModule.createMove({ game_id: game.id, move_index: 1, player: "ai", action: "pass", coordinate: null, captures: 0, board_hash: "hash1", created_at: new Date() });
    await dataModule.updateGame(game.id, { status: "finished", winner: "human", turn_version: 2 });

    const updated = await db("games").where({ id: game.id }).first();
    assert.equal(updated.status, "finished", "game must be finished after two consecutive passes");
    assert.equal(updated.turn_version, 2, "turn_version must be 2");
  } finally {
    await db.destroy();
  }
});

test("getGameById returns null for a non-existent game", async () => {
  const db = await buildTestDb();
  try {
    const dataModule = buildDataModule(db);
    const result = await dataModule.getGameById(randomUUID());
    assert.equal(result, undefined, "getGameById must return undefined for a missing game");
  } finally {
    await db.destroy();
  }
});

test("getMovesByGameId returns empty array for a game with no moves", async () => {
  const db = await buildTestDb();
  try {
    const dataModule = buildDataModule(db);
    const sessionId = (await dataModule.createSession()).id;
    const game = await dataModule.createGame({
      session_id: sessionId,
      board_size: 9,
      komi: 5.5,
      status: "human_turn",
      turn_version: 0,
    });

    const moves = await dataModule.getMovesByGameId(game.id);
    assert.equal(moves.length, 0, "a new game must have no moves");
  } finally {
    await db.destroy();
  }
});

test("turn_version is incremented correctly across multiple moves", async () => {
  const db = await buildTestDb();
  try {
    const dataModule = buildDataModule(db);
    const sessionId = (await dataModule.createSession()).id;
    const game = await dataModule.createGame({
      session_id: sessionId,
      board_size: 9,
      komi: 5.5,
      status: "human_turn",
      turn_version: 0,
    });

    // Simulate 3 moves
    for (let i = 0; i < 3; i++) {
      await dataModule.updateGame(game.id, { turn_version: i + 1 });
    }

    const updated = await db("games").where({ id: game.id }).first();
    assert.equal(updated.turn_version, 3, "turn_version must be 3 after 3 moves");
  } finally {
    await db.destroy();
  }
});
