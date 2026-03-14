import { aiLog, aiLogPrompt } from "../ai/logger.js";

const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? "8000", 10);
const PROMPT_VERSION = "1.0";
const OPENAI_DEFAULT_MODEL = "gpt-4.1-mini";
const OPENAI_MAX_OUTPUT_TOKENS = 220;
const DIFFICULTIES = new Set(["entry", "medium", "hard"]);

let testProvider = null;

export function setChessTestProvider(provider) {
  testProvider = provider;
}

function normalizeDifficulty(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return DIFFICULTIES.has(v) ? v : "medium";
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

function getConfiguredModel() {
  return process.env.LLM_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || OPENAI_DEFAULT_MODEL;
}

function normalizeEndpoint(url) {
  try {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
    if (
      parsed.hostname === "api.openai.com" &&
      (normalizedPath === "/" ||
        normalizedPath === "/v1" ||
        normalizedPath === "/v1/chat/completions" ||
        normalizedPath === "/v1/completions")
    ) {
      parsed.pathname = "/v1/responses";
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

function buildPayload(game, legalMoves) {
  return {
    prompt_version: PROMPT_VERSION,
    game_id: game.id,
    variant: "chess",
    side_to_move: "black",
    ai_color: "black",
    ai_level: normalizeDifficulty(game.aiLevel),
    fen: game.fen,
    legal_moves: legalMoves.map((move) => ({
      uci: move.uci,
      notation: move.notation,
      from: move.from,
      to: move.to,
      promotion: move.promotion ?? null,
    })),
    move_history: game.moves.slice(-24).map((move) => ({
      move_index: move.move_index,
      player: move.player,
      notation: move.notation ?? move.action,
    })),
    output_schema: {
      action: "move|resign",
      move: "UCI string like e7e5 when action=move",
      rationale: "optional short string",
    },
  };
}

function buildOpenAIRequest(game, payload) {
  return {
    model: getConfiguredModel(),
    instructions: [
      "You are the black player in a chess game.",
      "Return only valid JSON.",
      'Use exactly this shape: {"action":"move|resign","move":"e7e5","rationale":"optional short string"}.',
      'If action is "move", move must exactly match one entry from legal_moves. Use the uci field.',
      'If action is "resign", omit move.',
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
      variant: "chess",
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
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      aiLog("chess.external.response.http_error", {
        url,
        status: response.status,
        body: errorBody,
      });
      throw new Error(`llm_http_${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseMoveResponse(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("malformed");
  }

  const action = typeof raw.action === "string" ? raw.action.trim().toLowerCase() : "";
  const rationale = typeof raw.rationale === "string" ? raw.rationale.slice(0, 240) : "";

  if (action === "resign") {
    return { action: "resign", rationale };
  }

  const move = typeof raw.move === "string" ? raw.move.trim().toLowerCase() : "";
  if (action !== "move" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(move)) {
    throw new Error("malformed");
  }

  return { action: "move", move, rationale };
}

async function requestGenericExternalMove(url, game, payload) {
  const apiKey = getConfiguredApiKey();
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

  aiLog("chess.external.request.start", {
    game_id: game.id,
    turn_version: game.turnVersion,
    endpoint: url,
    model: "external-api",
  });
  aiLogPrompt("chess.external.request.payload", payload);

  const result = await postJson(url, payload, headers);
  const parsed = parseMoveResponse(result?.action ? result : result?.data ?? result?.output);

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
  const apiKey = getConfiguredApiKey();
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const requestBody = buildOpenAIRequest(game, payload);

  aiLog("chess.external.request.start", {
    game_id: game.id,
    turn_version: game.turnVersion,
    endpoint: url,
    model: requestBody.model,
  });
  aiLogPrompt("chess.external.request.payload", requestBody);

  const result = await postJson(url, requestBody, headers);
  const outputText = extractOpenAIOutputText(result);
  if (!outputText) {
    throw new Error("malformed");
  }

  let raw;
  try {
    raw = JSON.parse(outputText);
  } catch {
    throw new Error("malformed");
  }

  const parsed = parseMoveResponse(raw);
  return {
    ...parsed,
    source: "external",
    responseId: result?.id ?? null,
    model: result?.model ?? requestBody.model,
    promptVersion: PROMPT_VERSION,
    externalError: null,
  };
}

export async function selectChessAIMove(game, legalMoves) {
  if (testProvider) {
    const move = await testProvider(game, legalMoves);
    return {
      ...move,
      source: "test-provider",
      responseId: null,
      model: "test-provider",
      promptVersion: "test-provider",
      externalError: null,
    };
  }

  const configuredUrl = getConfiguredApiUrl();
  if (!configuredUrl) {
    throw new Error("llm_api_url_missing");
  }

  const url = normalizeEndpoint(configuredUrl);
  const payload = buildPayload(game, legalMoves);

  if (isResponsesEndpoint(url)) {
    return requestOpenAIResponsesMove(url, game, payload);
  }

  return requestGenericExternalMove(url, game, payload);
}
