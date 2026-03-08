import test from "node:test";
import assert from "node:assert/strict";
import {
  BLACK,
  WHITE,
  boardHash,
  chineseAreaScore,
  createEmptyBoard,
  tryPlaceStone,
} from "../src/game/rules.js";

test("captures adjacent group with no liberties", () => {
  const board = createEmptyBoard(3);
  board[1][1] = WHITE;
  board[0][1] = BLACK;
  board[1][0] = BLACK;
  board[2][1] = BLACK;

  const history = new Set([boardHash(board)]);
  const result = tryPlaceStone({ board, x: 2, y: 1, color: BLACK, positionHistory: history });

  assert.equal(result.ok, true);
  assert.equal(result.captures, 1);
  assert.equal(result.board[1][1], null);
});

test("rejects suicide move", () => {
  const board = createEmptyBoard(3);
  board[0][1] = BLACK;
  board[1][0] = BLACK;
  board[2][1] = BLACK;
  board[1][2] = BLACK;

  const result = tryPlaceStone({ board, x: 1, y: 1, color: WHITE, positionHistory: new Set([boardHash(board)]) });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "suicide");
});

test("rejects position that violates superko", () => {
  const board = createEmptyBoard(3);
  const first = tryPlaceStone({ board, x: 0, y: 0, color: BLACK, positionHistory: new Set() });
  assert.equal(first.ok, true);

  const history = new Set([first.hash]);
  const second = tryPlaceStone({ board, x: 0, y: 0, color: BLACK, positionHistory: history });

  assert.equal(second.ok, false);
  assert.equal(second.reason, "superko");
});

test("computes chinese area scoring", () => {
  const board = createEmptyBoard(3);
  board[0][0] = BLACK;
  board[0][1] = BLACK;
  board[1][0] = BLACK;
  board[2][2] = WHITE;

  const score = chineseAreaScore(board, 0.5);

  assert.equal(score.winner, BLACK);
  assert.equal(score.black > score.white, true);
  assert.equal(score.detail.stonesBlack, 3);
  assert.equal(score.detail.stonesWhite, 1);
});
