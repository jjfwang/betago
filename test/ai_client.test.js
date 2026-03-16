import test from "node:test";
import assert from "node:assert/strict";
import { selectAIMove } from "../src/ai/client.js";

function buildGame() {
  return {
    id: "game-123",
    boardSize: 19,
    aiLevel: "medium",
    komi: 5.5,
    turnVersion: 1,
    board: Array.from({ length: 19 }, () => Array(19).fill(null)),
    moves: [
      {
        id: "move-1",
        move_index: 0,
        player: "human",
        action: "place",
        coordinate: "K10",
      },
    ],
  };
}

function buildLegalPlacements() {
  return [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 18, y: 18 },
  ];
}

const originalFetch = global.fetch;
const originalEnv = {
  LLM_API_URL: process.env.LLM_API_URL,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  OPENAI_API_URL: process.env.OPENAI_API_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
};

test.afterEach(() => {
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
});

test("selectAIMove uses OpenAI Responses API payload and parses JSON output", async () => {
  process.env.LLM_API_URL = "https://api.openai.com/v1/responses";
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "gpt-4.1-mini";

  global.fetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer test-key");

    const payload = JSON.parse(options.body);
    assert.equal(payload.model, "gpt-4.1-mini");
    assert.equal(payload.text.format.type, "json_object");
    assert.match(payload.instructions, /JSON/);
    assert.match(payload.input, /legal_moves/);

    return new Response(
      JSON.stringify({
        id: "resp_123",
        model: "gpt-4.1-mini",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  action: "place",
                  x: 10,
                  y: 10,
                  rationale: "Play near the center.",
                }),
              },
            ],
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const move = await selectAIMove(buildGame(), buildLegalPlacements());
  assert.deepEqual(move, {
    action: "place",
    x: 10,
    y: 10,
    rationale: "Play near the center.",
    source: "external",
    responseId: "resp_123",
    model: "gpt-4.1-mini",
    promptVersion: "1.1",
    externalError: null,
  });
});

test("selectAIMove still supports legacy JSON endpoints", async () => {
  process.env.LLM_API_URL = "https://example.com/go-move";
  process.env.LLM_API_KEY = "legacy-key";

  global.fetch = async (url, options) => {
    assert.equal(url, "https://example.com/go-move");
    assert.equal(options.headers.Authorization, "Bearer legacy-key");

    const payload = JSON.parse(options.body);
    assert.equal(payload.prompt_version, "1.1");
    assert.equal(payload.board_size, 19);
    assert.equal(payload.legal_moves.length, 3);

    return new Response(
      JSON.stringify({
        action: "pass",
        rationale: "No urgent move.",
        model: "legacy-model",
        response_id: "legacy-123",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const move = await selectAIMove(buildGame(), buildLegalPlacements());
  assert.deepEqual(move, {
    action: "pass",
    rationale: "No urgent move.",
    source: "external",
    responseId: "legacy-123",
    model: "legacy-model",
    promptVersion: "1.1",
    externalError: null,
  });
});

test("selectAIMove normalizes common OpenAI endpoints to the Responses API", async () => {
  process.env.LLM_API_URL = "https://api.openai.com/v1/chat/completions";
  process.env.LLM_API_KEY = "test-key";

  global.fetch = async (url) => {
    assert.equal(url, "https://api.openai.com/v1/responses");

    return new Response(
      JSON.stringify({
        id: "resp_normalized",
        output_text: JSON.stringify({ action: "pass" }),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const move = await selectAIMove(buildGame(), buildLegalPlacements());
  assert.equal(move.action, "pass");
  assert.equal(move.responseId, "resp_normalized");
});

test("selectAIMove falls back to OPENAI_API_URL when LLM_API_URL is unset", async () => {
  delete process.env.LLM_API_URL;
  process.env.OPENAI_API_URL = "https://api.openai.com/v1";
  process.env.OPENAI_API_KEY = "test-key";

  global.fetch = async (url) => {
    assert.equal(url, "https://api.openai.com/v1/responses");

    return new Response(
      JSON.stringify({
        id: "resp_fallback",
        output_text: JSON.stringify({ action: "pass" }),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const move = await selectAIMove(buildGame(), buildLegalPlacements());
  assert.equal(move.action, "pass");
  assert.equal(move.responseId, "resp_fallback");
});
