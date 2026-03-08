import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  BLACK,
  WHITE,
  boardHash,
  chineseAreaScore,
  createEmptyBoard,
  listLegalPlacements,
  tryPlaceStone,
} from "./rules.js";
import { deterministicPolicyMove, selectAIMove } from "../ai/client.js";
import { releaseKataGoSession } from "../ai/katago.js";

const MAX_AI_RETRIES = 2;
const DEFAULT_BOARD_SIZE = 18;
const DEFAULT_KOMI = 5.5;
const DEFAULT_AI_LEVEL = "medium";
const AI_THINK_DELAY_MS = Number.parseInt(process.env.AI_THINK_DELAY_MS ?? "350", 10);
const AI_LEVELS = new Set(["entry", "medium", "hard"]);
const MAX_ACTION_REQUESTS = Number.parseInt(process.env.MAX_ACTION_REQUESTS ?? "300", 10);
const MAX_AI_TURN_LOGS = Number.parseInt(process.env.MAX_AI_TURN_LOGS ?? "500", 10);
const MAX_GAMES = Number.parseInt(process.env.MAX_GAMES ?? "500", 10);
const MAX_SESSIONS = Number.parseInt(process.env.MAX_SESSIONS ?? "1000", 10);
const MAX_MOVES_IN_PAYLOAD = Number.parseInt(process.env.MAX_MOVES_IN_PAYLOAD ?? "160", 10);

const sessions = new Map();
const games = new Map();
const sessionActiveGame = new Map();
const aiInFlight = new Set();

export const gameEvents = new EventEmitter();

export function normalizeAiLevel(level) {
  const value = typeof level === "string" ? level.trim().toLowerCase() : "";
  return AI_LEVELS.has(value) ? value : DEFAULT_AI_LEVEL;
}

function coordinateLabel(x, y, size) {
  const alphabet = "ABCDEFGHJKLMNOPQRST";
  const letter = alphabet[x] ?? "?";
  const number = size - y;
  return `${letter}${number}`;
}

function nowIso() {
  return new Date().toISOString();
}

function gameSummary(game) {
  const legalMoves =
    game.status === "human_turn"
      ? listLegalPlacements({ board: game.board, color: BLACK, positionHistory: game.positionHistory }).map((m) => ({
          x: m.x,
          y: m.y,
        }))
      : [];

  const lastAIMove = [...game.moves].reverse().find((m) => m.player === "ai" && m.rationale);

  const moveSliceStart = Math.max(0, game.moves.length - MAX_MOVES_IN_PAYLOAD);
  const moves = game.moves.slice(moveSliceStart);

  return {
    id: game.id,
    board_size: game.boardSize,
    komi: game.komi,
    ai_level: game.aiLevel,
    status: game.status,
    winner: game.winner,
    turn: game.turn,
    turn_version: game.turnVersion,
    pending_action: game.pendingAction,
    ai_status: game.aiStatus,
    captures: game.captures,
    board: game.board,
    legal_moves: legalMoves,
    moves,
    move_count: game.moves.length,
    moves_truncated: moveSliceStart > 0,
    score: game.score,
    last_ai_rationale: lastAIMove?.rationale ?? null,
    created_at: game.createdAt,
    updated_at: game.updatedAt,
  };
}

function publishGame(game) {
  game.updatedAt = nowIso();
  game.updatedAtMs = Date.now();
  gameEvents.emit(`game:${game.id}`, gameSummary(game));
}

function createSession() {
  const id = randomUUID();
  const nowMs = Date.now();
  const session = {
    id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
  sessions.set(id, session);
  pruneStores();
  return session;
}

export function ensureSession(sessionId) {
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId);
    const nowMs = Date.now();
    session.updatedAt = nowIso();
    session.updatedAtMs = nowMs;
    return session;
  }
  return createSession();
}

function trimMapOldest(map, maxSize) {
  while (map.size > maxSize) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }
}

function trimArrayHead(arr, maxSize) {
  if (arr.length <= maxSize) {
    return;
  }
  arr.splice(0, arr.length - maxSize);
}

function pruneStores() {
  for (const [sessionId, gameId] of sessionActiveGame.entries()) {
    if (!games.has(gameId)) {
      sessionActiveGame.delete(sessionId);
    }
  }

  if (sessions.size > MAX_SESSIONS) {
    const removable = [...sessions.values()]
      .filter((session) => !sessionActiveGame.has(session.id))
      .sort((a, b) => a.updatedAtMs - b.updatedAtMs);
    while (sessions.size > MAX_SESSIONS && removable.length > 0) {
      const candidate = removable.shift();
      sessions.delete(candidate.id);
    }
  }

  if (games.size > MAX_GAMES) {
    const finished = [...games.values()]
      .filter((game) => game.status === "finished")
      .sort((a, b) => a.updatedAtMs - b.updatedAtMs);
    while (games.size > MAX_GAMES && finished.length > 0) {
      const victim = finished.shift();
      games.delete(victim.id);
      sessionActiveGame.delete(victim.sessionId);
      releaseKataGoSession(victim.id);
    }
  }
}

function createMove({ game, player, action, x = null, y = null, captures = 0, rationale = "", model = null, responseId = null }) {
  const id = randomUUID();
  const hash = boardHash(game.board);
  return {
    id,
    game_id: game.id,
    move_index: game.moves.length,
    player,
    action,
    coordinate: action === "place" ? coordinateLabel(x, y, game.boardSize) : null,
    x,
    y,
    captures,
    board_hash: hash,
    turn_version: game.turnVersion,
    rationale: rationale || null,
    model,
    response_id: responseId,
    created_at: nowIso(),
  };
}

function finalizeByScore(game) {
  const score = chineseAreaScore(game.board, game.komi);
  game.score = {
    black: score.black,
    white: score.white,
    detail: score.detail,
  };
  game.winner = score.winner === BLACK ? "human" : "ai";
  game.status = "finished";
  game.turn = null;
  game.aiStatus = "idle";
  game.pendingAction = null;
  sessionActiveGame.delete(game.sessionId);
  releaseKataGoSession(game.id);
}

function applyPass(game, player, { rationale = "", model = null, responseId = null } = {}) {
  game.consecutivePasses += 1;
  game.positionHistory.add(boardHash(game.board));
  game.moves.push(
    createMove({
      game,
      player,
      action: "pass",
      rationale,
      model,
      responseId,
    }),
  );
  game.turnVersion += 1;

  if (game.consecutivePasses >= 2) {
    finalizeByScore(game);
    return;
  }

  game.turn = player === "human" ? "ai" : "human";
  game.status = game.turn === "ai" ? "ai_thinking" : "human_turn";
}

function applyResign(game, player, { rationale = "", model = null, responseId = null } = {}) {
  game.moves.push(
    createMove({
      game,
      player,
      action: "resign",
      rationale,
      model,
      responseId,
    }),
  );
  game.turnVersion += 1;
  game.status = "finished";
  game.turn = null;
  game.aiStatus = "idle";
  game.pendingAction = null;
  game.winner = player === "human" ? "ai" : "human";
  sessionActiveGame.delete(game.sessionId);
  releaseKataGoSession(game.id);
}

function applyPlace(game, player, x, y, { rationale = "", model = null, responseId = null } = {}) {
  const color = player === "human" ? BLACK : WHITE;
  const result = tryPlaceStone({
    board: game.board,
    x,
    y,
    color,
    positionHistory: game.positionHistory,
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  game.board = result.board;
  game.positionHistory.add(result.hash);
  game.consecutivePasses = 0;

  if (player === "human") {
    game.captures.human += result.captures;
  } else {
    game.captures.ai += result.captures;
  }

  game.moves.push(
    createMove({
      game,
      player,
      action: "place",
      x,
      y,
      captures: result.captures,
      rationale,
      model,
      responseId,
    }),
  );
  game.turnVersion += 1;
  game.turn = player === "human" ? "ai" : "human";
  game.status = game.turn === "ai" ? "ai_thinking" : "human_turn";

  return { ok: true };
}

function applyPlayerAction(game, player, payload, meta = {}) {
  const action = payload.action;
  if (action === "place") {
    return applyPlace(game, player, payload.x, payload.y, meta);
  }
  if (action === "pass") {
    applyPass(game, player, meta);
    return { ok: true };
  }
  if (action === "resign") {
    applyResign(game, player, meta);
    return { ok: true };
  }
  return { ok: false, reason: "invalid_action" };
}

function createGame({ sessionId, boardSize = DEFAULT_BOARD_SIZE, komi = DEFAULT_KOMI, aiLevel = DEFAULT_AI_LEVEL }) {
  const id = randomUUID();
  const board = createEmptyBoard(boardSize);
  const startHash = boardHash(board);
  const game = {
    id,
    sessionId,
    boardSize,
    komi,
    aiLevel: normalizeAiLevel(aiLevel),
    status: "human_turn",
    winner: null,
    turn: "human",
    turnVersion: 0,
    board,
    positionHistory: new Set([startHash]),
    captures: { human: 0, ai: 0 },
    consecutivePasses: 0,
    score: null,
    pendingAction: null,
    aiStatus: "idle",
    moves: [],
    actionRequests: new Map(),
    aiTurnLogs: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  };

  games.set(id, game);
  sessionActiveGame.set(sessionId, id);
  pruneStores();
  publishGame(game);
  return game;
}

export function createOrGetActiveGame(sessionId, options = {}) {
  const existingId = sessionActiveGame.get(sessionId);
  if (!options.forceNew && existingId) {
    const existing = games.get(existingId);
    if (existing && existing.status !== "finished") {
      return { game: existing, created: false };
    }
  }

  const game = createGame({
    sessionId,
    boardSize: options.boardSize ?? DEFAULT_BOARD_SIZE,
    komi: options.komi ?? DEFAULT_KOMI,
    aiLevel: options.aiLevel ?? DEFAULT_AI_LEVEL,
  });
  return { game, created: true };
}

export function getGame(gameId) {
  return games.get(gameId) ?? null;
}

export function getGameForSession(sessionId, gameId) {
  const game = getGame(gameId);
  if (!game) {
    return { ok: false, error: "not_found" };
  }
  if (game.sessionId !== sessionId) {
    return { ok: false, error: "forbidden" };
  }
  return { ok: true, game };
}

function scheduleAI(gameId, expectedTurnVersion) {
  if (aiInFlight.has(gameId)) {
    return;
  }
  aiInFlight.add(gameId);

  setTimeout(async () => {
    try {
      await runAITurn(gameId, expectedTurnVersion);
    } finally {
      aiInFlight.delete(gameId);
    }
  }, Math.max(0, AI_THINK_DELAY_MS));
}

async function runAITurn(gameId, expectedTurnVersion) {
  const game = games.get(gameId);
  if (!game) {
    return;
  }
  if (game.status !== "ai_thinking" || game.turn !== "ai") {
    return;
  }
  if (game.turnVersion !== expectedTurnVersion) {
    return;
  }

  let retries = 0;
  let externalFailures = 0;
  game.aiStatus = "thinking";
  publishGame(game);

  while (retries <= MAX_AI_RETRIES) {
    const legalPlacements = listLegalPlacements({
      board: game.board,
      color: WHITE,
      positionHistory: game.positionHistory,
    });

    const started = Date.now();
    const candidate = await selectAIMove(game, legalPlacements);
    const elapsed = Date.now() - started;

    if (game.turnVersion !== expectedTurnVersion || game.status !== "ai_thinking") {
      return;
    }

    if (candidate.action === "place") {
      const attempt = applyPlayerAction(
        game,
        "ai",
        { action: "place", x: candidate.x, y: candidate.y },
        {
          rationale: candidate.rationale,
          model: candidate.model,
          responseId: candidate.responseId,
        },
      );

      game.aiTurnLogs.push({
        id: randomUUID(),
        game_id: game.id,
        move_index: game.moves.length,
        model: candidate.model,
        prompt_version: "v1",
        response_id: candidate.responseId,
        retry_count: retries,
        fallback_used: candidate.source === "deterministic",
        latency_ms: elapsed,
        external_error: candidate.externalError ?? null,
        status: attempt.ok ? "applied" : "illegal",
        error_code: attempt.ok ? null : attempt.reason,
        created_at: nowIso(),
      });
      trimArrayHead(game.aiTurnLogs, MAX_AI_TURN_LOGS);

      if (attempt.ok) {
        game.aiStatus = "idle";
        game.pendingAction = null;
        publishGame(game);
        return;
      }

      retries += 1;
      externalFailures += 1;
      game.aiStatus = retries <= MAX_AI_RETRIES ? "retrying" : "failed";
      continue;
    }

    if (candidate.action === "pass" || candidate.action === "resign") {
      applyPlayerAction(game, "ai", { action: candidate.action }, {
        rationale: candidate.rationale,
        model: candidate.model,
        responseId: candidate.responseId,
      });

      game.aiTurnLogs.push({
        id: randomUUID(),
        game_id: game.id,
        move_index: game.moves.length,
        model: candidate.model,
        prompt_version: "v1",
        response_id: candidate.responseId,
        retry_count: retries,
        fallback_used: candidate.source === "deterministic",
        latency_ms: elapsed,
        external_error: candidate.externalError ?? null,
        status: "applied",
        error_code: null,
        created_at: nowIso(),
      });
      trimArrayHead(game.aiTurnLogs, MAX_AI_TURN_LOGS);

      game.aiStatus = "idle";
      game.pendingAction = null;
      publishGame(game);
      return;
    }

    retries += 1;
    externalFailures += 1;
    game.aiStatus = retries <= MAX_AI_RETRIES ? "retrying" : "failed";
  }

  const legalPlacements = listLegalPlacements({
    board: game.board,
    color: WHITE,
    positionHistory: game.positionHistory,
  });
  const fallback = deterministicPolicyMove(game, legalPlacements);

  if (fallback.action === "place") {
    applyPlayerAction(game, "ai", { action: "place", x: fallback.x, y: fallback.y }, {
      rationale: fallback.rationale,
      model: "deterministic-fallback",
      responseId: null,
    });
  } else {
    applyPlayerAction(game, "ai", { action: "pass" }, {
      rationale: fallback.rationale,
      model: "deterministic-fallback",
      responseId: null,
    });
  }

  game.aiTurnLogs.push({
    id: randomUUID(),
    game_id: game.id,
    move_index: game.moves.length,
    model: "deterministic-fallback",
    prompt_version: "v1",
    response_id: null,
    retry_count: retries,
    fallback_used: true,
    latency_ms: 0,
    external_error: `retry_exhausted_${externalFailures}`,
    status: "applied",
    error_code: null,
    created_at: nowIso(),
  });
  trimArrayHead(game.aiTurnLogs, MAX_AI_TURN_LOGS);

  game.aiStatus = "idle";
  game.pendingAction = null;
  publishGame(game);
}

export function submitHumanAction({ sessionId, gameId, action, x, y, actionId, expectedTurnVersion }) {
  const lookup = getGameForSession(sessionId, gameId);
  if (!lookup.ok) {
    return { ok: false, status: lookup.error === "not_found" ? 404 : 403, error: lookup.error };
  }

  const game = lookup.game;

  if (!actionId || typeof actionId !== "string") {
    return { ok: false, status: 400, error: "missing_action_id" };
  }

  if (game.actionRequests.has(actionId)) {
    return { ok: true, status: 200, game: game.actionRequests.get(actionId).response, idempotent: true };
  }

  if (game.status === "finished") {
    return { ok: false, status: 409, error: "game_finished" };
  }
  if (game.turn !== "human" || game.status !== "human_turn") {
    return { ok: false, status: 409, error: "not_human_turn" };
  }

  if (!Number.isInteger(expectedTurnVersion) || expectedTurnVersion !== game.turnVersion) {
    return {
      ok: false,
      status: 409,
      error: "stale_turn_version",
      current_turn_version: game.turnVersion,
    };
  }

  const normalized = { action };
  if (action === "place") {
    normalized.x = x;
    normalized.y = y;
  }

  const result = applyPlayerAction(game, "human", normalized);
  if (!result.ok) {
    return { ok: false, status: 400, error: result.reason };
  }

  if (game.status === "ai_thinking") {
    game.pendingAction = actionId;
    game.aiStatus = "thinking";
  } else {
    game.pendingAction = null;
    game.aiStatus = "idle";
  }

  const response = gameSummary(game);
  game.actionRequests.set(actionId, {
    id: randomUUID(),
    game_id: game.id,
    action_id: actionId,
    expected_turn_version: expectedTurnVersion,
    status: "accepted",
    error_code: null,
    response,
    created_at: nowIso(),
  });
  trimMapOldest(game.actionRequests, MAX_ACTION_REQUESTS);

  publishGame(game);

  if (game.status === "ai_thinking") {
    scheduleAI(game.id, game.turnVersion);
  }

  pruneStores();

  return { ok: true, status: 202, game: response, idempotent: false };
}

export function gameToResponse(game) {
  return gameSummary(game);
}
