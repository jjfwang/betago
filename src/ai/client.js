import { GoEngine, WHITE } from "../game/engine.js";
import { requestKataGoMove } from "./katago.js";
import { aiLog, aiLogPrompt } from "./logger.js";
import { validateAIAction } from "./schema.js";

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
  const valid = validateAIAction(raw);
  if (!valid) {
    aiLog("ai_action.invalid_schema", {
      errors: validateAIAction.errors,
      raw_input: raw,
    });
    return null;
  }

  const rationale = typeof raw.rationale === "string" ? raw.rationale.slice(0, 240) : "";

  if (raw.action === "place") {
    return { action: "place", x: raw.x, y: raw.y, rationale };
  }

  return { action: raw.action, rationale };
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

  aiLog("external.request.start", {
    game_id: game.id,
    turn_version: game.turnVersion,
    ai_level: normalizeDifficulty(game.aiLevel),
    endpoint: url,
    legal_moves_count: legal.length,
  });
  aiLogPrompt("external.request.payload", payload);

  try {
    const result = await postJson(url, payload, headers);
    const parsed = parseAIAction(result?.action ? result : result?.data ?? result?.output);
    if (!parsed) {
      aiLog("external.response.malformed", {
        game_id: game.id,
        turn_version: game.turnVersion,
      });
      return { source: "external", valid: false, reason: "malformed" };
    }

    aiLog("external.response.ok", {
      game_id: game.id,
      turn_version: game.turnVersion,
      model: result?.model ?? "external-api",
      response_id: result?.response_id ?? result?.id ?? null,
      action: parsed.action,
      x: parsed.x ?? null,
      y: parsed.y ?? null,
    });

    return {
      source: "external",
      valid: true,
      move: parsed,
      responseId: result?.response_id ?? result?.id ?? null,
      model: result?.model ?? "external-api",
    };
  } catch (error) {
    aiLog("external.response.error", {
      game_id: game.id,
      turn_version: game.turnVersion,
      error: error?.name === "AbortError" ? "timeout" : error.message,
    });
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

  const engine = new GoEngine(game.boardSize);
  engine.board = game.board;
  engine.history = game.positionHistory;

  const scored = [];
  for (const move of legalPlacements) {
    const result = engine.tryPlaceStone(move.x, move.y, WHITE);
    if (!result.ok) {
      continue;
    }

    scored.push({
      x: move.x,
      y: move.y,
      captures: move.captures,
      liberties: result.engine._groupAndLiberties(move.x, move.y).liberties.size,
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
  aiLog("provider.selected", {
    game_id: game.id,
    turn_version: game.turnVersion,
    provider,
    ai_level: normalizeDifficulty(game.aiLevel),
    legal_moves_count: legalPlacements.length,
  });

  if (provider === "katago") {
    if (shouldUseKataGoForLevel(game)) {
      const kata = await requestKataGoMove(game);
      if (kata?.valid) {
        aiLog("provider.result", {
          provider: "katago",
          game_id: game.id,
          turn_version: game.turnVersion,
          model: kata.model,
          action: kata.move?.action,
        });
        return {
          ...kata.move,
          source: "katago",
          responseId: kata.responseId,
          model: kata.model,
        };
      }

      const fallback = deterministicPolicyMove(game, legalPlacements);
      aiLog("provider.fallback", {
        provider: "katago",
        game_id: game.id,
        turn_version: game.turnVersion,
        reason: kata?.reason ?? "katago_failed",
      });
      return {
        ...fallback,
        source: "katago",
        externalError: kata?.reason ?? "katago_failed",
        model: "deterministic-policy",
        responseId: null,
      };
    }

    const fallback = deterministicPolicyMove(game, legalPlacements);
    aiLog("provider.result", {
      provider: "deterministic",
      game_id: game.id,
      turn_version: game.turnVersion,
      action: fallback.action,
      ai_level: normalizeDifficulty(game.aiLevel),
    });
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
      aiLog("provider.result", {
        provider: "external",
        game_id: game.id,
        turn_version: game.turnVersion,
        model: external.model,
        action: external.move?.action,
      });
      return {
        ...external.move,
        source: external.source,
        responseId: external.responseId,
        model: external.model,
      };
    }

    const fallback = deterministicPolicyMove(game, legalPlacements);
    aiLog("provider.fallback", {
      provider: "external",
      game_id: game.id,
      turn_version: game.turnVersion,
      reason: external?.reason ?? "external_failed",
    });
    return {
      ...fallback,
      source: external?.source ?? "external",
      externalError: external?.reason ?? "external_failed",
      model: "deterministic-policy",
      responseId: null,
    };
  }

  const deterministic = deterministicPolicyMove(game, legalPlacements);
  aiLog("provider.result", {
    provider: "deterministic",
    game_id: game.id,
    turn_version: game.turnVersion,
    action: deterministic.action,
    ai_level: normalizeDifficulty(game.aiLevel),
  });
  return {
    ...deterministic,
    source: "deterministic",
    externalError: null,
    model: "deterministic-policy",
    responseId: null,
  };
}
