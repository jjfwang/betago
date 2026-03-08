/**
 * @file integration.test.js
 * @description End-to-end integration tests for the BetaGo application.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import knex from "knex";
import supertest from "supertest";
import { createApp } from "../src/app.js";
import { setWorkerDataModule } from "../src/worker.js";
import { setDataModule } from "../src/game/service.js";
import { setTestProvider } from "../src/ai/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = path.join(__dirname, "../db/migrations");

async function buildTestDb() {
  const db = knex({ client: "sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true, migrations: { directory: MIGRATION_PATH } });
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
      const now = new Date();
      const timeout = new Date(now.getTime() - 30000);
      return db("games")
        .where({ status: "ai_thinking" })
        .andWhere(function () {
          this.whereNull("ai_turn_locked_at").orWhere("ai_turn_locked_at", "<", timeout);
        })
        .select("id");
    },
  };
}

async function buildTestAgent() {
  const db = await buildTestDb();
  const data = buildDataModule(db);
  const app = createApp({ data });
  const agent = supertest.agent(app);
  setWorkerDataModule(data);
  setDataModule(data);
  async function close() {
    if (agent.app && typeof agent.app.close === "function") await new Promise((resolve) => agent.app.close(resolve));
    await db.destroy();
  }
  return { agent, db, data, close };
}

test.afterEach(() => setTestProvider(null));

test.describe("Integration Tests", () => {
  test("a complete game can be played from start to finish", async () => {
    const { agent, db, close } = await buildTestAgent();
    try {
      setTestProvider((game, legal) => {
        if (game.moves.length === 1) return { action: "place", x: 5, y: 5, rationale: "AI mock move" };
        return { action: "pass", rationale: "AI passes to end game" };
      });
      const createRes = await agent.post("/api/games").send({});
      const gameId = createRes.body.game.id;
      await agent.post(`/api/games/${gameId}/actions`).send({ action: "place", action_id: randomUUID(), expected_turn_version: 0, x: 4, y: 4 });
      await new Promise(resolve => setTimeout(resolve, 200));
      const gameAfterAi = await agent.get(`/api/games/${gameId}`);
      assert.equal(gameAfterAi.body.game.status, "human_turn");
      await agent.post(`/api/games/${gameId}/actions`).send({ action: "pass", action_id: randomUUID(), expected_turn_version: 2 });
      await new Promise(resolve => setTimeout(resolve, 200));
      const finalGame = await agent.get(`/api/games/${gameId}`);
      assert.equal(finalGame.body.game.status, "finished");
    } finally {
      await close();
    }
  });

  test("AI retries on invalid move and succeeds", async () => {
    const { agent, db, close } = await buildTestAgent();
    try {
      let attempt = 0;
      setTestProvider(() => {
        attempt++;
        if (attempt === 1) return { action: "place", x: -1, y: -1 };
        return { action: "place", x: 0, y: 0, rationale: "Successful retry" };
      });
      const gameId = (await agent.post("/api/games").send({})).body.game.id;
      await agent.post(`/api/games/${gameId}/actions`).send({ action: "pass", action_id: randomUUID(), expected_turn_version: 0 });
      await new Promise(resolve => setTimeout(resolve, 300));
      const finalGame = await agent.get(`/api/games/${gameId}`);
      assert.equal(finalGame.body.game.status, "human_turn");
      const aiLogs = await db("ai_turn_logs").where({ game_id: gameId });
      assert.equal(aiLogs[0].retry_count, 1);
    } finally {
      await close();
    }
  });

  test("AI uses fallback after repeated failures", async () => {
    const { agent, db, close } = await buildTestAgent();
    try {
      setTestProvider(() => ({ action: "invalid" }));
      const gameId = (await agent.post("/api/games").send({})).body.game.id;
      await agent.post(`/api/games/${gameId}/actions`).send({ action: "pass", action_id: randomUUID(), expected_turn_version: 0 });
            await new Promise(resolve => setTimeout(resolve, 1000)); // Increased timeout for fallback
      const finalGame = await agent.get(`/api/games/${gameId}`);
      assert.equal(finalGame.body.game.status, "human_turn");
      const aiLogs = await db("ai_turn_logs").where({ game_id: gameId });
      assert.ok(aiLogs[0].retry_count > 1);
      assert.equal(aiLogs[0].fallback_used, 1);
    } finally {
      await close();
    }
  });

  test("rejects new action while AI is thinking", async () => {
    const { agent, close } = await buildTestAgent();
    try {
      const gameId = (await agent.post("/api/games").send({})).body.game.id;
      await agent.post(`/api/games/${gameId}/actions`).send({ action: "pass", action_id: randomUUID(), expected_turn_version: 0 });
      const res = await agent.post(`/api/games/${gameId}/actions`).send({ action: "pass", action_id: randomUUID(), expected_turn_version: 1 });
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "not_your_turn");
    } finally {
      await close();
    }
  });

  test("rejects action with a stale turn version", async () => {
    const { agent, close } = await buildTestAgent();
    try {
      setTestProvider(() => ({ action: "pass" }));
      const gameId = (await agent.post("/api/games").send({})).body.game.id;
      await agent.post(`/api/games/${gameId}/actions`).send({ action: "pass", action_id: randomUUID(), expected_turn_version: 0 });
      await new Promise(resolve => setTimeout(resolve, 200));
      const res = await agent.post(`/api/games/${gameId}/actions`).send({ action: "pass", action_id: randomUUID(), expected_turn_version: 0 });
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "stale_turn_version");
    } finally {
      await close();
    }
  });
});
