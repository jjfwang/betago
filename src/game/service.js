/**
 * @fileoverview Stateless game service for orchestrating game logic.
 *
 * This module provides functions for creating, retrieving, and updating game
 * state by interacting with the database and the rule engine. It is designed
 * to be stateless, meaning that all necessary game data is loaded from the
 * database for each operation.
 */

import * as defaultData from '../data.js';

/**
 * The active data module.  Defaults to the real data module but can be
 * overridden in tests via `setDataModule()`.
 * @type {object}
 */
let data = defaultData;

/**
 * Override the data module used by this service.
 * Intended for use in integration tests that inject an in-memory database.
 * @param {object} module  A data module with the same API as `../data.js`.
 */
export function setDataModule(module) {
  data = module;
}

import {
  BLACK,
  WHITE,
  boardHash,
  createEmptyBoard,
  listLegalPlacements,
  tryPlaceStone,
  chineseAreaScore,
} from './rules.js';

const DEFAULT_BOARD_SIZE = 9;
const DEFAULT_KOMI = 5.5;
const DEFAULT_AI_LEVEL = 'medium';
const AI_LEVELS = new Set(['entry', 'medium', 'hard']);
const MAX_MOVES_IN_PAYLOAD = Number.parseInt(process.env.MAX_MOVES_IN_PAYLOAD ?? '160', 10);

/** The Go board alphabet, which skips the letter 'I'. */
const BOARD_ALPHABET = 'ABCDEFGHJKLMNOPQRST';

/**
 * Normalizes an AI level string to one of the valid levels.
 * @param {string|undefined} level The raw AI level value.
 * @returns {'entry'|'medium'|'hard'} The normalized AI level.
 */
export function normalizeAiLevel(level) {
  const value = typeof level === 'string' ? level.trim().toLowerCase() : '';
  return AI_LEVELS.has(value) ? value : DEFAULT_AI_LEVEL;
}

/**
 * Converts a coordinate label (e.g., 'D4') to an {x, y} object.
 * @param {string} label The coordinate label.
 * @param {number} size The board size.
 * @returns {{x: number, y: number}|null} The {x, y} coordinates or null if invalid.
 */
function fromCoordinateLabel(label, size) {
  if (!label || typeof label !== 'string' || label.length < 2) {
    return null;
  }
  const alphabet = BOARD_ALPHABET;
  const letter = label.charAt(0).toUpperCase();
  const number = parseInt(label.slice(1), 10);
  const x = alphabet.indexOf(letter);
  if (x === -1 || isNaN(number)) {
    return null;
  }
  const y = size - number;
  return { x, y };
}

/**
 * Hydrates board state from a list of moves.
 * @param {object} gameRecord  Raw row from the games table.
 * @param {Array}  moves       Ordered move rows.
 * @returns {object}
 */
export function hydrateBoard(gameRecord, moves) {
  let board = createEmptyBoard(gameRecord.board_size);
  const positionHistory = new Set([boardHash(board)]);
  const captures = { human: 0, ai: 0 };
  let consecutivePasses = 0;

  for (const move of moves) {
    if (move.action === 'place') {
      consecutivePasses = 0;
      const color = move.player === 'human' ? BLACK : WHITE;
      const coords = fromCoordinateLabel(move.coordinate, gameRecord.board_size);

      if (coords) {
        const result = tryPlaceStone({
          board,
          x: coords.x,
          y: coords.y,
          color,
          positionHistory,
        });

        if (result.ok) {
          board = result.board;
          positionHistory.add(result.hash);
          if (move.player === 'human') {
            captures.human += result.captures;
          } else {
            captures.ai += result.captures;
          }
        }
      }
    } else if (move.action === 'pass') {
      consecutivePasses++;
    }
  }

  return { board, positionHistory, captures, consecutivePasses };
}

/**
 * Formats a raw game record + hydrated state into the full API response shape
 * expected by the frontend.
 *
 * @param {object} gameRecord  Raw row from the games table.
 * @param {Array}  moves       Full ordered move list.
 * @param {object} hydrated    Result of hydrateBoard().
 * @returns {object}           API-ready game object.
 */
function formatGameForApi(gameRecord, moves, hydrated) {
  const { board, positionHistory, captures } = hydrated;

  // Determine whose turn it is (human = B, ai = W).
  const turn = moves.length % 2 === 0 ? 'B' : 'W';

  // Compute legal placements for the human player (only when it is their turn).
  let legalMoves = [];
  if (gameRecord.status === 'human_turn') {
    legalMoves = listLegalPlacements({
      board,
      color: BLACK,
      positionHistory,
    }).map(({ x, y }) => ({ x, y }));
  }

  // Truncate move list if it exceeds the payload cap.
  const moveCount = moves.length;
  const movesTruncated = moveCount > MAX_MOVES_IN_PAYLOAD;
  const movesPayload = movesTruncated ? moves.slice(-MAX_MOVES_IN_PAYLOAD) : moves;

  // Find the last AI rationale.
  let lastAiRationale = null;
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].player === 'ai' && moves[i].rationale) {
      lastAiRationale = moves[i].rationale;
      break;
    }
  }

  // Parse score_detail if present.
  let scoreDetail = null;
  if (gameRecord.score_detail) {
    try {
      scoreDetail = JSON.parse(gameRecord.score_detail);
    } catch {
      // ignore malformed JSON
    }
  }

  // Map winner from internal ('human'/'ai') to stone colour ('B'/'W').
  let winner = null;
  if (gameRecord.winner === 'human') {
    winner = 'B';
  } else if (gameRecord.winner === 'ai') {
    winner = 'W';
  }

  return {
    id: gameRecord.id,
    board_size: gameRecord.board_size,
    komi: gameRecord.komi,
    ai_level: gameRecord.ai_level ?? DEFAULT_AI_LEVEL,
    status: gameRecord.status,
    winner,
    turn,
    turn_version: gameRecord.turn_version,
    pending_action: gameRecord.pending_action ?? null,
    ai_status: gameRecord.ai_status ?? 'idle',
    captures: {
      B: captures.human,
      W: captures.ai,
    },
    board,
    legal_moves: legalMoves,
    moves: movesPayload,
    move_count: moveCount,
    moves_truncated: movesTruncated,
    last_ai_rationale: lastAiRationale,
    score_detail: scoreDetail,
  };
}

/**
 * Hydrates a full game state from the database.
 * Returns the internal game object (not the API shape).
 *
 * @param {string} gameId The ID of the game to load.
 * @returns {Promise<object|null>}
 */
export async function getGame(gameId) {
  const gameRecord = await data.getGameById(gameId);
  if (!gameRecord) {
    return null;
  }

  const moves = await data.getMovesByGameId(gameId);
  const hydrated = hydrateBoard(gameRecord, moves);

  return {
    ...gameRecord,
    board: hydrated.board,
    moves,
    positionHistory: hydrated.positionHistory,
    captures: hydrated.captures,
    consecutivePasses: hydrated.consecutivePasses,
    turn: moves.length % 2 === 0 ? 'human' : 'ai',
    // Camel-cased aliases used by the AI client.
    boardSize: gameRecord.board_size,
    aiLevel: gameRecord.ai_level ?? DEFAULT_AI_LEVEL,
    turnVersion: gameRecord.turn_version,
  };
}

/**
 * Returns the full API-ready game payload for a game id.
 *
 * @param {string} gameId
 * @returns {Promise<object|null>}
 */
export async function getGameForApi(gameId) {
  const gameRecord = await data.getGameById(gameId);
  if (!gameRecord) {
    return null;
  }
  const moves = await data.getMovesByGameId(gameId);
  const hydrated = hydrateBoard(gameRecord, moves);
  return formatGameForApi(gameRecord, moves, hydrated);
}

/**
 * Creates a new game and stores it in the database.
 * @param {object} options
 * @param {string} options.sessionId The session ID of the user creating the game.
 * @param {number} [options.boardSize=18] The board size.
 * @param {number} [options.komi=5.5] The komi.
 * @returns {Promise<object>} A promise that resolves to the newly created game object.
 */
export async function createGame({
  sessionId,
  boardSize = DEFAULT_BOARD_SIZE,
  komi = DEFAULT_KOMI,
  aiLevel = DEFAULT_AI_LEVEL,
}) {
  const gameData = {
    session_id: sessionId,
    board_size: boardSize,
    komi,
    ai_level: normalizeAiLevel(aiLevel),
    status: 'human_turn',
    ai_status: 'idle',
    pending_action: null,
    turn_version: 0,
  };
  const game = await data.createGame(gameData);
  return game;
}

/**
 * Applies a player's move to the game state.
 * @param {object} game The current game state.
 * @param {object} move The move to apply.
 * @param {string} move.player The player making the move ("human" or "ai").
 * @param {string} move.action The action to perform ("place", "pass", or "resign").
 * @param {number} [move.x] The x-coordinate for a "place" action.
 * @param {number} [move.y] The y-coordinate for a "place" action.
 * @returns {Promise<{ok: boolean, reason?: string}>} A promise that resolves to an object indicating success or failure.
 */
export async function applyMove(game, move) {
  if (game.status !== 'human_turn' && move.player === 'human') {
    return { ok: false, reason: 'not_your_turn' };
  }
  if (game.status !== 'ai_thinking' && move.player === 'ai') {
    return { ok: false, reason: 'not_ai_turn' };
  }

  let result;
  if (move.action === 'place') {
    const color = move.player === 'human' ? BLACK : WHITE;
    result = tryPlaceStone({
      board: game.board,
      x: move.x,
      y: move.y,
      color,
      positionHistory: game.positionHistory,
    });

    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }

    await data.createMove({
      game_id: game.id,
      move_index: game.moves.length,
      player: move.player,
      action: 'place',
      coordinate: `${BOARD_ALPHABET[move.x] ?? '?'}${game.board_size - move.y}`,
      captures: result.captures,
      board_hash: result.hash,
      rationale: move.rationale ?? null,
    });

    const nextTurn = move.player === 'human' ? 'ai_thinking' : 'human_turn';
    const aiStatus = move.player === 'human' ? 'thinking' : 'done';
    await data.updateGame(game.id, {
      status: nextTurn,
      turn_version: game.turn_version + 1,
      ai_status: aiStatus,
      pending_action: null,
    });

  } else if (move.action === 'pass') {
    await data.createMove({
      game_id: game.id,
      move_index: game.moves.length,
      player: move.player,
      action: 'pass',
      captures: 0,
      board_hash: boardHash(game.board),
      rationale: move.rationale ?? null,
    });

    if (game.consecutivePasses + 1 >= 2) {
      const score = chineseAreaScore(game.board, game.komi);
      const winner = score.winner === BLACK ? 'human' : 'ai';
      await data.updateGame(game.id, {
        status: 'finished',
        winner,
        turn_version: game.turn_version + 1,
        ai_status: 'done',
        pending_action: null,
        score_detail: JSON.stringify(score.detail),
      });
    } else {
      const nextTurn = move.player === 'human' ? 'ai_thinking' : 'human_turn';
      const aiStatus = move.player === 'human' ? 'thinking' : 'done';
      await data.updateGame(game.id, {
        status: nextTurn,
        turn_version: game.turn_version + 1,
        ai_status: aiStatus,
        pending_action: null,
      });
    }
  } else if (move.action === 'resign') {
    await data.createMove({
      game_id: game.id,
      move_index: game.moves.length,
      player: move.player,
      action: 'resign',
      captures: 0,
      board_hash: boardHash(game.board),
      rationale: move.rationale ?? null,
    });

    const winner = move.player === 'human' ? 'ai' : 'human';
    await data.updateGame(game.id, {
      status: 'finished',
      winner,
      turn_version: game.turn_version + 1,
      ai_status: 'done',
      pending_action: null,
    });
  }

  return { ok: true };
}
