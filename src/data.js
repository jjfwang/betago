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

export async function updateGame(gameId, data) {
  await db("games").where({ id: gameId }).update({
    ...data,
    updated_at: new Date(),
  });
}
