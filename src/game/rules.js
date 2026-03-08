import { GoEngine, BLACK, WHITE } from './engine.js';

export { BLACK, WHITE };

export function createEmptyBoard(size) {
  return new GoEngine(size).board;
}

export function cloneBoard(board) {
  const engine = new GoEngine(board.length);
  engine.board = board.map(row => row.slice());
  return engine.board;
}

export function boardHash(board) {
  const engine = new GoEngine(board.length);
  engine.board = board;
  return engine.getBoardHash();
}

export function tryPlaceStone({ board, x, y, color, positionHistory }) {
  const engine = new GoEngine(board.length);
  engine.board = board;
  engine.history = positionHistory;
  const result = engine.tryPlaceStone(x, y, color);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  return {
    ok: true,
    board: result.engine.board,
    hash: result.engine.getBoardHash(),
    captures: result.captures,
    capturedStones: result.capturedStones,
  };
}

export function listLegalPlacements({ board, color, positionHistory }) {
  const engine = new GoEngine(board.length);
  engine.board = board;
  engine.history = positionHistory;
  return engine.listLegalPlacements(color);
}

export function groupLibertyCount(board, x, y) {
  const engine = new GoEngine(board.length);
  engine.board = board;
  return engine._groupAndLiberties(x, y).liberties.size;
}

export function chineseAreaScore(board, komi = 5.5) {
  const engine = new GoEngine(board.length);
  engine.board = board;
  return engine.chineseAreaScore(komi);
}
