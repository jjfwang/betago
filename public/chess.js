const boardGrid = document.getElementById("boardGrid");
const statusText = document.getElementById("statusText");
const turnText = document.getElementById("turnText");
const turnVersionText = document.getElementById("turnVersionText");
const aiStatusText = document.getElementById("aiStatusText");
const aiLevelText = document.getElementById("aiLevelText");
const checkText = document.getElementById("checkText");
const winnerText = document.getElementById("winnerText");
const messageEl = document.getElementById("message");
const moveList = document.getElementById("moveList");
const resignBtn = document.getElementById("resignBtn");
const newGameBtn = document.getElementById("newGameBtn");
const aiLevelSelect = document.getElementById("aiLevelSelect");
const aiRationaleSection = document.getElementById("aiRationaleSection");
const aiRationaleText = document.getElementById("aiRationaleText");

const PIECES = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

const FILES = "abcdefgh";

const state = {
  game: null,
  posting: false,
  events: null,
  selected: null,
};

function showMessage(msg) {
  messageEl.textContent = msg || "";
}

function actionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeAiLevel(level) {
  const value = typeof level === "string" ? level.trim().toLowerCase() : "";
  return ["entry", "medium", "hard"].includes(value) ? value : "medium";
}

function humanMoveEnabled(game) {
  return game && game.status === "human_turn" && game.turn === "W" && !state.posting;
}

function statusLabel(game) {
  if (game.status === "finished") {
    if (game.winner === "W") return "Game finished. You won.";
    if (game.winner === "B") return "Game finished. AI won.";
    return "Game finished in a draw.";
  }
  if (game.ai_status === "error") {
    return "AI move failed. Check the LLM configuration or server logs.";
  }
  if (game.status === "ai_thinking") return "AI is thinking...";
  if (game.in_check) return "Your king is in check.";
  return "Your move.";
}

function request(path, options = {}) {
  return fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `http_${response.status}`);
    }
    return data;
  });
}

function pieceColor(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? "white" : "black";
}

function coordsToSquare(x, y) {
  return `${FILES[x]}${8 - y}`;
}

function legalMovesFrom(square) {
  if (!state.game) return [];
  return state.game.legal_moves.filter((move) => move.from === square);
}

function submitAction(body) {
  if (!state.game) return Promise.resolve();
  state.posting = true;
  render();
  return request(`/api/chess/games/${state.game.id}/actions`, {
    method: "POST",
    body: JSON.stringify({
      action_id: actionId(),
      expected_turn_version: state.game.turn_version,
      ...body,
    }),
  })
    .then((data) => {
      state.selected = null;
      setGame(data.game);
      showMessage("");
    })
    .catch((error) => {
      showMessage(error.message);
    })
    .finally(() => {
      state.posting = false;
      render();
    });
}

function renderMoveHistory(game) {
  moveList.replaceChildren();
  for (const move of game.moves) {
    const li = document.createElement("li");
    const summary = document.createElement("div");
    const label =
      move.action === "move"
        ? `${move.move_index + 1}. ${move.player} ${move.notation || `${move.from_square}-${move.to_square}`}`
        : `${move.move_index + 1}. ${move.player} resigns`;
    summary.textContent = label;
    li.appendChild(summary);

    if (move.player === "ai" && move.rationale) {
      const rationale = document.createElement("div");
      rationale.className = "move-rationale";
      rationale.textContent = `Why: ${move.rationale}`;
      li.appendChild(rationale);
    }

    moveList.appendChild(li);
  }
}

function renderMeta(game) {
  statusText.textContent = statusLabel(game);
  turnText.textContent = game.turn === "W" ? "White" : "Black";
  turnVersionText.textContent = String(game.turn_version);
  aiStatusText.textContent = game.ai_status ?? "-";
  aiLevelText.textContent = normalizeAiLevel(game.ai_level);
  checkText.textContent = game.in_check ? "Yes" : "No";
  winnerText.textContent =
    game.winner === "W" ? "White" : game.winner === "B" ? "Black" : game.winner ?? "-";
  resignBtn.disabled = !humanMoveEnabled(game);

  if (game.last_ai_rationale) {
    aiRationaleSection.classList.remove("hidden");
    aiRationaleText.textContent = game.last_ai_rationale;
  } else {
    aiRationaleSection.classList.add("hidden");
    aiRationaleText.textContent = "";
  }

  if (aiLevelSelect.value !== normalizeAiLevel(game.ai_level)) {
    aiLevelSelect.value = normalizeAiLevel(game.ai_level);
  }
}

function isTargetSquare(square) {
  if (!state.selected) return false;
  return legalMovesFrom(state.selected).some((move) => move.to === square);
}

function renderBoard(game) {
  boardGrid.replaceChildren();

  let checkedKingSquare = null;
  if (game.in_check) {
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const piece = game.board[y][x];
        if ((game.turn === "W" && piece === "K") || (game.turn === "B" && piece === "k")) {
          checkedKingSquare = coordsToSquare(x, y);
        }
      }
    }
  }

  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const square = coordsToSquare(x, y);
      const piece = game.board[y][x];
      const button = document.createElement("button");
      button.type = "button";
      button.className = `square ${(x + y) % 2 === 0 ? "light" : "dark"}`;
      if (square === state.selected) {
        button.classList.add("selected");
      }
      if (isTargetSquare(square)) {
        button.classList.add("target");
      }
      if (square === checkedKingSquare) {
        button.classList.add("in-check");
      }

      const pieceSpan = document.createElement("span");
      pieceSpan.className = `piece ${pieceColor(piece) || ""}`.trim();
      pieceSpan.textContent = piece ? PIECES[piece] : "";
      button.appendChild(pieceSpan);

      if (y === 7) {
        const file = document.createElement("span");
        file.className = "label file";
        file.textContent = FILES[x];
        button.appendChild(file);
      }
      if (x === 0) {
        const rank = document.createElement("span");
        rank.className = "label rank";
        rank.textContent = String(8 - y);
        button.appendChild(rank);
      }

      button.addEventListener("click", () => {
        if (!humanMoveEnabled(game)) {
          return;
        }

        const currentMoves = legalMovesFrom(state.selected);
        const chosenMove = currentMoves.find((move) => move.to === square);
        if (state.selected && chosenMove) {
          submitAction({
            action: "move",
            from: chosenMove.from,
            to: chosenMove.to,
            promotion: chosenMove.promotion ?? undefined,
          });
          return;
        }

        if (piece && pieceColor(piece) === "white" && legalMovesFrom(square).length > 0) {
          state.selected = square;
        } else {
          state.selected = null;
        }
        render();
      });

      boardGrid.appendChild(button);
    }
  }
}

function render() {
  if (!state.game) return;
  renderMeta(state.game);
  renderBoard(state.game);
  renderMoveHistory(state.game);
}

function setGame(game) {
  state.game = game;
  render();
}

function connectEvents(gameId) {
  if (state.events) {
    state.events.close();
    state.events = null;
  }

  const es = new EventSource(`/api/chess/games/${gameId}/events`);
  state.events = es;

  es.addEventListener("game", (event) => {
    try {
      setGame(JSON.parse(event.data));
    } catch {
      showMessage("Failed to parse game update.");
    }
  });

  es.onerror = () => {
    showMessage("Realtime updates interrupted. Retrying...");
  };
}

async function createGame(forceNew = false) {
  showMessage("");
  const data = await request("/api/chess/games", {
    method: "POST",
    body: JSON.stringify({
      force_new: forceNew,
      ai_level: aiLevelSelect.value,
    }),
  });
  state.selected = null;
  setGame(data.game);
  connectEvents(data.game.id);
}

resignBtn.addEventListener("click", () => {
  if (!humanMoveEnabled(state.game)) return;
  submitAction({ action: "resign" });
});

newGameBtn.addEventListener("click", () => {
  createGame(true).catch((error) => showMessage(error.message));
});

aiLevelSelect.addEventListener("change", () => {
  createGame(true).catch((error) => showMessage(error.message));
});

window.addEventListener("beforeunload", () => {
  state.events?.close();
});

createGame(false).catch((error) => {
  showMessage(error.message);
});
