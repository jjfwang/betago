export const BLACK = "B";
export const WHITE = "W";

export function opposite(color) {
  return color === BLACK ? WHITE : BLACK;
}

export function createEmptyBoard(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function isOnBoard(board, x, y) {
  return y >= 0 && y < board.length && x >= 0 && x < board.length;
}

export function getNeighbors(board, x, y) {
  const candidates = [
    [x, y - 1],
    [x + 1, y],
    [x, y + 1],
    [x - 1, y],
  ];
  return candidates.filter(([nx, ny]) => isOnBoard(board, nx, ny));
}

function groupAndLiberties(board, x, y) {
  const color = board[y][x];
  if (!color) {
    return { group: [], liberties: new Set() };
  }

  const seen = new Set();
  const stack = [[x, y]];
  const group = [];
  const liberties = new Set();

  while (stack.length) {
    const [cx, cy] = stack.pop();
    const key = `${cx},${cy}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    group.push([cx, cy]);

    for (const [nx, ny] of getNeighbors(board, cx, cy)) {
      const neighbor = board[ny][nx];
      if (!neighbor) {
        liberties.add(`${nx},${ny}`);
      } else if (neighbor === color && !seen.has(`${nx},${ny}`)) {
        stack.push([nx, ny]);
      }
    }
  }

  return { group, liberties };
}

export function groupLibertyCount(board, x, y) {
  return groupAndLiberties(board, x, y).liberties.size;
}

function removeGroup(board, group) {
  for (const [x, y] of group) {
    board[y][x] = null;
  }
}

export function boardHash(board) {
  return board.map((row) => row.map((cell) => cell ?? ".").join("")).join("|");
}

export function tryPlaceStone({ board, x, y, color, positionHistory }) {
  if (!isOnBoard(board, x, y)) {
    return { ok: false, reason: "out_of_bounds" };
  }
  if (board[y][x] !== null) {
    return { ok: false, reason: "occupied" };
  }

  const next = cloneBoard(board);
  next[y][x] = color;

  const capturedStones = [];
  for (const [nx, ny] of getNeighbors(next, x, y)) {
    if (next[ny][nx] !== opposite(color)) {
      continue;
    }
    const oppInfo = groupAndLiberties(next, nx, ny);
    if (oppInfo.liberties.size === 0) {
      capturedStones.push(...oppInfo.group);
      removeGroup(next, oppInfo.group);
    }
  }

  const ownInfo = groupAndLiberties(next, x, y);
  if (ownInfo.liberties.size === 0) {
    return { ok: false, reason: "suicide" };
  }

  const hash = boardHash(next);
  if (positionHistory?.has(hash)) {
    return { ok: false, reason: "superko" };
  }

  return {
    ok: true,
    board: next,
    hash,
    captures: capturedStones.length,
    capturedStones,
  };
}

export function listLegalPlacements({ board, color, positionHistory }) {
  const legal = [];
  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board.length; x += 1) {
      const result = tryPlaceStone({ board, x, y, color, positionHistory });
      if (result.ok) {
        legal.push({ x, y, captures: result.captures });
      }
    }
  }
  return legal;
}

function countStones(board) {
  let black = 0;
  let white = 0;
  for (const row of board) {
    for (const cell of row) {
      if (cell === BLACK) black += 1;
      if (cell === WHITE) white += 1;
    }
  }
  return { black, white };
}

export function chineseAreaScore(board, komi = 5.5) {
  const { black: stonesBlack, white: stonesWhite } = countStones(board);
  let territoryBlack = 0;
  let territoryWhite = 0;
  const seen = new Set();

  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board.length; x += 1) {
      if (board[y][x] !== null) {
        continue;
      }
      const key = `${x},${y}`;
      if (seen.has(key)) {
        continue;
      }

      const queue = [[x, y]];
      const region = [];
      const borderColors = new Set();

      while (queue.length) {
        const [cx, cy] = queue.pop();
        const regionKey = `${cx},${cy}`;
        if (seen.has(regionKey)) {
          continue;
        }
        seen.add(regionKey);
        region.push([cx, cy]);

        for (const [nx, ny] of getNeighbors(board, cx, cy)) {
          const v = board[ny][nx];
          if (v === null && !seen.has(`${nx},${ny}`)) {
            queue.push([nx, ny]);
          } else if (v === BLACK || v === WHITE) {
            borderColors.add(v);
          }
        }
      }

      if (borderColors.size === 1) {
        if (borderColors.has(BLACK)) {
          territoryBlack += region.length;
        } else {
          territoryWhite += region.length;
        }
      }
    }
  }

  const black = stonesBlack + territoryBlack;
  const white = stonesWhite + territoryWhite + komi;
  const winner = black > white ? BLACK : WHITE;

  return {
    black,
    white,
    winner,
    detail: {
      stonesBlack,
      stonesWhite,
      territoryBlack,
      territoryWhite,
      komi,
    },
  };
}
