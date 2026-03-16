import { BLACK, WHITE, groupLibertyCount, tryPlaceStone } from "../game/rules.js";

function inBounds(board, x, y) {
  return y >= 0 && y < board.length && x >= 0 && x < board.length;
}

function neighbors(board, x, y) {
  return [
    [x, y - 1],
    [x + 1, y],
    [x, y + 1],
    [x - 1, y],
  ].filter(([nx, ny]) => inBounds(board, nx, ny));
}

function stoneColorForPlayer(playerColor) {
  return playerColor === "ai" || playerColor === WHITE ? WHITE : BLACK;
}

function opponent(color) {
  return color === BLACK ? WHITE : BLACK;
}

export function analyzeGoMove({ board, positionHistory, x, y, color = WHITE }) {
  const history = positionHistory instanceof Set ? positionHistory : new Set();
  const result = tryPlaceStone({ board, x, y, color, positionHistory: history });
  if (!result.ok) {
    return null;
  }

  const placedLiberties = groupLibertyCount(result.board, x, y);
  const enemy = opponent(color);
  let adjacentFriendly = 0;
  let adjacentEnemy = 0;
  let adjacentEmpty = 0;
  let enemyGroupsInAtari = 0;
  let friendlyGroupsConnected = 0;

  for (const [nx, ny] of neighbors(board, x, y)) {
    const value = board[ny][nx];
    if (!value) {
      adjacentEmpty += 1;
      continue;
    }
    if (value === color) {
      adjacentFriendly += 1;
      if (groupLibertyCount(result.board, nx, ny) === placedLiberties) {
        friendlyGroupsConnected += 1;
      }
      continue;
    }
    if (value === enemy) {
      adjacentEnemy += 1;
    }
  }

  const seenEnemyGroups = new Set();
  for (const [nx, ny] of neighbors(result.board, x, y)) {
    if (result.board[ny][nx] !== enemy) {
      continue;
    }
    const key = `${nx},${ny}`;
    if (seenEnemyGroups.has(key)) {
      continue;
    }
    if (groupLibertyCount(result.board, nx, ny) === 1) {
      enemyGroupsInAtari += 1;
    }
    seenEnemyGroups.add(key);
  }

  const center = (board.length - 1) / 2;
  const centerDistance = Math.abs(x - center) + Math.abs(y - center);
  const edgeDistance = Math.min(x, y, board.length - 1 - x, board.length - 1 - y);
  const selfAtariRisk = placedLiberties <= 1 ? 1 : 0;

  const heuristicScore =
    result.captures * 30 +
    enemyGroupsInAtari * 14 +
    friendlyGroupsConnected * 8 +
    adjacentFriendly * 3 +
    adjacentEnemy * 2 +
    adjacentEmpty * 1 +
    placedLiberties * 4 +
    edgeDistance * 1.5 -
    centerDistance * 0.6 -
    selfAtariRisk * 20;

  return {
    x,
    y,
    captures: result.captures,
    liberties_after: placedLiberties,
    adjacent_friendly: adjacentFriendly,
    adjacent_enemy: adjacentEnemy,
    adjacent_empty: adjacentEmpty,
    enemy_groups_in_atari: enemyGroupsInAtari,
    friendly_groups_connected: friendlyGroupsConnected,
    edge_distance: edgeDistance,
    center_distance: centerDistance,
    self_atari_risk: Boolean(selfAtariRisk),
    heuristic_score: Number(heuristicScore.toFixed(2)),
  };
}

export function rankGoMoves({ board, positionHistory, legalPlacements, color = WHITE, limit = 12 }) {
  return legalPlacements
    .map((move) => analyzeGoMove({ board, positionHistory, x: move.x, y: move.y, color }))
    .filter(Boolean)
    .sort((a, b) => {
      const scoreDelta = b.heuristic_score - a.heuristic_score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      if (a.y !== b.y) {
        return a.y - b.y;
      }
      return a.x - b.x;
    })
    .slice(0, limit);
}

export function recommendedGoMove(input) {
  return rankGoMoves(input, 1)[0] ?? null;
}
