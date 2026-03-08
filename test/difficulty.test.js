import test from "node:test";
import assert from "node:assert/strict";
import { deterministicPolicyMove } from "../src/ai/client.js";
import { BLACK, WHITE, GoEngine } from "../src/game/engine.js";
import { createEmptyBoard, boardHash } from "../src/game/rules.js";
import { normalizeAiLevel } from "../src/game/service.js";

function buildCaptureScenario() {
  const board = createEmptyBoard(5);

  // Black group with one liberty at (3,2). White can capture by playing there.
  board[2][2] = BLACK;
  board[1][2] = WHITE;
  board[2][1] = WHITE;
  board[3][2] = WHITE;

  const history = new Set([boardHash(board)]);
  const engine = new GoEngine(board.length);
  engine.board = board;
  engine.history = history;
  const legalPlacements = engine.listLegalPlacements(WHITE);

  return { board, history, legalPlacements };
}

function makeGame(level, board, history) {
  return {
    id: "test-game",
    board,
    boardSize: board.length,
    positionHistory: history,
    aiLevel: level,
    turnVersion: 7,
    moves: [{ action: "place", x: 0, y: 0 }],
  };
}

test("hard level prefers tactical capture", () => {
  const { board, history, legalPlacements } = buildCaptureScenario();
  const game = makeGame("hard", board, history);

  const move = deterministicPolicyMove(game, legalPlacements);

  assert.equal(move.action, "place");
  assert.deepEqual({ x: move.x, y: move.y }, { x: 3, y: 2 });
});

test("entry level avoids immediate capture in same position", () => {
  const { board, history, legalPlacements } = buildCaptureScenario();
  const game = makeGame("entry", board, history);

  const move = deterministicPolicyMove(game, legalPlacements);

  assert.equal(move.action, "place");
  assert.notDeepEqual({ x: move.x, y: move.y }, { x: 3, y: 2 });
});

test("normalizeAiLevel falls back to medium", () => {
  assert.equal(normalizeAiLevel("entry"), "entry");
  assert.equal(normalizeAiLevel("hard"), "hard");
  assert.equal(normalizeAiLevel("unknown"), "medium");
  assert.equal(normalizeAiLevel(undefined), "medium");
});
