import { applyLegalMove, isInCheck, listLegalMoves, oppositeColor, squareToCoords } from "./engine.js";

const PIECE_VALUES = {
  p: 1,
  n: 3,
  b: 3.25,
  r: 5,
  q: 9,
  k: 0,
};

function pieceValue(piece) {
  if (!piece) return 0;
  return PIECE_VALUES[piece.toLowerCase()] ?? 0;
}

function centerDistance(square) {
  const coords = squareToCoords(square);
  if (!coords) return 99;
  return Math.abs(coords.x - 3.5) + Math.abs(coords.y - 3.5);
}

function materialBalance(state) {
  let white = 0;
  let black = 0;
  for (const row of state.board) {
    for (const piece of row) {
      if (!piece) continue;
      if (piece === piece.toUpperCase()) {
        white += pieceValue(piece);
      } else {
        black += pieceValue(piece);
      }
    }
  }
  return { white, black, balanceForBlack: black - white };
}

function attackedSquares(state, color) {
  const attacks = new Set();
  for (const move of listLegalMoves(state, color)) {
    attacks.add(move.to);
  }
  return attacks;
}

export function analyzeChessMove(state, move, color = state.turn) {
  const applied = applyLegalMove(state, move);
  if (!applied.ok) {
    return null;
  }

  const nextState = applied.state;
  const enemy = oppositeColor(color);
  const material = materialBalance(nextState);
  const enemyMoves = listLegalMoves(nextState, enemy);
  const enemyAttackSet = new Set(enemyMoves.map((candidate) => candidate.to));
  const friendlyAttackSet = attackedSquares(nextState, color);
  const givesCheck = isInCheck(nextState, enemy);
  const captureValue = pieceValue(applied.move.capturedPiece);
  const moverValue = pieceValue(applied.move.piece);
  const movingPiece = applied.move.piece.toLowerCase();
  const destinationAttacked = enemyAttackSet.has(applied.move.to);
  const destinationDefended = friendlyAttackSet.has(applied.move.to);
  const developedPiece = ["n", "b"].includes(movingPiece) ? 1 : 0;
  const castleBonus = applied.move.castle ? 2.5 : 0;
  const promotionBonus = applied.move.promotion ? 7 : 0;
  const centrality = 4 - Math.min(centerDistance(applied.move.to), 4);
  const openingPhase = state.fullmoveNumber <= 10 ? 1 : 0;
  const pieceDevelopmentBonus =
    movingPiece === "n" ? 3.5 : movingPiece === "b" ? 2.5 : movingPiece === "p" ? 0.8 : 0;
  const earlyHeavyPiecePenalty = openingPhase && ["q", "r", "k"].includes(movingPiece) ? 3 : 0;

  const heuristicScore =
    material.balanceForBlack * 3 +
    captureValue * 4 -
    moverValue * (destinationAttacked && !destinationDefended ? 2.5 : 0) +
    (givesCheck ? 3 : 0) +
    centrality * (movingPiece === "p" ? 0.7 : 1.3) +
    developedPiece * 1.5 +
    pieceDevelopmentBonus +
    castleBonus +
    promotionBonus -
    earlyHeavyPiecePenalty;

  return {
    uci: applied.move.uci,
    notation: applied.move.notation,
    from: applied.move.from,
    to: applied.move.to,
    captures: Boolean(applied.move.capturedPiece),
    captured_piece: applied.move.capturedPiece ?? null,
    capture_value: captureValue,
    gives_check: givesCheck,
    destination_attacked: destinationAttacked,
    destination_defended: destinationDefended,
    centrality: Number(centrality.toFixed(2)),
    material_balance_for_black: Number(material.balanceForBlack.toFixed(2)),
    heuristic_score: Number(heuristicScore.toFixed(2)),
  };
}

export function rankChessMoves(state, legalMoves, color = state.turn, limit = 12) {
  return legalMoves
    .map((move) => analyzeChessMove(state, move, color))
    .filter(Boolean)
    .sort((a, b) => {
      const scoreDelta = b.heuristic_score - a.heuristic_score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return a.uci.localeCompare(b.uci);
    })
    .slice(0, limit);
}

export function recommendedChessMove(state, legalMoves, color = state.turn) {
  return rankChessMoves(state, legalMoves, color, 1)[0] ?? null;
}
