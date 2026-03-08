/**
 * @fileoverview A simple Go game engine.
 */

export const BLACK = "B";
export const WHITE = "W";

export class GoEngine {
  constructor(size) {
    this.size = size;
    this.board = Array.from({ length: size }, () => Array.from({ length: size }, () => null));
    this.history = new Set();
  }

  clone() {
    const newEngine = new GoEngine(this.size);
    newEngine.board = this.board.map(row => row.slice());
    newEngine.history = new Set(this.history);
    return newEngine;
  }

  isOnBoard(x, y) {
    return y >= 0 && y < this.size && x >= 0 && x < this.size;
  }

  getNeighbors(x, y) {
    const candidates = [
      [x, y - 1],
      [x + 1, y],
      [x, y + 1],
      [x - 1, y],
    ];
    return candidates.filter(([nx, ny]) => this.isOnBoard(nx, ny));
  }

  _groupAndLiberties(x, y) {
    const color = this.board[y][x];
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

      for (const [nx, ny] of this.getNeighbors(cx, cy)) {
        const neighbor = this.board[ny][nx];
        if (!neighbor) {
          liberties.add(`${nx},${ny}`);
        } else if (neighbor === color && !seen.has(`${nx},${ny}`)) {
          stack.push([nx, ny]);
        }
      }
    }

    return { group, liberties };
  }

  _removeGroup(group) {
    for (const [x, y] of group) {
      this.board[y][x] = null;
    }
  }

  getBoardHash() {
    return this.board.map((row) => row.map((cell) => cell ?? ".").join("")).join("|");
  }

  tryPlaceStone(x, y, color) {
    if (!this.isOnBoard(x, y)) {
      return { ok: false, reason: "out_of_bounds" };
    }
    if (this.board[y][x] !== null) {
      return { ok: false, reason: "occupied" };
    }

    const nextEngine = this.clone();
    nextEngine.board[y][x] = color;

    const capturedStones = [];
    for (const [nx, ny] of this.getNeighbors(x, y)) {
      if (nextEngine.board[ny][nx] !== (color === BLACK ? WHITE : BLACK)) {
        continue;
      }
      const oppInfo = nextEngine._groupAndLiberties(nx, ny);
      if (oppInfo.liberties.size === 0) {
        capturedStones.push(...oppInfo.group);
        nextEngine._removeGroup(oppInfo.group);
      }
    }

    const ownInfo = nextEngine._groupAndLiberties(x, y);
    if (ownInfo.liberties.size === 0) {
      return { ok: false, reason: "suicide" };
    }

    const hash = nextEngine.getBoardHash();
    if (this.history.has(hash)) {
      return { ok: false, reason: "superko" };
    }

    return {
      ok: true,
      engine: nextEngine,
      captures: capturedStones.length,
      capturedStones,
    };
  }

  listLegalPlacements(color) {
    const legal = [];
    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        const result = this.tryPlaceStone(x, y, color);
        if (result.ok) {
          legal.push({ x, y, captures: result.captures });
        }
      }
    }
    return legal;
  }

  chineseAreaScore(komi = 5.5) {
    let blackStones = 0;
    let whiteStones = 0;
    for (const row of this.board) {
      for (const cell of row) {
        if (cell === BLACK) blackStones += 1;
        if (cell === WHITE) whiteStones += 1;
      }
    }

    let blackTerritory = 0;
    let whiteTerritory = 0;
    const seen = new Set();

    for (let y = 0; y < this.size; y += 1) {
      for (let x = 0; x < this.size; x += 1) {
        if (this.board[y][x] !== null) {
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

          for (const [nx, ny] of this.getNeighbors(cx, cy)) {
            const v = this.board[ny][nx];
            if (v === null && !seen.has(`${nx},${ny}`)) {
              queue.push([nx, ny]);
            } else if (v === BLACK || v === WHITE) {
              borderColors.add(v);
            }
          }
        }

        if (borderColors.size === 1) {
          if (borderColors.has(BLACK)) {
            blackTerritory += region.length;
          } else {
            whiteTerritory += region.length;
          }
        }
      }
    }

    const blackScore = blackStones + blackTerritory;
    const whiteScore = whiteStones + whiteTerritory + komi;
    const winner = blackScore > whiteScore ? BLACK : WHITE;

    return {
      black: blackScore,
      white: whiteScore,
      winner,
      detail: {
        stonesBlack: blackStones,
        stonesWhite: whiteStones,
        territoryBlack: blackTerritory,
        territoryWhite: whiteTerritory,
        komi,
      },
    };
  }
}
