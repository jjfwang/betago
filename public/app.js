const boardWrap = document.getElementById("boardWrap");
const statusText = document.getElementById("statusText");
const turnText = document.getElementById("turnText");
const turnVersionText = document.getElementById("turnVersionText");
const aiStatusText = document.getElementById("aiStatusText");
const aiLevelText = document.getElementById("aiLevelText");
const captureText = document.getElementById("captureText");
const winnerText = document.getElementById("winnerText");
const messageEl = document.getElementById("message");
const moveList = document.getElementById("moveList");

const passBtn = document.getElementById("passBtn");
const resignBtn = document.getElementById("resignBtn");
const newGameBtn = document.getElementById("newGameBtn");
const boardSizeSelect = document.getElementById("boardSizeSelect");
const aiLevelSelect = document.getElementById("aiLevelSelect");

const state = {
  game: null,
  events: null,
  posting: false,
  wgoBoard: null,
  wgoSize: null,
};

function showMessage(msg) {
  messageEl.textContent = msg || "";
}

function normalizeAiLevel(level) {
  const value = typeof level === "string" ? level.trim().toLowerCase() : "";
  if (value === "entry" || value === "medium" || value === "hard") {
    return value;
  }
  return "medium";
}

function normalizeBoardSize(size) {
  const value = Number.parseInt(String(size ?? ""), 10);
  return value === 19 ? 19 : 9;
}

function actionId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function statusLabel(game) {
  if (game.status === "finished") {
    if (game.winner === "B") return "Game finished. You won.";
    if (game.winner === "W") return "Game finished. AI won.";
    return "Game finished.";
  }
  if (game.ai_status === "error") {
    return "AI move failed. Check the LLM configuration or server logs.";
  }
  if (game.status === "ai_thinking") return "AI is thinking...";
  return "Your turn.";
}

function humanMoveEnabled(game) {
  return game && game.status === "human_turn" && game.turn === "B" && !state.posting;
}

function computeCellSizePx(size) {
  const desktop = window.innerWidth > 920;
  const sidePanelWidth = desktop ? 340 : 0;
  const horizontalPadding = desktop ? 120 : 36;
  const verticalBudget = window.innerHeight - (desktop ? 200 : 180);
  const horizontalBudget = window.innerWidth - sidePanelWidth - horizontalPadding;
  const byWidth = Math.floor(horizontalBudget / (size + 1));
  const byHeight = Math.floor(verticalBudget / (size + 1));
  const raw = Math.min(byWidth, byHeight);
  const minPx = desktop ? 18 : 14;
  const safe = Number.isFinite(raw) ? raw : minPx;
  return Math.max(minPx, Math.min(44, safe));
}

function computeBoardPixelSize(size) {
  return computeCellSizePx(size) * (size + 1);
}

function canPlayAt(game, x, y) {
  if (!humanMoveEnabled(game)) {
    return false;
  }
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return false;
  }
  if (x < 0 || y < 0 || x >= game.board_size || y >= game.board_size) {
    return false;
  }
  if (game.board[y]?.[x] !== null) {
    return false;
  }
  return game.legal_moves.some((m) => m.x === x && m.y === y);
}

function ensureWGoBoard(game) {
  if (!window.WGo || typeof window.WGo.Board !== "function") {
    showMessage("Local WGo.js not loaded.");
    return false;
  }

  const size = game.board_size;
  if (!state.wgoBoard || state.wgoSize !== size) {
    boardWrap.replaceChildren();
    state.wgoBoard = new window.WGo.Board(boardWrap, {
      size,
      width: computeBoardPixelSize(size),
    });
    state.wgoSize = size;

    state.wgoBoard.addEventListener("click", (x, y) => {
      if (!state.game || !canPlayAt(state.game, x, y)) {
        return;
      }
      submitAction("place", { x, y });
    });
  } else if (typeof state.wgoBoard.setWidth === "function") {
    state.wgoBoard.setWidth(computeBoardPixelSize(size));
  }

  return true;
}

function renderBoard(game) {
  if (!ensureWGoBoard(game)) {
    return;
  }

  if (typeof state.wgoBoard.removeAllObjects === "function") {
    state.wgoBoard.removeAllObjects();
  }

  for (let y = 0; y < game.board_size; y += 1) {
    for (let x = 0; x < game.board_size; x += 1) {
      const stone = game.board[y][x];
      if (stone === "B") {
        state.wgoBoard.addObject({ x, y, c: window.WGo.B });
      } else if (stone === "W") {
        state.wgoBoard.addObject({ x, y, c: window.WGo.W });
      }
    }
  }

  const lastMove = game.moves.length ? game.moves[game.moves.length - 1] : null;
  if (lastMove && lastMove.action === "place" && Number.isInteger(lastMove.x) && Number.isInteger(lastMove.y)) {
    state.wgoBoard.addObject({ x: lastMove.x, y: lastMove.y, type: "CR" });
  }

  boardWrap.style.cursor = humanMoveEnabled(game) ? "crosshair" : "default";
}

function renderMoveHistory(game) {
  moveList.replaceChildren();
  for (const move of game.moves) {
    const li = document.createElement("li");
    const label = `${move.move_index + 1}. ${move.player} ${move.action}${move.coordinate ? ` ${move.coordinate}` : ""}`;
    let extra = "";
    if (move.captures) extra += ` (captures ${move.captures})`;
    if (move.rationale) extra += ` - ${move.rationale}`;
    li.textContent = label + extra;
    moveList.appendChild(li);
  }
}

function renderMeta(game) {
  statusText.textContent = statusLabel(game);
  turnText.textContent = game.turn ?? "-";
  turnVersionText.textContent = String(game.turn_version);
  aiStatusText.textContent = game.ai_status;
  aiLevelText.textContent = normalizeAiLevel(game.ai_level);
  captureText.textContent = `You ${game.captures.B} / AI ${game.captures.W}`;
  winnerText.textContent = game.winner ?? "-";

  const gameLevel = normalizeAiLevel(game.ai_level);
  if (aiLevelSelect.value !== gameLevel) {
    aiLevelSelect.value = gameLevel;
  }
  const gameBoardSize = String(normalizeBoardSize(game.board_size));
  if (boardSizeSelect.value !== gameBoardSize) {
    boardSizeSelect.value = gameBoardSize;
  }

  passBtn.disabled = !humanMoveEnabled(game);
  resignBtn.disabled = !humanMoveEnabled(game);

  if (game.status === "finished" && game.score) {
    const { black, white } = game.score;
    showMessage(`Score - Black: ${black.toFixed(1)}, White: ${white.toFixed(1)}`);
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

async function request(path, options = {}) {
  const resp = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.error || `http_${resp.status}`);
  }
  return data;
}

function connectEvents(gameId) {
  if (state.events) {
    state.events.close();
    state.events = null;
  }

  const es = new EventSource(`/api/games/${gameId}/events`);
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
  const data = await request("/api/games", {
    method: "POST",
    body: JSON.stringify({
      force_new: forceNew,
      board_size: normalizeBoardSize(boardSizeSelect.value),
      ai_level: normalizeAiLevel(aiLevelSelect.value),
    }),
  });
  setGame(data.game);
  connectEvents(data.game.id);
}

async function submitAction(action, payload = {}) {
  if (!state.game || !humanMoveEnabled(state.game)) {
    return;
  }

  state.posting = true;
  render();
  showMessage("");

  try {
    const body = {
      action,
      action_id: actionId(),
      expected_turn_version: state.game.turn_version,
      ...payload,
    };

    const data = await request(`/api/games/${state.game.id}/actions`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    setGame(data.game);
  } catch (error) {
    showMessage(`Action failed: ${error.message}`);
  } finally {
    state.posting = false;
    render();
  }
}

passBtn.addEventListener("click", () => submitAction("pass"));
resignBtn.addEventListener("click", () => submitAction("resign"));
newGameBtn.addEventListener("click", async () => {
  await createGame(true);
});

aiLevelSelect.addEventListener("change", () => {
  const selected = normalizeAiLevel(aiLevelSelect.value);
  aiLevelSelect.value = selected;
  if (state.game && state.game.status !== "finished" && state.game.ai_level !== selected) {
    showMessage("Level will apply when you start a new game.");
  }
});

boardSizeSelect.addEventListener("change", () => {
  boardSizeSelect.value = String(normalizeBoardSize(boardSizeSelect.value));
  if (state.game && state.game.status !== "finished" && state.game.board_size !== normalizeBoardSize(boardSizeSelect.value)) {
    showMessage("Board size will apply when you start a new game.");
  }
});

createGame().catch((error) => {
  showMessage(`Failed to load game: ${error.message}`);
});

window.addEventListener("resize", () => {
  if (state.game) {
    render();
  }
});
