import { aiLog, aiLogPrompt } from "./logger.js";
import { validateAIAction } from "./schema.js";
import { rankGoMoves, recommendedGoMove } from "./heuristics.js";

const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? "8000", 10);
const PROMPT_VERSION = "1.1";
const DIFFICULTIES = new Set(["entry", "medium", "hard"]);
const OPENAI_DEFAULT_MODEL = "gpt-4.1-mini";
const OPENAI_MAX_OUTPUT_TOKENS = 220;

let testProvider = null;

export function setTestProvider(provider) {
  testProvider = provider;
}

function normalizeDifficulty(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return DIFFICULTIES.has(v) ? v : "medium";
}

function parseAIAction(raw) {
  const valid = validateAIAction(raw);
  if (!valid) {
    aiLog("external.response.invalid_schema", {
      errors: validateAIAction.errors,
      raw_input: raw,
    });
    throw new Error("malformed");
  }

  const rationale = typeof raw.rationale === "string" ? raw.rationale.slice(0, 240) : "";

  if (raw.action === "place") {
    return { action: "place", x: raw.x, y: raw.y, rationale };
  }

  return { action: raw.action, rationale };
}

function getConfiguredApiKey() {
  return process.env.LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
}

function getConfiguredApiUrl() {
  return (
    process.env.LLM_API_URL?.trim() ||
    process.env.OPENAI_API_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    ""
  );
}

function getConfiguredModel(aiLevel = "medium") {
  const normalizedLevel = normalizeDifficulty(aiLevel);
  if (normalizedLevel === "hard") {
    return (
      process.env.LLM_MODEL_HARD?.trim() ||
      process.env.OPENAI_MODEL_HARD?.trim() ||
      process.env.LLM_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      OPENAI_DEFAULT_MODEL
    );
  }

  if (normalizedLevel === "entry") {
    return (
      process.env.LLM_MODEL_ENTRY?.trim() ||
      process.env.OPENAI_MODEL_ENTRY?.trim() ||
      process.env.LLM_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      OPENAI_DEFAULT_MODEL
    );
  }

  return process.env.LLM_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || OPENAI_DEFAULT_MODEL;
}

function normalizeEndpoint(url) {
  try {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
    if (parsed.hostname === "api.openai.com") {
      if (
        normalizedPath === "/" ||
        normalizedPath === "/v1" ||
        normalizedPath === "/v1/chat/completions" ||
        normalizedPath === "/v1/completions"
      ) {
        parsed.pathname = "/v1/responses";
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function isResponsesEndpoint(url) {
  try {
    return new URL(url).pathname.endsWith("/responses");
  } catch {
    return /\/responses(?:\?|$)/.test(url);
  }
}

function summarizeGoCandidates(game, legalPlacements) {
  return rankGoMoves({
    board: game.board,
    positionHistory: game.positionHistory,
    legalPlacements,
    color: "W",
    limit: 12,
  });
}

function buildGoStrategyNotes(aiLevel) {
  switch (normalizeDifficulty(aiLevel)) {
    case "entry":
      return [
        "Play simple, natural moves.",
        "Prefer safe moves near the center or near existing stones.",
        "Take obvious captures when available.",
        "Avoid risky fights unless the gain is clear.",
      ];
    case "hard":
      return [
        "Play strong, disciplined Go.",
        "Prioritize tactical correctness first: save stones in atari, capture when profitable, and avoid self-atari.",
        "Favor moves that improve liberties, connect groups, pressure weak enemy stones, or secure efficient territory.",
        "Use pass only when the board is effectively settled or there are no worthwhile legal plays.",
      ];
    case "medium":
    default:
      return [
        "Play solid, sensible Go.",
        "Prefer legal moves that capture, connect, defend weak groups, or take useful central influence.",
        "Avoid empty flashy moves with little tactical value.",
      ];
  }
}

function buildGamePayload(game, legalPlacements) {
  const legal = legalPlacements.map((move) => ({ x: move.x, y: move.y, captures: move.captures ?? 0 }));
  const recommendedMove = recommendedGoMove({
    board: game.board,
    positionHistory: game.positionHistory,
    legalPlacements,
    color: "W",
  });

  return {
    prompt_version: PROMPT_VERSION,
    game_id: game.id,
    board_size: game.boardSize,
    turn: "ai",
    ai_color: "W",
    ai_level: normalizeDifficulty(game.aiLevel),
    komi: game.komi,
    turn_version: game.turnVersion,
    board: game.board,
    captures: game.captures ?? null,
    legal_moves: legal,
    candidate_moves: summarizeGoCandidates(game, legalPlacements),
    heuristic_recommendation: recommendedMove,
    moves: game.moves.slice(-20),
    output_schema: {
      action: "place|pass|resign",
      x: "integer if action=place",
      y: "integer if action=place",
      rationale: "optional short string",
    },
  };
}

function buildOpenAIRequest(game, payload) {
  return {
    model: getConfiguredModel(game.aiLevel),
    instructions: [
      "You are the white player in a game of Go.",
      "Think privately and choose the strongest legal move you can from the provided position.",
      ...buildGoStrategyNotes(game.aiLevel),
      "Use legal_moves as the source of truth. candidate_moves are heuristically ranked hints generated by the local rule engine.",
      "Prefer tactically sound moves that preserve liberties, capture stones, connect weak groups, or put enemy groups into atari.",
      "Return only valid JSON.",
      'Use exactly this shape: {"action":"place|pass|resign","x":0,"y":0,"rationale":"optional short string"}.',
      'If action is "place", x and y are required and must match one of the legal_moves entries exactly.',
      'If action is "pass" or "resign", omit x and y.',
      "Coordinates are zero-based.",
      "Keep rationale short and user-facing; do not reveal private reasoning.",
      "Do not include markdown or extra text.",
    ].join("\n"),
    input: `Game state JSON:\n${JSON.stringify(payload)}`,
    text: {
      format: {
        type: "json_object",
      },
    },
    max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
    metadata: {
      game_id: game.id,
      prompt_version: PROMPT_VERSION,
      ai_level: normalizeDifficulty(game.aiLevel),
    },
  };
}

function extractOpenAIOutputText(result) {
  if (typeof result?.output_text === "string" && result.output_text.trim()) {
    return result.output_text;
  }

  for (const item of result?.output ?? []) {
    if (item?.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
    }
  }

  return "";
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
      const errorBody = await resp.text().catch(() => "");
      aiLog("external.response.http_error", {
        url,
        status: resp.status,
        body: errorBody,
      });
      throw new Error(`llm_http_${resp.status}`);
    }

    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function requestGenericExternalMove(url, game, payload) {
  const headers = {};
  const apiKey = getConfiguredApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  aiLog("external.request.start", {
    game_id: game.id,
    turn_version: game.turnVersion,
    ai_level: normalizeDifficulty(game.aiLevel),
    endpoint: url,
    legal_moves_count: payload.legal_moves.length,
  });
  aiLogPrompt("external.request.payload", payload);

  const result = await postJson(url, payload, headers);
  const parsed = parseAIAction(result?.action ? result : result?.data ?? result?.output);

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
    ...parsed,
    source: "external",
    responseId: result?.response_id ?? result?.id ?? null,
    model: result?.model ?? "external-api",
    promptVersion: PROMPT_VERSION,
    externalError: null,
  };
}

async function requestOpenAIResponsesMove(url, game, payload) {
  const headers = {};
  const apiKey = getConfiguredApiKey();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const requestBody = buildOpenAIRequest(game, payload);
  aiLog("external.request.start", {
    game_id: game.id,
    turn_version: game.turnVersion,
    ai_level: normalizeDifficulty(game.aiLevel),
    endpoint: url,
    legal_moves_count: payload.legal_moves.length,
    model: requestBody.model,
  });
  aiLogPrompt("external.request.payload", requestBody);

  const result = await postJson(url, requestBody, headers);
  const outputText = extractOpenAIOutputText(result);
  if (!outputText) {
    aiLog("external.response.invalid_openai_output", {
      game_id: game.id,
      turn_version: game.turnVersion,
      response_id: result?.id ?? null,
      status: result?.status ?? null,
      error: result?.error ?? null,
    });
    throw new Error("malformed");
  }

  let raw;
  try {
    raw = JSON.parse(outputText);
  } catch {
    aiLog("external.response.invalid_json", {
      game_id: game.id,
      turn_version: game.turnVersion,
      response_id: result?.id ?? null,
      output_text: outputText,
    });
    throw new Error("malformed");
  }

  const parsed = parseAIAction(raw);
  aiLog("external.response.ok", {
    game_id: game.id,
    turn_version: game.turnVersion,
    model: result?.model ?? requestBody.model,
    response_id: result?.id ?? null,
    action: parsed.action,
    x: parsed.x ?? null,
    y: parsed.y ?? null,
  });

  return {
    ...parsed,
    source: "external",
    responseId: result?.id ?? null,
    model: result?.model ?? requestBody.model,
    promptVersion: PROMPT_VERSION,
    externalError: null,
  };
}

async function requestExternalMove(game, legalPlacements) {
  const configuredUrl = getConfiguredApiUrl();
  if (!configuredUrl) {
    throw new Error("llm_api_url_missing");
  }

  const url = normalizeEndpoint(configuredUrl);
  const payload = buildGamePayload(game, legalPlacements);

  if (isResponsesEndpoint(url)) {
    return requestOpenAIResponsesMove(url, game, payload);
  }

  return requestGenericExternalMove(url, game, payload);
}

export async function selectAIMove(game, legalPlacements) {
  const provider = testProvider ? "test" : "external";
  aiLog("provider.selected", {
    game_id: game.id,
    turn_version: game.turnVersion,
    provider,
    ai_level: normalizeDifficulty(game.aiLevel),
    legal_moves_count: legalPlacements.length,
  });

  if (testProvider) {
    const move = await testProvider(game, legalPlacements);
    return {
      ...move,
      source: "test-provider",
      responseId: null,
      model: "test-provider",
      promptVersion: "test-provider",
      externalError: null,
    };
  }

  const move = await requestExternalMove(game, legalPlacements);
  aiLog("provider.result", {
    provider: "external",
    game_id: game.id,
    turn_version: game.turnVersion,
    model: move.model,
    action: move.action,
  });
  return move;
}
