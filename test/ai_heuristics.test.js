import test from "node:test";
import assert from "node:assert/strict";
import { rankGoMoves, recommendedGoMove } from "../src/ai/heuristics.js";
import { rankChessMoves, recommendedChessMove } from "../src/chess/eval.js";
import { listLegalMoves, parseFen } from "../src/chess/engine.js";

function emptyBoard(size) {
  return Array.from({ length: size }, () => Array(size).fill(null));
}

test("recommendedGoMove prefers capturing a surrounded stone", () => {
  const board = emptyBoard(5);
  board[1][2] = "W";
  board[2][1] = "W";
  board[2][3] = "W";
  board[2][2] = "B";

  const legalPlacements = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      if (!board[y][x]) {
        legalPlacements.push({ x, y });
      }
    }
  }

  const best = recommendedGoMove({
    board,
    positionHistory: new Set(),
    legalPlacements,
    color: "W",
  });

  assert.equal(best.x, 2);
  assert.equal(best.y, 3);
});

test("recommendedChessMove prefers winning the hanging queen", () => {
  const state = parseFen("4r1k1/8/8/8/8/8/4Q3/6K1 b - - 0 1");
  const legalMoves = listLegalMoves(state, "black");
  const best = recommendedChessMove(state, legalMoves, "black");

  assert.equal(best.uci, "e8e2");
});

test("rankChessMoves returns scored candidate list", () => {
  const state = parseFen("rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1");
  const legalMoves = listLegalMoves(state, "black");
  const ranked = rankChessMoves(state, legalMoves, "black", 5);

  assert.equal(ranked.length, 5);
  assert.ok(typeof ranked[0].heuristic_score === "number");
});

test("rankGoMoves returns scored candidate list", () => {
  const board = emptyBoard(5);
  board[2][2] = "W";
  const legalPlacements = [];
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 5; x += 1) {
      if (!board[y][x]) {
        legalPlacements.push({ x, y });
      }
    }
  }

  const ranked = rankGoMoves({
    board,
    positionHistory: new Set(),
    legalPlacements,
    color: "W",
    limit: 5,
  });

  assert.equal(ranked.length, 5);
  assert.ok(typeof ranked[0].heuristic_score === "number");
});
