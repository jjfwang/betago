import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import knex from "knex";
import supertest from "supertest";
import { createApp } from "../src/app.js";
import { processChessAiTurn } from "../src/chess/worker.js";
import { setChessTestProvider } from "../src/chess/ai_client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "../db/migrations");

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
      return this.createSession();
    },
    async createChessGame(data) {
      const id = randomUUID();
      const game = { id, ...data, created_at: new Date(), updated_at: new Date() };
      await db("chess_games").insert(game);
      return game;
    },
    async getChessGameById(gameId) {
      return db("chess_games").where({ id: gameId }).first();
    },
    async getActiveChessGameBySessionId(sessionId) {
      return db("chess_games")
        .where({ session_id: sessionId })
        .whereNot({ status: "finished" })
        .orderBy("created_at", "desc")
        .first();
    },
    async getChessMovesByGameId(gameId) {
      return db("chess_moves").where({ game_id: gameId }).orderBy("move_index");
    },
    async createChessMove(data) {
      const id = randomUUID();
      const move = { id, ...data, created_at: new Date() };
      await db("chess_moves").insert(move);
      return move;
    },
    async findChessActionRequestByActionId(actionId) {
      return db("chess_action_requests").where({ action_id: actionId }).first();
    },
    async recordChessActionRequest(data) {
      const id = randomUUID();
      const request = { id, ...data, created_at: new Date() };
      await db("chess_action_requests").insert(request);
      return request;
    },
    async updateChessActionRequest(actionId, data) {
      await db("chess_action_requests").where({ action_id: actionId }).update(data);
    },
    async updateChessGame(gameId, data) {
      await db("chess_games").where({ id: gameId }).update({ ...data, updated_at: new Date() });
    },
    async acquireChessAiTurnLock(gameId, timeoutMs) {
      const now = new Date();
      const timeout = new Date(now.getTime() - timeoutMs);
      const result = await db("chess_games")
        .where({ id: gameId, status: "ai_thinking" })
        .andWhere(function () {
          this.whereNull("ai_turn_locked_at").orWhere("ai_turn_locked_at", "<", timeout);
        })
        .update({ ai_turn_locked_at: now, ai_turn_worker_id: "test-worker" });
      return result > 0;
    },
    async releaseChessAiTurnLock(gameId) {
      await db("chess_games").where({ id: gameId }).update({
        ai_turn_locked_at: null,
        ai_turn_worker_id: null,
      });
    },
    async logChessAITurn(data) {
      const id = randomUUID();
      const log = { id, ...data, created_at: new Date() };
      await db("chess_ai_turn_logs").insert(log);
      return log;
    },
  };
}

async function buildTestAgent({
  scheduleChessAiTurn = () => {},
} = {}) {
  const db = await buildTestDb();
  const data = buildDataModule(db);
  const app = createApp({ data, scheduleChessAiTurn });
  const agent = supertest.agent(app);

  async function close() {
    if (agent.app && typeof agent.app.close === "function") {
      await new Promise((resolve) => agent.app.close(resolve));
    }
    await db.destroy();
  }

  return { agent, close };
}

test.afterEach(() => {
  setChessTestProvider(null);
});

test("POST /api/chess/games creates a new chess game", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const response = await agent.post("/api/chess/games").send({});
    assert.equal(response.status, 201);
    assert.equal(response.body.game.variant, "chess");
    assert.equal(response.body.game.turn, "W");
    assert.ok(Array.isArray(response.body.game.legal_moves));
    assert.ok(response.body.game.legal_moves.some((move) => move.uci === "e2e4"));
  } finally {
    await close();
  }
});

test("POST /api/chess/games/:id/actions accepts a legal opening move", async () => {
  const { agent, close } = await buildTestAgent();
  try {
    const created = await agent.post("/api/chess/games").send({});
    const gameId = created.body.game.id;

    const response = await agent.post(`/api/chess/games/${gameId}/actions`).send({
      action: "move",
      action_id: randomUUID(),
      expected_turn_version: 0,
      from: "e2",
      to: "e4",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.game.status, "ai_thinking");
    assert.equal(response.body.game.board[4][4], "P");
  } finally {
    await close();
  }
});

test("chess AI response is applied and rationale appears in history", async () => {
  setChessTestProvider(async () => ({
    action: "move",
    move: "e7e5",
    rationale: "Fight for the center immediately.",
  }));

  const { agent, close } = await buildTestAgent({
    scheduleChessAiTurn: (gameId, data) => {
      void processChessAiTurn(gameId, data);
    },
  });

  try {
    const created = await agent.post("/api/chess/games").send({});
    const gameId = created.body.game.id;

    const moveResponse = await agent.post(`/api/chess/games/${gameId}/actions`).send({
      action: "move",
      action_id: randomUUID(),
      expected_turn_version: 0,
      from: "e2",
      to: "e4",
    });

    assert.equal(moveResponse.status, 200);

    let game = moveResponse.body.game;
    for (let i = 0; i < 20; i += 1) {
      const poll = await agent.get(`/api/chess/games/${gameId}`);
      game = poll.body.game;
      if (game.status === "human_turn") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.equal(game.status, "human_turn");
    assert.equal(game.board[3][4], "p");
    assert.equal(game.last_ai_rationale, "Fight for the center immediately.");
    assert.equal(game.moves.at(-1).rationale, "Fight for the center immediately.");
    assert.equal(game.moves.at(-1).notation, "e7-e5");
  } finally {
    await close();
  }
});
