/**
 * @fileoverview Data access layer for BetaGo.
 *
 * All database interactions go through this module.  Every function operates
 * on the shared Knex instance imported from ./db.js.
 */
import { randomUUID } from "node:crypto";
import db from "./db.js";

export async function createSession() {
  const id = randomUUID();
  const session = {
    id,
    created_at: new Date(),
    updated_at: new Date(),
  };
  await db("sessions").insert(session);
  return session;
}

export async function ensureSession(sessionId) {
  if (sessionId) {
    const session = await db("sessions").where({ id: sessionId }).first();
    if (session) {
      await db("sessions").where({ id: sessionId }).update({ updated_at: new Date() });
      return session;
    }
  }
  return await createSession();
}

export async function createGame(data) {
  const id = randomUUID();
  const game = {
    id,
    ...data,
    created_at: new Date(),
    updated_at: new Date(),
  };
  await db("games").insert(game);
  return game;
}

export async function getGameById(gameId) {
  return await db("games").where({ id: gameId }).first();
}

/**
 * Returns the most recent active (non-finished) game for a session, or null.
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function getActiveGameBySessionId(sessionId) {
  return await db("games")
    .where({ session_id: sessionId })
    .whereNot({ status: "finished" })
    .orderBy("created_at", "desc")
    .first();
}

/**
 * Returns the most recent game for a session regardless of status, or null.
 * @param {string} sessionId
 * @returns {Promise<object|null>}
 */
export async function getLatestGameBySessionId(sessionId) {
  return await db("games")
    .where({ session_id: sessionId })
    .orderBy("created_at", "desc")
    .first();
}

export async function getMovesByGameId(gameId) {
  return await db("moves").where({ game_id: gameId }).orderBy("move_index");
}

export async function createMove(data) {
  const id = randomUUID();
  const move = {
    id,
    ...data,
    created_at: new Date(),
  };
  await db("moves").insert(move);
  return move;
}

export async function logAITurn(data) {
  const id = randomUUID();
  const log = {
    id,
    ...data,
    created_at: new Date(),
  };
  await db("ai_turn_logs").insert(log);
  return log;
}

/**
 * Look up a previously recorded action request by its client-supplied action_id.
 * @param {string} actionId
 * @returns {Promise<object|undefined>}
 */
export async function findActionRequestByActionId(actionId) {
  return await db("action_requests").where({ action_id: actionId }).first();
}

export async function recordActionRequest(data) {
  const id = randomUUID();
  const request = {
    id,
    ...data,
    created_at: new Date(),
  };
  await db("action_requests").insert(request);
  return request;
}

export async function updateActionRequest(actionId, data) {
  await db("action_requests").where({ action_id: actionId }).update(data);
}

export async function updateGame(gameId, data) {
  await db("games").where({ id: gameId }).update({
    ...data,
    updated_at: new Date(),
  });
}

const WORKER_ID = randomUUID();

/**
 * Fetches games that are ready for AI processing.
 * @returns {Promise<Array<object>>}
 */
export async function getGamesForAiProcessing() {
  const now = new Date();
  const timeout = new Date(now.getTime() - 30000); // 30 seconds ago

  return await db("games")
    .where({ status: "ai_thinking" })
    .andWhere(function () {
      this.whereNull("ai_turn_locked_at").orWhere("ai_turn_locked_at", "<", timeout);
    })
    .select("id");
}

/**
 * Acquires a lock on a game for AI turn processing.
 * @param {string} gameId The ID of the game to lock.
 * @param {number} timeoutMs The lock timeout in milliseconds.
 * @returns {Promise<boolean>} A promise that resolves to true if the lock was acquired.
 */
export async function acquireAiTurnLock(gameId, timeoutMs) {
  const now = new Date();
  const timeout = new Date(now.getTime() - timeoutMs);

  const result = await db("games")
    .where({ id: gameId, status: "ai_thinking" })
    .andWhere(function () {
      this.whereNull("ai_turn_locked_at").orWhere("ai_turn_locked_at", "<", timeout);
    })
    .update({
      ai_turn_locked_at: now,
      ai_turn_worker_id: WORKER_ID,
    });

  return result > 0;
}

/**
 * Releases the AI turn lock on a game.
 * @param {string} gameId The ID of the game to release the lock on.
 * @returns {Promise<void>}
 */
export async function releaseAiTurnLock(gameId) {
  await db("games").where({ id: gameId, ai_turn_worker_id: WORKER_ID }).update({
    ai_turn_locked_at: null,
    ai_turn_worker_id: null,
  });
}
