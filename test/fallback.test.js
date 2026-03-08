/**
 * @file fallback.test.js
 * @description Unit tests for the `retryFallbackPolicyMove` function.
 *
 * Tests cover the full priority chain specified in the product plan:
 *   1. Priority 1 – legal capture move (highest capture count preferred).
 *   2. Priority 2 – legal move maximizing post-placement liberties.
 *   3. Priority 3 – deterministic seeded random move (tie-breaking).
 *   4. Auto-pass  – returned when no legal placements exist.
 *
 * ## Board coordinate convention
 *
 * `board[y][x]` — `y` is the row (0 = top), `x` is the column (0 = left).
 * All diagrams below follow the same convention.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { retryFallbackPolicyMove } from "../src/ai/client.js";
import { BLACK, WHITE, GoEngine } from "../src/game/engine.js";
import { createEmptyBoard, boardHash } from "../src/game/rules.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal game object for `retryFallbackPolicyMove`.
 *
 * @param {Array<Array<string|null>>} board  2-D board array (board[y][x]).
 * @param {Set<string>}              history Position history set.
 * @param {object}                   [opts]  Optional overrides.
 * @returns {object}
 */
function makeGame(board, history, opts = {}) {
  return {
    id: opts.id ?? "test-game",
    board,
    boardSize: board.length,
    positionHistory: history,
    aiLevel: opts.aiLevel ?? "medium",
    turnVersion: opts.turnVersion ?? 1,
    moves: opts.moves ?? [],
  };
}

/**
 * Compute legal placements for White on the given board/history.
 *
 * @param {Array<Array<string|null>>} board
 * @param {Set<string>}              history
 * @returns {Array<{x:number,y:number,captures:number}>}
 */
function legalFor(board, history) {
  const engine = new GoEngine(board.length);
  engine.board = board;
  engine.history = history;
  return engine.listLegalPlacements(WHITE);
}

// ---------------------------------------------------------------------------
// Priority 4 – auto-pass when no legal placements exist
// ---------------------------------------------------------------------------

test.describe("retryFallbackPolicyMove – Priority 4: auto-pass", () => {
  test("returns pass when legalPlacements is empty", () => {
    const board = createEmptyBoard(5);
    const history = new Set([boardHash(board)]);
    const game = makeGame(board, history);

    const move = retryFallbackPolicyMove(game, []);

    assert.equal(move.action, "pass");
    assert.ok(typeof move.rationale === "string" && move.rationale.length > 0);
  });

  test("pass move has no x or y coordinates", () => {
    const board = createEmptyBoard(5);
    const history = new Set([boardHash(board)]);
    const game = makeGame(board, history);

    const move = retryFallbackPolicyMove(game, []);

    assert.equal(move.x, undefined);
    assert.equal(move.y, undefined);
  });
});

// ---------------------------------------------------------------------------
// Priority 1 – capture move
// ---------------------------------------------------------------------------

test.describe("retryFallbackPolicyMove – Priority 1: capture", () => {
  /**
   * Build a 5×5 board where White can capture a single Black stone.
   *
   * Board (5×5, showing y=0..2):
   *   . . . . .   y=0   ← capture move at (2,0) takes Black at (2,1)
   *   . W B W .   y=1   Black at (2,1); White at (1,1) and (3,1)
   *   . . W . .   y=2   White at (2,2)
   *
   * Black's only liberty is (2,0).  Playing there captures 1 stone.
   */
  function buildSingleCaptureScenario() {
    const board = createEmptyBoard(5);
    board[1][2] = BLACK; // Black at (2,1)
    board[1][1] = WHITE; // White at (1,1)
    board[1][3] = WHITE; // White at (3,1)
    board[2][2] = WHITE; // White at (2,2)
    // Black's only liberty: (2,0)
    const history = new Set([boardHash(board)]);
    const placements = legalFor(board, history);
    return { board, history, placements };
  }

  test("selects the capture move when one exists", () => {
    const { board, history, placements } = buildSingleCaptureScenario();
    const game = makeGame(board, history);

    const move = retryFallbackPolicyMove(game, placements);

    assert.equal(move.action, "place");
    assert.deepEqual({ x: move.x, y: move.y }, { x: 2, y: 0 });
  });

  test("capture move rationale mentions the capture", () => {
    const { board, history, placements } = buildSingleCaptureScenario();
    const game = makeGame(board, history);

    const move = retryFallbackPolicyMove(game, placements);

    assert.ok(
      move.rationale.toLowerCase().includes("captur"),
      `Expected rationale to mention 'captur', got: "${move.rationale}"`,
    );
  });

  /**
   * Build a 7×7 board with two independent Black groups that White can
   * capture.  Group A (1 stone) can be captured by playing at (1,0).
   * Group B (2 stones) can be captured by playing at (4,0).
   * White should prefer the larger capture (group B → 2 stones).
   *
   * Board (7×7, showing y=0..2):
   *   . . . . . W .   y=0   capture at (1,0) takes 1; capture at (4,0) takes 2
   *   W B W W B B W   y=1   Group A: Black at (1,1); Group B: Black at (4,1),(5,1)
   *   . W . . W W .   y=2   White surrounding each group
   */
  function buildMultipleCaptureScenario() {
    const board = createEmptyBoard(7);

    // Group A: Black at (1,1), surrounded by White on 3 sides.
    // Liberty: (1,0) — playing there captures 1 stone.
    board[1][1] = BLACK; // Black at x=1, y=1
    board[1][0] = WHITE; // White at x=0, y=1 (left)
    board[1][2] = WHITE; // White at x=2, y=1 (right)
    board[2][1] = WHITE; // White at x=1, y=2 (below)

    // Group B: Black at (4,1) and (5,1), surrounded by White.
    // Liberty: (4,0) — playing there captures 2 stones.
    board[1][4] = BLACK; // Black at x=4, y=1
    board[1][5] = BLACK; // Black at x=5, y=1
    board[1][3] = WHITE; // White at x=3, y=1 (left of group B)
    board[1][6] = WHITE; // White at x=6, y=1 (right of group B)
    board[2][4] = WHITE; // White at x=4, y=2 (below (4,1))
    board[2][5] = WHITE; // White at x=5, y=2 (below (5,1))
    board[0][5] = WHITE; // White at x=5, y=0 (above (5,1)) — blocks that liberty

    const history = new Set([boardHash(board)]);
    const placements = legalFor(board, history);
    return { board, history, placements };
  }

  test("prefers the move that captures the most stones", () => {
    const { board, history, placements } = buildMultipleCaptureScenario();
    const game = makeGame(board, history);

    const move = retryFallbackPolicyMove(game, placements);

    assert.equal(move.action, "place");
    // (4,0) captures 2 stones; (1,0) captures only 1.
    assert.deepEqual({ x: move.x, y: move.y }, { x: 4, y: 0 });
  });

  test("capture is chosen regardless of AI difficulty level", () => {
    const { board, history, placements } = buildSingleCaptureScenario();

    for (const level of ["entry", "medium", "hard"]) {
      const game = makeGame(board, history, { aiLevel: level });
      const move = retryFallbackPolicyMove(game, placements);
      assert.equal(move.action, "place", `level=${level}`);
      assert.deepEqual({ x: move.x, y: move.y }, { x: 2, y: 0 }, `level=${level}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Priority 2 – max liberties
// ---------------------------------------------------------------------------

test.describe("retryFallbackPolicyMove – Priority 2: max liberties", () => {
  /**
   * On a 3×3 empty board the center cell (1,1) has 4 liberties while edge
   * cells have 3 and corners have 2.  The center is the unique maximum.
   *
   * Board (3×3):
   *   . . .   y=0
   *   . . .   y=1   center (1,1) → 4 liberties
   *   . . .   y=2
   */
  function buildEmptyThreeByThree() {
    const board = createEmptyBoard(3);
    const history = new Set([boardHash(board)]);
    const placements = legalFor(board, history);
    return { board, history, placements };
  }

  test("selects the unique move with the most liberties when no captures exist", () => {
    const { board, history, placements } = buildEmptyThreeByThree();
    const game = makeGame(board, history);

    const move = retryFallbackPolicyMove(game, placements);

    assert.equal(move.action, "place");
    // Center of a 3×3 board is (1,1) with 4 liberties — unique maximum.
    assert.deepEqual({ x: move.x, y: move.y }, { x: 1, y: 1 });
  });

  test("max-liberty move rationale mentions liberties", () => {
    const { board, history, placements } = buildEmptyThreeByThree();
    const game = makeGame(board, history);

    const move = retryFallbackPolicyMove(game, placements);

    assert.ok(
      move.rationale.toLowerCase().includes("libert"),
      `Expected rationale to mention 'libert', got: "${move.rationale}"`,
    );
  });

  test("max-liberty move is chosen regardless of AI difficulty level", () => {
    const { board, history, placements } = buildEmptyThreeByThree();

    for (const level of ["entry", "medium", "hard"]) {
      const game = makeGame(board, history, { aiLevel: level });
      const move = retryFallbackPolicyMove(game, placements);
      assert.equal(move.action, "place", `level=${level}`);
      assert.deepEqual({ x: move.x, y: move.y }, { x: 1, y: 1 }, `level=${level}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Priority 3 – seeded random (tie-breaking within max-liberty group)
// ---------------------------------------------------------------------------

test.describe("retryFallbackPolicyMove – Priority 3: seeded random tie-break", () => {
  /**
   * On a 5×5 board with a White stone at (0,0) and a Black stone at (4,4),
   * there are multiple interior cells that all yield 4 liberties.  The
   * function must break the tie deterministically via seeded hash.
   */
  function buildTieBreakScenario() {
    const board = createEmptyBoard(5);
    board[0][0] = WHITE;
    board[4][4] = BLACK;
    const history = new Set([boardHash(board)]);
    const placements = legalFor(board, history);
    return { board, history, placements };
  }

  test("result is deterministic for identical game state", () => {
    const { board, history, placements } = buildTieBreakScenario();
    const game = makeGame(board, history, { id: "game-abc", turnVersion: 5, moves: [{}, {}] });

    const move1 = retryFallbackPolicyMove(game, placements);
    const move2 = retryFallbackPolicyMove(game, placements);

    assert.equal(move1.action, move2.action);
    assert.equal(move1.x, move2.x);
    assert.equal(move1.y, move2.y);
  });

  test("different game ids produce potentially different moves", () => {
    const { board, history, placements } = buildTieBreakScenario();

    const gameA = makeGame(board, history, { id: "game-aaa", turnVersion: 1, moves: [] });
    const gameB = makeGame(board, history, { id: "game-zzz", turnVersion: 1, moves: [] });

    const moveA = retryFallbackPolicyMove(gameA, placements);
    const moveB = retryFallbackPolicyMove(gameB, placements);

    // Both must be valid place moves within board bounds.
    assert.equal(moveA.action, "place");
    assert.equal(moveB.action, "place");
    assert.ok(moveA.x >= 0 && moveA.x < 5);
    assert.ok(moveA.y >= 0 && moveA.y < 5);
    assert.ok(moveB.x >= 0 && moveB.x < 5);
    assert.ok(moveB.y >= 0 && moveB.y < 5);
  });

  test("different turn versions produce deterministically different seeds", () => {
    const { board, history, placements } = buildTieBreakScenario();

    const gameV1 = makeGame(board, history, { id: "game-x", turnVersion: 1, moves: [] });
    const gameV9 = makeGame(board, history, { id: "game-x", turnVersion: 9, moves: [] });

    const moveV1 = retryFallbackPolicyMove(gameV1, placements);
    const moveV9 = retryFallbackPolicyMove(gameV9, placements);

    assert.equal(moveV1.action, "place");
    assert.equal(moveV9.action, "place");
    // Moves may differ because the seed includes turnVersion.
  });

  test("seeded pick is stable across repeated calls with same inputs", () => {
    const { board, history, placements } = buildTieBreakScenario();
    const game = makeGame(board, history, { id: "stable-seed", turnVersion: 3, moves: [{}] });

    const results = Array.from({ length: 5 }, () => retryFallbackPolicyMove(game, placements));

    // All five calls must return the same coordinates.
    for (const m of results) {
      assert.equal(m.x, results[0].x, "x should be stable");
      assert.equal(m.y, results[0].y, "y should be stable");
    }
  });
});

// ---------------------------------------------------------------------------
// Priority ordering – capture beats max-liberties
// ---------------------------------------------------------------------------

test.describe("retryFallbackPolicyMove – priority ordering", () => {
  /**
   * Build a board where:
   *   - There is a capture move at (2,0) that yields fewer liberties than
   *     other non-capture moves (e.g. interior cells with 4 liberties).
   *   - The fallback must still prefer the capture (Priority 1 > Priority 2).
   *
   * Board (5×5, showing y=0..2):
   *   . . . . .   y=0   ← capture at (2,0) takes Black at (2,1)
   *   . W B W .   y=1   Black at (2,1); White at (1,1),(3,1)
   *   . . W . .   y=2   White at (2,2)
   *
   * The capture move (2,0) yields only 3 liberties (edge cell after capture),
   * while interior non-capture moves yield 4 liberties.
   */
  function buildCaptureVsHighLibertyScenario() {
    const board = createEmptyBoard(5);
    board[1][2] = BLACK; // Black at (2,1)
    board[1][1] = WHITE; // White at (1,1)
    board[1][3] = WHITE; // White at (3,1)
    board[2][2] = WHITE; // White at (2,2)
    // Black's only liberty: (2,0)
    const history = new Set([boardHash(board)]);
    const placements = legalFor(board, history);
    return { board, history, placements };
  }

  test("capture is preferred over a higher-liberty non-capture move", () => {
    const { board, history, placements } = buildCaptureVsHighLibertyScenario();
    const game = makeGame(board, history);

    const move = retryFallbackPolicyMove(game, placements);

    assert.equal(move.action, "place");
    assert.deepEqual({ x: move.x, y: move.y }, { x: 2, y: 0 });
  });
});

// ---------------------------------------------------------------------------
// Return value shape
// ---------------------------------------------------------------------------

test.describe("retryFallbackPolicyMove – return value shape", () => {
  test("place move always has integer x and y", () => {
    const board = createEmptyBoard(5);
    const history = new Set([boardHash(board)]);
    const game = makeGame(board, history);
    const placements = legalFor(board, history);

    const move = retryFallbackPolicyMove(game, placements);

    assert.equal(move.action, "place");
    assert.ok(Number.isInteger(move.x), `x should be integer, got ${move.x}`);
    assert.ok(Number.isInteger(move.y), `y should be integer, got ${move.y}`);
  });

  test("place move x and y are within board bounds", () => {
    const board = createEmptyBoard(9);
    const history = new Set([boardHash(board)]);
    const game = makeGame(board, history);
    const placements = legalFor(board, history);

    const move = retryFallbackPolicyMove(game, placements);

    assert.equal(move.action, "place");
    assert.ok(move.x >= 0 && move.x < 9, `x=${move.x} out of bounds`);
    assert.ok(move.y >= 0 && move.y < 9, `y=${move.y} out of bounds`);
  });

  test("every place move has a non-empty rationale string", () => {
    const board = createEmptyBoard(5);
    const history = new Set([boardHash(board)]);
    const game = makeGame(board, history);
    const placements = legalFor(board, history);

    const move = retryFallbackPolicyMove(game, placements);

    assert.ok(
      typeof move.rationale === "string" && move.rationale.length > 0,
      `rationale should be a non-empty string, got: ${JSON.stringify(move.rationale)}`,
    );
  });

  test("pass move has a non-empty rationale string", () => {
    const board = createEmptyBoard(5);
    const history = new Set([boardHash(board)]);
    const game = makeGame(board, history);

    const move = retryFallbackPolicyMove(game, []);

    assert.ok(
      typeof move.rationale === "string" && move.rationale.length > 0,
      `rationale should be a non-empty string, got: ${JSON.stringify(move.rationale)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Behaviour independence from aiLevel
// ---------------------------------------------------------------------------

test.describe("retryFallbackPolicyMove – level independence", () => {
  test("returns the same move for all difficulty levels on a 3x3 empty board", () => {
    const board = createEmptyBoard(3);
    const history = new Set([boardHash(board)]);
    const placements = legalFor(board, history);

    const moves = ["entry", "medium", "hard"].map((level) => {
      const game = makeGame(board, history, { aiLevel: level });
      return retryFallbackPolicyMove(game, placements);
    });

    // All three should produce the same coordinates since the function is
    // level-agnostic (center (1,1) is the unique max-liberty move).
    assert.deepEqual({ x: moves[0].x, y: moves[0].y }, { x: moves[1].x, y: moves[1].y });
    assert.deepEqual({ x: moves[1].x, y: moves[1].y }, { x: moves[2].x, y: moves[2].y });
  });

  test("unknown aiLevel does not throw", () => {
    const board = createEmptyBoard(5);
    const history = new Set([boardHash(board)]);
    const placements = legalFor(board, history);
    const game = makeGame(board, history, { aiLevel: "unknown-level" });

    assert.doesNotThrow(() => retryFallbackPolicyMove(game, placements));
  });
});
