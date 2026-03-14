const FILES = "abcdefgh";

function createBackRank(color) {
  const major = ["r", "n", "b", "q", "k", "b", "n", "r"];
  return color === "white" ? major.map((piece) => piece.toUpperCase()) : major.slice();
}

export function createInitialState() {
  return {
    board: [
      createBackRank("black"),
      Array(8).fill("p"),
      Array(8).fill(null),
      Array(8).fill(null),
      Array(8).fill(null),
      Array(8).fill(null),
      Array(8).fill("P"),
      createBackRank("white"),
    ],
    turn: "white",
    castling: {
      whiteKingside: true,
      whiteQueenside: true,
      blackKingside: true,
      blackQueenside: true,
    },
    enPassant: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
  };
}

export function cloneState(state) {
  return {
    board: state.board.map((row) => row.slice()),
    turn: state.turn,
    castling: { ...state.castling },
    enPassant: state.enPassant,
    halfmoveClock: state.halfmoveClock,
    fullmoveNumber: state.fullmoveNumber,
  };
}

export function getPieceColor(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? "white" : "black";
}

export function oppositeColor(color) {
  return color === "white" ? "black" : "white";
}

export function squareToCoords(square) {
  if (typeof square !== "string" || !/^[a-h][1-8]$/i.test(square)) {
    return null;
  }

  const file = FILES.indexOf(square[0].toLowerCase());
  const rank = Number.parseInt(square[1], 10);
  return { x: file, y: 8 - rank };
}

export function coordsToSquare(x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 7 || y < 0 || y > 7) {
    return null;
  }
  return `${FILES[x]}${8 - y}`;
}

function inBounds(x, y) {
  return x >= 0 && x < 8 && y >= 0 && y < 8;
}

function addMove(moves, baseMove, promotionOptions = [null]) {
  for (const promotion of promotionOptions) {
    moves.push({
      ...baseMove,
      promotion,
    });
  }
}

function createMoveObject(state, fromX, fromY, toX, toY, extras = {}) {
  const piece = state.board[fromY][fromX];
  const target = state.board[toY][toX];

  return {
    from: coordsToSquare(fromX, fromY),
    to: coordsToSquare(toX, toY),
    piece,
    capturedPiece: target ?? null,
    ...extras,
  };
}

function generatePawnMoves(state, x, y, color) {
  const moves = [];
  const direction = color === "white" ? -1 : 1;
  const startRank = color === "white" ? 6 : 1;
  const promotionRank = color === "white" ? 0 : 7;
  const oneForwardY = y + direction;

  if (inBounds(x, oneForwardY) && !state.board[oneForwardY][x]) {
    const move = createMoveObject(state, x, y, x, oneForwardY);
    if (oneForwardY === promotionRank) {
      addMove(moves, move, ["q"]);
    } else {
      addMove(moves, move);
    }

    const twoForwardY = y + direction * 2;
    if (y === startRank && !state.board[twoForwardY][x]) {
      addMove(moves, createMoveObject(state, x, y, x, twoForwardY, { doubleStep: true }));
    }
  }

  for (const dx of [-1, 1]) {
    const targetX = x + dx;
    const targetY = y + direction;
    if (!inBounds(targetX, targetY)) {
      continue;
    }

    const targetPiece = state.board[targetY][targetX];
    if (targetPiece && getPieceColor(targetPiece) !== color) {
      const move = createMoveObject(state, x, y, targetX, targetY, {
        capturedPiece: targetPiece,
      });
      if (targetY === promotionRank) {
        addMove(moves, move, ["q"]);
      } else {
        addMove(moves, move);
      }
    }

    const enPassantSquare = coordsToSquare(targetX, targetY);
    if (state.enPassant && enPassantSquare === state.enPassant) {
      const capturedY = targetY - direction;
      const capturedPiece = state.board[capturedY][targetX];
      if (capturedPiece && getPieceColor(capturedPiece) === oppositeColor(color)) {
        addMove(
          moves,
          createMoveObject(state, x, y, targetX, targetY, {
            capturedPiece,
            enPassant: true,
          }),
        );
      }
    }
  }

  return moves;
}

function generateKnightMoves(state, x, y, color) {
  const moves = [];
  const offsets = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ];

  for (const [dx, dy] of offsets) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny)) continue;
    const piece = state.board[ny][nx];
    if (!piece || getPieceColor(piece) !== color) {
      addMove(moves, createMoveObject(state, x, y, nx, ny));
    }
  }

  return moves;
}

function generateSlidingMoves(state, x, y, color, directions) {
  const moves = [];

  for (const [dx, dy] of directions) {
    let nx = x + dx;
    let ny = y + dy;
    while (inBounds(nx, ny)) {
      const piece = state.board[ny][nx];
      if (!piece) {
        addMove(moves, createMoveObject(state, x, y, nx, ny));
      } else {
        if (getPieceColor(piece) !== color) {
          addMove(moves, createMoveObject(state, x, y, nx, ny));
        }
        break;
      }
      nx += dx;
      ny += dy;
    }
  }

  return moves;
}

function canCastle(state, color, side) {
  const row = color === "white" ? 7 : 0;
  const enemy = oppositeColor(color);
  const king = color === "white" ? "K" : "k";
  const rook = color === "white" ? "R" : "r";
  const kingside = side === "kingside";
  const rightKey = `${color}${kingside ? "Kingside" : "Queenside"}`;

  if (!state.castling[rightKey]) {
    return false;
  }

  if (state.board[row][4] !== king) {
    return false;
  }

  if (kingside) {
    if (state.board[row][7] !== rook || state.board[row][5] || state.board[row][6]) {
      return false;
    }
    if (
      isSquareAttacked(state, 4, row, enemy) ||
      isSquareAttacked(state, 5, row, enemy) ||
      isSquareAttacked(state, 6, row, enemy)
    ) {
      return false;
    }
  } else {
    if (state.board[row][0] !== rook || state.board[row][1] || state.board[row][2] || state.board[row][3]) {
      return false;
    }
    if (
      isSquareAttacked(state, 4, row, enemy) ||
      isSquareAttacked(state, 3, row, enemy) ||
      isSquareAttacked(state, 2, row, enemy)
    ) {
      return false;
    }
  }

  return true;
}

function generateKingMoves(state, x, y, color) {
  const moves = [];

  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const piece = state.board[ny][nx];
      if (!piece || getPieceColor(piece) !== color) {
        addMove(moves, createMoveObject(state, x, y, nx, ny));
      }
    }
  }

  if (canCastle(state, color, "kingside")) {
    addMove(
      moves,
      createMoveObject(state, x, y, 6, y, {
        castle: "kingside",
      }),
    );
  }

  if (canCastle(state, color, "queenside")) {
    addMove(
      moves,
      createMoveObject(state, x, y, 2, y, {
        castle: "queenside",
      }),
    );
  }

  return moves;
}

function generatePseudoLegalMoves(state, color) {
  const moves = [];

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const piece = state.board[y][x];
      if (!piece || getPieceColor(piece) !== color) {
        continue;
      }

      const lower = piece.toLowerCase();
      if (lower === "p") {
        moves.push(...generatePawnMoves(state, x, y, color));
      } else if (lower === "n") {
        moves.push(...generateKnightMoves(state, x, y, color));
      } else if (lower === "b") {
        moves.push(...generateSlidingMoves(state, x, y, color, [[1, 1], [1, -1], [-1, 1], [-1, -1]]));
      } else if (lower === "r") {
        moves.push(...generateSlidingMoves(state, x, y, color, [[1, 0], [-1, 0], [0, 1], [0, -1]]));
      } else if (lower === "q") {
        moves.push(
          ...generateSlidingMoves(
            state,
            x,
            y,
            color,
            [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]],
          ),
        );
      } else if (lower === "k") {
        moves.push(...generateKingMoves(state, x, y, color));
      }
    }
  }

  return moves;
}

export function findKing(state, color) {
  const king = color === "white" ? "K" : "k";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (state.board[y][x] === king) {
        return { x, y };
      }
    }
  }
  return null;
}

export function isSquareAttacked(state, x, y, byColor) {
  const enemyPawn = byColor === "white" ? "P" : "p";
  const pawnDirection = byColor === "white" ? 1 : -1;
  for (const dx of [-1, 1]) {
    const px = x + dx;
    const py = y + pawnDirection;
    if (inBounds(px, py) && state.board[py][px] === enemyPawn) {
      return true;
    }
  }

  const knight = byColor === "white" ? "N" : "n";
  for (const [dx, dy] of [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ]) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBounds(nx, ny) && state.board[ny][nx] === knight) {
      return true;
    }
  }

  const king = byColor === "white" ? "K" : "k";
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(nx, ny) && state.board[ny][nx] === king) {
        return true;
      }
    }
  }

  const rook = byColor === "white" ? "R" : "r";
  const bishop = byColor === "white" ? "B" : "b";
  const queen = byColor === "white" ? "Q" : "q";

  for (const [dx, dy, attackers] of [
    [1, 0, new Set([rook, queen])],
    [-1, 0, new Set([rook, queen])],
    [0, 1, new Set([rook, queen])],
    [0, -1, new Set([rook, queen])],
    [1, 1, new Set([bishop, queen])],
    [1, -1, new Set([bishop, queen])],
    [-1, 1, new Set([bishop, queen])],
    [-1, -1, new Set([bishop, queen])],
  ]) {
    let nx = x + dx;
    let ny = y + dy;
    while (inBounds(nx, ny)) {
      const piece = state.board[ny][nx];
      if (piece) {
        if (attackers.has(piece)) {
          return true;
        }
        break;
      }
      nx += dx;
      ny += dy;
    }
  }

  return false;
}

export function isInCheck(state, color) {
  const king = findKing(state, color);
  if (!king) {
    return false;
  }
  return isSquareAttacked(state, king.x, king.y, oppositeColor(color));
}

function applyRawMove(state, move) {
  const next = cloneState(state);
  const from = squareToCoords(move.from);
  const to = squareToCoords(move.to);
  const movingPiece = next.board[from.y][from.x];
  const color = getPieceColor(movingPiece);

  next.board[from.y][from.x] = null;

  if (move.enPassant) {
    const captureY = color === "white" ? to.y + 1 : to.y - 1;
    next.board[captureY][to.x] = null;
  }

  if (move.castle === "kingside") {
    next.board[to.y][to.x] = movingPiece;
    next.board[to.y][5] = next.board[to.y][7];
    next.board[to.y][7] = null;
  } else if (move.castle === "queenside") {
    next.board[to.y][to.x] = movingPiece;
    next.board[to.y][3] = next.board[to.y][0];
    next.board[to.y][0] = null;
  } else {
    let pieceToPlace = movingPiece;
    if (move.promotion) {
      pieceToPlace = color === "white" ? move.promotion.toUpperCase() : move.promotion.toLowerCase();
    }
    next.board[to.y][to.x] = pieceToPlace;
  }

  next.enPassant = null;
  if (move.doubleStep) {
    const targetY = color === "white" ? to.y + 1 : to.y - 1;
    next.enPassant = coordsToSquare(to.x, targetY);
  }

  if (movingPiece === "K") {
    next.castling.whiteKingside = false;
    next.castling.whiteQueenside = false;
  } else if (movingPiece === "k") {
    next.castling.blackKingside = false;
    next.castling.blackQueenside = false;
  } else if (movingPiece === "R") {
    if (move.from === "h1") next.castling.whiteKingside = false;
    if (move.from === "a1") next.castling.whiteQueenside = false;
  } else if (movingPiece === "r") {
    if (move.from === "h8") next.castling.blackKingside = false;
    if (move.from === "a8") next.castling.blackQueenside = false;
  }

  if (move.capturedPiece === "R") {
    if (move.to === "h1") next.castling.whiteKingside = false;
    if (move.to === "a1") next.castling.whiteQueenside = false;
  } else if (move.capturedPiece === "r") {
    if (move.to === "h8") next.castling.blackKingside = false;
    if (move.to === "a8") next.castling.blackQueenside = false;
  }

  const wasPawnMove = movingPiece.toLowerCase() === "p";
  next.halfmoveClock = wasPawnMove || move.capturedPiece ? 0 : state.halfmoveClock + 1;
  next.turn = oppositeColor(state.turn);
  next.fullmoveNumber = state.turn === "black" ? state.fullmoveNumber + 1 : state.fullmoveNumber;

  return next;
}

function createNotation(state, move, nextState) {
  if (move.castle === "kingside") {
    return "O-O";
  }
  if (move.castle === "queenside") {
    return "O-O-O";
  }

  const piece = move.piece.toLowerCase() === "p" ? "" : move.piece.toUpperCase();
  const separator = move.capturedPiece ? "x" : "-";
  const promotion = move.promotion ? `=${move.promotion.toUpperCase()}` : "";
  const suffix = isInCheck(nextState, nextState.turn) ? "+" : "";
  return `${piece}${move.from}${separator}${move.to}${promotion}${suffix}`;
}

export function listLegalMoves(state, color = state.turn) {
  const pseudoMoves = generatePseudoLegalMoves(state, color);
  const legalMoves = [];

  for (const move of pseudoMoves) {
    const nextState = applyRawMove(state, move);
    if (!isInCheck(nextState, color)) {
      legalMoves.push({
        ...move,
        uci: `${move.from}${move.to}${move.promotion ?? ""}`,
        notation: createNotation(state, move, nextState),
      });
    }
  }

  return legalMoves;
}

export function findLegalMove(state, candidate) {
  const promotion = candidate.promotion ? candidate.promotion.toLowerCase() : null;
  const requestedUci = typeof candidate.uci === "string" ? candidate.uci.trim().toLowerCase() : null;

  for (const move of listLegalMoves(state)) {
    if (requestedUci && move.uci.toLowerCase() === requestedUci) {
      return move;
    }

    if (move.from !== candidate.from || move.to !== candidate.to) {
      continue;
    }

    const movePromotion = move.promotion ?? null;
    if (movePromotion === promotion) {
      return move;
    }
  }

  return null;
}

export function applyLegalMove(state, move) {
  const legalMove = typeof move.uci === "string" || move.from
    ? findLegalMove(state, move)
    : move;

  if (!legalMove) {
    return { ok: false, reason: "illegal_move" };
  }

  const nextState = applyRawMove(state, legalMove);
  const legalMoves = listLegalMoves(nextState);
  const inCheck = isInCheck(nextState, nextState.turn);

  return {
    ok: true,
    move: {
      ...legalMove,
      notation: createNotation(state, legalMove, nextState),
    },
    state: nextState,
    gameOver:
      legalMoves.length === 0
        ? {
            outcome: inCheck ? "checkmate" : "stalemate",
            winner: inCheck ? oppositeColor(nextState.turn) : "draw",
          }
        : null,
  };
}

export function stateToFen(state) {
  const boardPart = state.board
    .map((row) => {
      let result = "";
      let empties = 0;
      for (const cell of row) {
        if (!cell) {
          empties += 1;
        } else {
          if (empties) {
            result += String(empties);
            empties = 0;
          }
          result += cell;
        }
      }
      if (empties) {
        result += String(empties);
      }
      return result;
    })
    .join("/");

  const castling = [
    state.castling.whiteKingside ? "K" : "",
    state.castling.whiteQueenside ? "Q" : "",
    state.castling.blackKingside ? "k" : "",
    state.castling.blackQueenside ? "q" : "",
  ].join("") || "-";

  return [
    boardPart,
    state.turn === "white" ? "w" : "b",
    castling,
    state.enPassant ?? "-",
    String(state.halfmoveClock),
    String(state.fullmoveNumber),
  ].join(" ");
}

export function parseFen(fen) {
  const [boardPart, turnPart, castlingPart, enPassantPart, halfmovePart, fullmovePart] = fen.split(" ");
  const rows = boardPart.split("/");
  const board = rows.map((row) => {
    const cells = [];
    for (const char of row) {
      if (/\d/.test(char)) {
        for (let i = 0; i < Number.parseInt(char, 10); i += 1) {
          cells.push(null);
        }
      } else {
        cells.push(char);
      }
    }
    return cells;
  });

  return {
    board,
    turn: turnPart === "b" ? "black" : "white",
    castling: {
      whiteKingside: castlingPart.includes("K"),
      whiteQueenside: castlingPart.includes("Q"),
      blackKingside: castlingPart.includes("k"),
      blackQueenside: castlingPart.includes("q"),
    },
    enPassant: enPassantPart === "-" ? null : enPassantPart,
    halfmoveClock: Number.parseInt(halfmovePart, 10) || 0,
    fullmoveNumber: Number.parseInt(fullmovePart, 10) || 1,
  };
}
