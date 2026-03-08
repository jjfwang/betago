/**
 * Unit tests for the API client.
 *
 * All network calls are mocked via `global.fetch` so no real HTTP requests
 * are made during testing.
 */

import {
  createOrResumeGame,
  fetchGame,
  submitAction,
  ApiClientError,
} from "@/lib/api";
import type { Game } from "@/types/game";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "game-1",
    board_size: 9,
    komi: 5.5,
    ai_level: "medium",
    status: "human_turn",
    winner: null,
    turn: "B",
    turn_version: 1,
    pending_action: null,
    ai_status: "idle",
    captures: { B: 0, W: 0 },
    board: Array.from({ length: 9 }, () => Array(9).fill(null)),
    legal_moves: [],
    moves: [],
    move_count: 0,
    moves_truncated: false,
    last_ai_rationale: null,
    ...overrides,
  };
}

function mockFetchOk(body: unknown, status = 200) {
  const mockFetch = jest.fn().mockResolvedValueOnce({
    ok: true,
    status,
    json: async () => body,
  } as Response);
  global.fetch = mockFetch;
  return mockFetch;
}

function mockFetchError(body: unknown, status = 400) {
  const mockFetch = jest.fn().mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => body,
  } as Response);
  global.fetch = mockFetch;
  return mockFetch;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

afterEach(() => {
  jest.restoreAllMocks();
});

describe("createOrResumeGame", () => {
  it("calls POST /api/games and returns the game", async () => {
    const game = makeGame();
    const spy = mockFetchOk({ game });

    const result = await createOrResumeGame();

    expect(spy).toHaveBeenCalledWith(
      "/api/games",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual(game);
  });

  it("passes force_new and ai_level in the request body", async () => {
    const game = makeGame({ ai_level: "hard" });
    const spy = mockFetchOk({ game });

    await createOrResumeGame({ force_new: true, ai_level: "hard" });

    const [, init] = spy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ force_new: true, ai_level: "hard" });
  });

  it("throws ApiClientError on a non-2xx response", async () => {
    mockFetchError({ error: "session_not_found" }, 404);

    await expect(createOrResumeGame()).rejects.toBeInstanceOf(ApiClientError);
  });

  it("includes the error code in the thrown ApiClientError", async () => {
    mockFetchError({ error: "rate_limited" }, 429);

    try {
      await createOrResumeGame();
      throw new Error("Expected ApiClientError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).code).toBe("rate_limited");
    }
  });
});

describe("fetchGame", () => {
  it("calls GET /api/games/:id and returns the game", async () => {
    const game = makeGame({ id: "abc-123" });
    const spy = mockFetchOk({ game });

    const result = await fetchGame("abc-123");

    expect(spy).toHaveBeenCalledWith(
      "/api/games/abc-123",
      expect.any(Object),
    );
    expect(result.id).toBe("abc-123");
  });

  it("throws ApiClientError on 403", async () => {
    mockFetchError({ error: "forbidden" }, 403);

    await expect(fetchGame("abc-123")).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe("submitAction", () => {
  it("calls POST /api/games/:id/actions with the action body", async () => {
    const game = makeGame({ turn_version: 2, status: "ai_thinking" });
    const spy = mockFetchOk({ game, idempotent: false });

    const result = await submitAction("game-1", {
      action: "place",
      action_id: "uuid-1",
      expected_turn_version: 1,
      x: 3,
      y: 3,
    });

    expect(spy).toHaveBeenCalledWith(
      "/api/games/game-1/actions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.game.turn_version).toBe(2);
    expect(result.idempotent).toBe(false);
  });

  it("returns idempotent=true for a duplicate action", async () => {
    const game = makeGame({ turn_version: 2 });
    mockFetchOk({ game, idempotent: true });

    const result = await submitAction("game-1", {
      action: "pass",
      action_id: "uuid-already-seen",
      expected_turn_version: 1,
    });

    expect(result.idempotent).toBe(true);
  });

  it("includes current_turn_version in ApiClientError for stale version", async () => {
    mockFetchError(
      { error: "stale_turn_version", current_turn_version: 5 },
      409,
    );

    try {
      await submitAction("game-1", {
        action: "place",
        action_id: "uuid-2",
        expected_turn_version: 3,
        x: 0,
        y: 0,
      });
      throw new Error("Expected ApiClientError");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).currentTurnVersion).toBe(5);
    }
  });
});

describe("openGameEventSource", () => {
  // We need to import openGameEventSource separately since the existing imports
  // don't include it.
  let openGameEventSource: typeof import("@/lib/api").openGameEventSource;

  beforeAll(async () => {
    ({ openGameEventSource } = await import("@/lib/api"));
  });

  /** Build a minimal EventSource mock. */
  function makeEventSourceMock() {
    const listeners: Record<string, ((event: MessageEvent) => void)[]> = {};
    let errorHandler: ((event: Event) => void) | null = null;
    const mock = {
      addEventListener: jest.fn(
        (type: string, handler: (event: MessageEvent) => void) => {
          if (!listeners[type]) listeners[type] = [];
          listeners[type].push(handler);
        },
      ),
      set onerror(handler: (event: Event) => void) {
        errorHandler = handler;
      },
      close: jest.fn(),
      // Test helpers
      _emit(type: string, data: unknown) {
        const event = { data: JSON.stringify(data) } as MessageEvent;
        (listeners[type] ?? []).forEach((h) => h(event));
      },
      _emitError() {
        errorHandler?.(new Event("error"));
      },
    };
    return mock;
  }

  let MockEventSource: ReturnType<typeof makeEventSourceMock>;

  beforeEach(() => {
    MockEventSource = makeEventSourceMock();
    // Replace the global EventSource with the mock.
    (global as unknown as Record<string, unknown>).EventSource = jest.fn(
      () => MockEventSource,
    );
  });

  afterEach(() => {
    delete (global as unknown as Record<string, unknown>).EventSource;
  });

  it("opens an EventSource to /api/games/:id/events", () => {
    openGameEventSource("game-42", jest.fn(), jest.fn());
    expect(global.EventSource).toHaveBeenCalledWith(
      "/api/games/game-42/events",
    );
  });

  it("calls onGame callback when a game event is received", () => {
    const onGame = jest.fn();
    openGameEventSource("game-1", onGame, jest.fn());
    const game = makeGame({ id: "game-1", turn_version: 7 });
    MockEventSource._emit("game", game);
    expect(onGame).toHaveBeenCalledWith(expect.objectContaining({ turn_version: 7 }));
  });

  it("calls onError callback when the connection errors", () => {
    const onError = jest.fn();
    openGameEventSource("game-1", jest.fn(), onError);
    MockEventSource._emitError();
    expect(onError).toHaveBeenCalled();
  });

  it("returns a cleanup function that closes the EventSource", () => {
    const close = openGameEventSource("game-1", jest.fn(), jest.fn());
    close();
    expect(MockEventSource.close).toHaveBeenCalledTimes(1);
  });

  it("does not call onGame for malformed JSON data", () => {
    const onGame = jest.fn();
    openGameEventSource("game-1", onGame, jest.fn());
    // Emit a raw event with invalid JSON directly.
    const badEvent = { data: "not-valid-json" } as MessageEvent;
    const gameListeners = (MockEventSource.addEventListener as jest.Mock).mock.calls
      .filter(([type]: [string]) => type === "game")
      .map(([, handler]: [string, (e: MessageEvent) => void]) => handler);
    gameListeners.forEach((h) => h(badEvent));
    expect(onGame).not.toHaveBeenCalled();
  });
});
