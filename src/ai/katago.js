import { spawn } from "node:child_process";
import { aiLog, aiLogVerbose } from "./logger.js";

const GTP_LETTERS = "ABCDEFGHJKLMNOPQRST";
const KATAGO_TIMEOUT_MS = Number.parseInt(process.env.KATAGO_TIMEOUT_MS ?? "15000", 10);
const MAX_KATAGO_SESSIONS = Number.parseInt(process.env.MAX_KATAGO_SESSIONS ?? "12", 10);
const KATAGO_SESSION_TTL_MS = Number.parseInt(process.env.KATAGO_SESSION_TTL_MS ?? "600000", 10);

const sessions = new Map();

function splitArgs(text) {
  if (!text) {
    return [];
  }
  return text
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function processSpec() {
  const cmd = process.env.KATAGO_CMD?.trim();
  if (cmd) {
    return { command: cmd, args: [], shell: true };
  }

  const command = process.env.KATAGO_BIN?.trim() || "katago";
  const args = ["gtp"];

  if (process.env.KATAGO_CONFIG) {
    args.push("-config", process.env.KATAGO_CONFIG);
  }
  if (process.env.KATAGO_MODEL) {
    args.push("-model", process.env.KATAGO_MODEL);
  }
  if (process.env.KATAGO_OVERRIDE_CONFIG) {
    args.push("-override-config", process.env.KATAGO_OVERRIDE_CONFIG);
  }

  args.push(...splitArgs(process.env.KATAGO_EXTRA_ARGS));
  return { command, args, shell: false };
}

export function toGtpCoord(x, y, size) {
  const letter = GTP_LETTERS[x];
  if (!letter) {
    return null;
  }
  const row = size - y;
  if (row < 1 || row > size) {
    return null;
  }
  return `${letter}${row}`;
}

export function fromGtpCoord(coord, size) {
  if (!coord || typeof coord !== "string") {
    return null;
  }

  const normalized = coord.trim().toUpperCase();
  if (normalized === "PASS") {
    return { action: "pass" };
  }
  if (normalized === "RESIGN") {
    return { action: "resign" };
  }

  const match = normalized.match(/^([A-Z])(\d+)$/);
  if (!match) {
    return null;
  }

  const letter = match[1];
  const row = Number.parseInt(match[2], 10);
  const x = GTP_LETTERS.indexOf(letter);
  const y = size - row;

  if (x < 0 || x >= size || y < 0 || y >= size) {
    return null;
  }

  return { action: "place", x, y };
}

function parseGtpBlock(block) {
  const text = block.trim();
  if (!text || (text[0] !== "=" && text[0] !== "?")) {
    return null;
  }

  const ok = text[0] === "=";
  const rest = text.slice(1).trimStart();
  const lines = rest.split("\n");
  const firstLine = lines[0] ?? "";

  let id = null;
  let firstPayload = firstLine;

  const firstToken = firstLine.split(/\s+/)[0] ?? "";
  if (/^\d+$/.test(firstToken)) {
    id = Number.parseInt(firstToken, 10);
    firstPayload = firstLine.slice(firstToken.length).trim();
  }

  const payload = [firstPayload, ...lines.slice(1)].join("\n").trim();
  return { id, ok, payload };
}

function moveToGtpPlay(move, boardSize) {
  const color = move.player === "human" ? "B" : "W";
  if (move.action === "place") {
    const coord = toGtpCoord(move.x, move.y, boardSize);
    if (!coord) {
      return null;
    }
    return `play ${color} ${coord}`;
  }

  if (move.action === "pass") {
    return `play ${color} pass`;
  }

  return null;
}

class KataGoSession {
  constructor(gameId) {
    this.gameId = gameId;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    this.nextCommandId = 1;
    this.closed = false;
    this.initialized = false;
    this.boardSize = null;
    this.komi = null;
    this.appliedMoves = 0;
    this.dirty = false;
    this.lastUsedAt = Date.now();

    const spec = processSpec();
    aiLog("katago.session.start", {
      game_id: this.gameId,
      command: spec.command,
      args: spec.args,
      shell: spec.shell,
    });
    this.proc = spawn(spec.command, spec.args, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: spec.shell,
      env: process.env,
    });

    this.proc.stdout.on("data", (chunk) => {
      this.handleStdout(chunk.toString());
    });

    this.proc.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });

    this.proc.on("error", (error) => {
      this.shutdown(`spawn_error:${error.message}`);
    });

    this.proc.on("close", (code) => {
      if (!this.closed) {
        this.shutdown(`closed_${code}`);
      }
    });
  }

  handleStdout(chunk) {
    this.buffer += chunk.replace(/\r\n/g, "\n");

    while (true) {
      const idx = this.buffer.indexOf("\n\n");
      if (idx < 0) {
        return;
      }

      const block = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);

      const parsed = parseGtpBlock(block);
      if (!parsed || parsed.id === null) {
        continue;
      }

      const pending = this.pending.get(parsed.id);
      if (!pending) {
        continue;
      }

      clearTimeout(pending.timer);
      this.pending.delete(parsed.id);
      this.lastUsedAt = Date.now();

      if (parsed.ok) {
        pending.resolve(parsed.payload);
      } else {
        pending.reject(new Error(`gtp_error:${parsed.payload || pending.command}`));
      }
    }
  }

  send(command, timeoutMs = KATAGO_TIMEOUT_MS) {
    if (this.closed) {
      return Promise.reject(new Error("katago_session_closed"));
    }

    const id = this.nextCommandId;
    this.nextCommandId += 1;
    aiLogVerbose("katago.gtp.send", { game_id: this.gameId, id, command });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout:${command}`));
      }, Math.max(1000, timeoutMs));

      this.pending.set(id, { resolve, reject, timer, command });

      this.proc.stdin.write(`${id} ${command}\n`, (error) => {
        if (!error) {
          return;
        }
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error(`stdin_error:${error.message}`));
      });
    });
  }

  async hardReset(game) {
    await this.send(`boardsize ${game.boardSize}`);
    await this.send(`komi ${game.komi}`);
    await this.send("clear_board");
    this.initialized = true;
    this.boardSize = game.boardSize;
    this.komi = game.komi;
    this.appliedMoves = 0;
    this.dirty = false;
  }

  async syncToGame(game) {
    if (!this.initialized || this.boardSize !== game.boardSize || this.komi !== game.komi || this.dirty) {
      await this.hardReset(game);
    }

    if (this.appliedMoves > game.moves.length) {
      await this.hardReset(game);
    }

    for (let i = this.appliedMoves; i < game.moves.length; i += 1) {
      const cmd = moveToGtpPlay(game.moves[i], game.boardSize);
      if (!cmd) {
        continue;
      }
      await this.send(cmd);
    }

    this.appliedMoves = game.moves.length;
  }

  async genmoveForGame(game) {
    await this.syncToGame(game);

    const payload = await this.send("genmove W");
    const token = (payload.split(/\s+/)[0] ?? "").trim();
    aiLog("katago.genmove.raw", {
      game_id: this.gameId,
      turn_version: game.turnVersion,
      token,
    });

    // Keep engine state aligned to authoritative server board.
    try {
      await this.send("undo", Math.min(5000, KATAGO_TIMEOUT_MS));
    } catch {
      this.dirty = true;
    }

    this.lastUsedAt = Date.now();
    return token;
  }

  shutdown(reason) {
    aiLog("katago.session.stop", { game_id: this.gameId, reason });
    this.closed = true;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();

    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGKILL");
    }
  }
}

function pruneSessionCache() {
  const now = Date.now();

  for (const [gameId, session] of sessions.entries()) {
    if (session.closed || now - session.lastUsedAt > KATAGO_SESSION_TTL_MS) {
      session.shutdown("expired");
      sessions.delete(gameId);
    }
  }

  if (sessions.size <= MAX_KATAGO_SESSIONS) {
    return;
  }

  const ordered = [...sessions.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
  while (sessions.size > MAX_KATAGO_SESSIONS && ordered.length > 0) {
    const [gameId, session] = ordered.shift();
    session.shutdown("capacity_eviction");
    sessions.delete(gameId);
  }
}

function getSession(gameId) {
  pruneSessionCache();

  const existing = sessions.get(gameId);
  if (existing && !existing.closed) {
    existing.lastUsedAt = Date.now();
    return existing;
  }

  if (existing) {
    sessions.delete(gameId);
  }

  const created = new KataGoSession(gameId);
  sessions.set(gameId, created);
  return created;
}

export function releaseKataGoSession(gameId) {
  const session = sessions.get(gameId);
  if (!session) {
    return;
  }
  session.shutdown("released");
  sessions.delete(gameId);
}

export async function requestKataGoMove(game) {
  const session = getSession(game.id);
  aiLog("katago.request.start", {
    game_id: game.id,
    turn_version: game.turnVersion,
    ai_level: game.aiLevel,
    moves: game.moves.length,
  });

  try {
    const token = await session.genmoveForGame(game);
    const parsed = fromGtpCoord(token, game.boardSize);
    if (!parsed) {
      return { valid: false, reason: "invalid_genmove_coord" };
    }

    if (parsed.action === "place") {
      aiLog("katago.request.result", {
        game_id: game.id,
        turn_version: game.turnVersion,
        action: "place",
        x: parsed.x,
        y: parsed.y,
      });
      return {
        valid: true,
        move: {
          action: "place",
          x: parsed.x,
          y: parsed.y,
          rationale: "Move selected by KataGo.",
        },
        model: "katago-gtp",
        responseId: null,
      };
    }

    return {
      valid: true,
      move: {
        action: parsed.action,
        rationale: parsed.action === "pass" ? "KataGo chose to pass." : "KataGo chose to resign.",
      },
      model: "katago-gtp",
      responseId: null,
    };
  } catch (error) {
    aiLog("katago.request.error", {
      game_id: game.id,
      turn_version: game.turnVersion,
      error: error.message,
    });
    session.shutdown(error.message);
    sessions.delete(game.id);
    return { valid: false, reason: error.message };
  }
}
