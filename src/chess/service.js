import * as defaultData from "../data.js";
import {
  applyLegalMove,
  createInitialState,
  findLegalMove,
  isInCheck,
  listLegalMoves,
  parseFen,
  stateToFen,
} from "./engine.js";

let data = defaultData;

export function setChessDataModule(module) {
  data = module;
}

const DEFAULT_AI_LEVEL = "medium";
const AI_LEVELS = new Set(["entry", "medium", "hard"]);
const MAX_MOVES_IN_PAYLOAD = Number.parseInt(process.env.MAX_MOVES_IN_PAYLOAD ?? "160", 10);

export function normalizeChessAiLevel(level) {
  const value = typeof level === "string" ? level.trim().toLowerCase() : "";
  return AI_LEVELS.has(value) ? value : DEFAULT_AI_LEVEL;
}

function getStateForMoves(moves) {
  if (!moves.length) {
    return createInitialState();
  }
  return parseFen(moves[moves.length - 1].board_fen);
}

function formatWinner(winner) {
  if (winner === "human") return "W";
  if (winner === "ai") return "B";
  if (winner === "draw") return "draw";
  return null;
}

function formatGameForApi(gameRecord, moves, state) {
  const moveCount = moves.length;
  const movesTruncated = moveCount > MAX_MOVES_IN_PAYLOAD;
  const movesPayload = movesTruncated ? moves.slice(-MAX_MOVES_IN_PAYLOAD) : moves;
  let lastAiRationale = null;

  for (let i = moves.length - 1; i >= 0; i -= 1) {
    if (moves[i].player === "ai" && moves[i].rationale) {
      lastAiRationale = moves[i].rationale;
      break;
    }
  }

  let resultDetail = null;
  if (gameRecord.result_detail) {
    try {
      resultDetail = JSON.parse(gameRecord.result_detail);
    } catch {}
  }

  return {
    id: gameRecord.id,
    variant: "chess",
    status: gameRecord.status,
    winner: formatWinner(gameRecord.winner),
    turn: state.turn === "white" ? "W" : "B",
    turn_version: gameRecord.turn_version,
    pending_action: gameRecord.pending_action ?? null,
    ai_status: gameRecord.ai_status ?? "idle",
    ai_level: gameRecord.ai_level ?? DEFAULT_AI_LEVEL,
    board: state.board,
    legal_moves:
      gameRecord.status === "human_turn" && state.turn === "white"
        ? listLegalMoves(state, "white").map((move) => ({
            from: move.from,
            to: move.to,
            promotion: move.promotion ?? null,
            notation: move.notation,
            uci: move.uci,
          }))
        : [],
    in_check:
      gameRecord.status !== "finished" ? isInCheck(state, state.turn) : false,
    moves: movesPayload.map((move) => ({
      move_index: move.move_index,
      player: move.player,
      action: move.action,
      from_square: move.from_square ?? null,
      to_square: move.to_square ?? null,
      notation: move.notation ?? null,
      promotion: move.promotion ?? null,
      piece: move.piece ?? null,
      captured_piece: move.captured_piece ?? null,
      board_fen: move.board_fen,
      created_at: move.created_at,
      rationale: move.rationale ?? null,
    })),
    move_count: moveCount,
    moves_truncated: movesTruncated,
    last_ai_rationale: lastAiRationale,
    result_detail: resultDetail,
    fen: stateToFen(state),
  };
}

export async function createChessGame({ sessionId, aiLevel = DEFAULT_AI_LEVEL }) {
  return data.createChessGame({
    session_id: sessionId,
    status: "human_turn",
    winner: null,
    turn_version: 0,
    ai_level: normalizeChessAiLevel(aiLevel),
    pending_action: null,
    ai_status: "idle",
    result_detail: null,
  });
}

export async function getChessGame(gameId) {
  const gameRecord = await data.getChessGameById(gameId);
  if (!gameRecord) {
    return null;
  }

  const moves = await data.getChessMovesByGameId(gameId);
  const state = getStateForMoves(moves);

  return {
    ...gameRecord,
    moves,
    state,
    fen: stateToFen(state),
    turnVersion: gameRecord.turn_version,
    aiLevel: gameRecord.ai_level ?? DEFAULT_AI_LEVEL,
  };
}

export async function getChessGameForApi(gameId) {
  const gameRecord = await data.getChessGameById(gameId);
  if (!gameRecord) {
    return null;
  }
  const moves = await data.getChessMovesByGameId(gameId);
  const state = getStateForMoves(moves);
  return formatGameForApi(gameRecord, moves, state);
}

function normalizePromotion(value) {
  if (typeof value !== "string") {
    return null;
  }
  const promotion = value.trim().toLowerCase();
  return ["q", "r", "b", "n"].includes(promotion) ? promotion : null;
}

export async function applyChessMove(game, move) {
  if (game.status !== "human_turn" && move.player === "human") {
    return { ok: false, reason: "not_your_turn" };
  }
  if (game.status !== "ai_thinking" && move.player === "ai") {
    return { ok: false, reason: "not_ai_turn" };
  }

  const color = move.player === "human" ? "white" : "black";
  if (game.state.turn !== color) {
    return { ok: false, reason: "not_your_turn" };
  }

  if (move.action === "resign") {
    await data.createChessMove({
      game_id: game.id,
      move_index: game.moves.length,
      player: move.player,
      action: "resign",
      from_square: null,
      to_square: null,
      promotion: null,
      piece: null,
      captured_piece: null,
      notation: "resign",
      board_fen: stateToFen(game.state),
      rationale: move.rationale ?? null,
    });

    await data.updateChessGame(game.id, {
      status: "finished",
      winner: move.player === "human" ? "ai" : "human",
      turn_version: game.turn_version + 1,
      ai_status: "done",
      pending_action: null,
      result_detail: JSON.stringify({
        reason: "resign",
      }),
    });

    return { ok: true };
  }

  const legalMove = findLegalMove(game.state, {
    from: move.from,
    to: move.to,
    promotion: normalizePromotion(move.promotion),
    uci: move.uci,
  });

  if (!legalMove) {
    return { ok: false, reason: "illegal_move" };
  }

  const applied = applyLegalMove(game.state, legalMove);
  if (!applied.ok) {
    return { ok: false, reason: applied.reason };
  }

  await data.createChessMove({
    game_id: game.id,
    move_index: game.moves.length,
    player: move.player,
    action: "move",
    from_square: applied.move.from,
    to_square: applied.move.to,
    promotion: applied.move.promotion ?? null,
    piece: applied.move.piece,
    captured_piece: applied.move.capturedPiece ?? null,
    notation: applied.move.notation,
    board_fen: stateToFen(applied.state),
    rationale: move.rationale ?? null,
  });

  let nextStatus = move.player === "human" ? "ai_thinking" : "human_turn";
  let aiStatus = move.player === "human" ? "thinking" : "done";
  let winner = null;
  let resultDetail = null;

  if (applied.gameOver) {
    nextStatus = "finished";
    aiStatus = "done";
    if (applied.gameOver.winner === "white") {
      winner = "human";
    } else if (applied.gameOver.winner === "black") {
      winner = "ai";
    } else {
      winner = "draw";
    }
    resultDetail = JSON.stringify({
      reason: applied.gameOver.outcome,
      winner: applied.gameOver.winner,
      fen: stateToFen(applied.state),
    });
  }

  await data.updateChessGame(game.id, {
    status: nextStatus,
    winner,
    turn_version: game.turn_version + 1,
    ai_status: aiStatus,
    pending_action: null,
    result_detail: resultDetail,
  });

  return { ok: true };
}
