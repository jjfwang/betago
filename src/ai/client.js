import { groupLibertyCount, tryPlaceStone, WHITE } from "../game/rules.js";
import { requestKataGoMove } from "./katago.js";

const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? "8000", 10);
const DIFFICULTIES = new Set(["entry", "medium", "hard"]);

function asInt(v) {
  if (typeof v === "number" && Number.isInteger(v)) {
    return v;
  }
  if (typeof v === "string" && /^\d+$/.test(v)) {
    return Number.parseInt(v, 10);
  }
  return null;
}

function normalizeDifficulty(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return DIFFICULTIES.has(v) ? v : "medium";
}

function parseAIAction(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const action = typeof raw.action === "string" ? raw.action.toLowerCase() : null;
  if (!["place", "pass", "resign"].includes(action)) {
    return null;
  }
  const x = asInt(raw.x);
  const y = asInt(raw.y);
  const rationale = typeof raw.rationale === "string" ? raw.rationale.slice(0, 240) : "";

  if (action === "place") {
    if (x === null || y === null) {
      return null;
    }
    return { action, x, y, rationale };
  }

  return { action, rationale };
}

async function postJson(url, body, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`llm_http_${resp.status}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function requestExternalMove(game, legalPlacements) {
  const url = process.env.LLM_API_URL;
  if (!url) {
    return null;
  }

  const legal = legalPlacements.map((m) => ({ x: m.x, y: m.y }));
  const payload = {
    game_id: game.id,
    board_size: game.boardSize,
    turn: "ai",
    ai_color: WHITE,
    ai_level: normalizeDifficulty(game.aiLevel),
    komi: game.komi,
    turn_version: game.turnVersion,
    board: game.board,
    legal_moves: legal,
    moves: game.moves.slice(-20),
    output_schema: {
      action: "place|pass|resign",
      x: "integer if action=place",
      y: "integer if action=place",
      rationale: "optional short string",
    },
  };

  const headers = {};
  if (process.env.LLM_API_KEY) {
    headers.Authorization = `Bearer ${process.env.LLM_API_KEY}`;
  }

  try {
    const result = await postJson(url, payload, headers);
    const parsed = parseAIAction(result?.action ? result : result?.data ?? result?.output);
    if (!parsed) {
      return { source: "external", valid: false, reason: "malformed" };
    }

    return {
      source: "external",
      valid: true,
      move: parsed,
      responseId: result?.response_id ?? result?.id ?? null,
      model: result?.model ?? "external-api",
    };
  } catch (error) {
    return {
      source: "external",
      valid: false,
      reason: error?.name === "AbortError" ? "timeout" : error.message,
    };
  }
}

function resolveProvider() {
  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit) {
    return explicit;
  }
  if (process.env.LLM_API_URL) {
    return "external";
  }
  return "deterministic";
}

function seededHash(text) {
  let h = 2166136261;
  const value = String(text);
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededPick(items, seed) {
  if (items.length === 0) {
    return null;
  }
  const idx = seededHash(seed) % items.length;
  return items[idx];
}

function centerDistance(size, x, y) {
  const c = (size - 1) / 2;
  return Math.abs(x - c) + Math.abs(y - c);
}

function scoreMoveForLevel(level, moveMeta, size) {
  const dist = centerDistance(size, moveMeta.x, moveMeta.y);

  if (level === "hard") {
    return moveMeta.captures * 100 + moveMeta.liberties * 10 - dist;
  }
  if (level === "medium") {
    return moveMeta.captures * 30 + moveMeta.liberties * 5 - dist * 0.8;
  }

  // entry level: prefer weaker/safer-looking moves and avoid tactical captures.
  return -moveMeta.captures * 20 - moveMeta.liberties * 2 + dist;
}

function pickMoveByLevel(game, legalPlacements, level) {
  if (legalPlacements.length === 0) {
    return null;
  }

  const scored = [];
  for (const move of legalPlacements) {
    const result = tryPlaceStone({
      board: game.board,
      x: move.x,
      y: move.y,
      color: WHITE,
      positionHistory: game.positionHistory,
    });
    if (!result.ok) {
      continue;
    }

    scored.push({
      x: move.x,
      y: move.y,
      captures: move.captures,
      liberties: groupLibertyCount(result.board, move.x, move.y),
    });
  }

  if (scored.length === 0) {
    return legalPlacements[0];
  }

  const sorted = scored
    .map((m) => ({ ...m, score: scoreMoveForLevel(level, m, game.boardSize) }))
    .sort((a, b) => b.score - a.score);

  let pool = sorted;
  if (level === "medium") {
    pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.35)));
  } else if (level === "entry") {
    pool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * 0.45)));
  }

  const picked = seededPick(pool, `${game.id}:${game.turnVersion}:${game.moves.length}:${level}`) ?? pool[0];
  return {
    x: picked.x,
    y: picked.y,
    captures: picked.captures,
    liberties: picked.liberties,
  };
}

export function deterministicPolicyMove(game, legalPlacements) {
  const level = normalizeDifficulty(game.aiLevel);

  if (legalPlacements.length === 0) {
    return {
      action: "pass",
      rationale: "No legal placements available, so I pass.",
    };
  }

  const chosen = pickMoveByLevel(game, legalPlacements, level);
  if (!chosen) {
    return {
      action: "pass",
      rationale: "No legal placements available, so I pass.",
    };
  }

  if (level === "entry") {
    return {
      action: "place",
      x: chosen.x,
      y: chosen.y,
      rationale: "Entry-level move selected.",
    };
  }

  if (level === "medium") {
    return {
      action: "place",
      x: chosen.x,
      y: chosen.y,
      rationale: chosen.captures > 0 ? "Medium move with tactical capture." : "Medium balanced move selected.",
    };
  }

  return {
    action: "place",
    x: chosen.x,
    y: chosen.y,
    rationale: chosen.captures > 0 ? "Hard move: capturing sequence selected." : "Hard move: strongest local shape selected.",
  };
}

function shouldUseKataGoForLevel(game) {
  const level = normalizeDifficulty(game.aiLevel);
  if (level === "hard") {
    return true;
  }

  const key = `${game.id}:${game.turnVersion}:${game.moves.length}:katago:${level}`;
  const roll = seededHash(key) % 100;

  // entry uses KataGo only occasionally; medium uses it half the time.
  if (level === "entry") {
    return roll < 20;
  }
  return roll < 50;
}

export async function selectAIMove(game, legalPlacements) {
  const provider = resolveProvider();

  if (provider === "katago") {
    if (shouldUseKataGoForLevel(game)) {
      const kata = await requestKataGoMove(game);
      if (kata?.valid) {
        return {
          ...kata.move,
          source: "katago",
          responseId: kata.responseId,
          model: kata.model,
        };
      }

      const fallback = deterministicPolicyMove(game, legalPlacements);
      return {
        ...fallback,
        source: "katago",
        externalError: kata?.reason ?? "katago_failed",
        model: "deterministic-policy",
        responseId: null,
      };
    }

    const fallback = deterministicPolicyMove(game, legalPlacements);
    return {
      ...fallback,
      source: "deterministic",
      externalError: null,
      model: "deterministic-policy",
      responseId: null,
    };
  }

  if (provider === "external") {
    const external = await requestExternalMove(game, legalPlacements);
    if (external?.valid) {
      return {
        ...external.move,
        source: external.source,
        responseId: external.responseId,
        model: external.model,
      };
    }

    const fallback = deterministicPolicyMove(game, legalPlacements);
    return {
      ...fallback,
      source: external?.source ?? "external",
      externalError: external?.reason ?? "external_failed",
      model: "deterministic-policy",
      responseId: null,
    };
  }

  const deterministic = deterministicPolicyMove(game, legalPlacements);
  return {
    ...deterministic,
    source: "deterministic",
    externalError: null,
    model: "deterministic-policy",
    responseId: null,
  };
}
