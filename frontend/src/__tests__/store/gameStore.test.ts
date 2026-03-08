/**
 * Unit tests for the Zustand game store.
 *
 * The API client module is mocked so no real network calls are made.
 *
 * New tests added:
 *  - Stale turn version recovery (placeStone, pass, resign auto-refresh).
 *  - SSE reconnection with exponential backoff.
 *  - Polling fallback when SSE exhausts retries.
 *  - _startPolling / _stopPolling lifecycle.
 *  - _refreshGame fetches latest state.
 *  - applyGameUpdate stops polling when game leaves ai_thinking.
 */
import { act } from "react";
import { useGameStore, selectHumanMoveEnabled, MAX_SSE_RETRIES } from "@/store/gameStore";
import type { Game } from "@/types/game";

// ── Mock the API client ───────────────────────────────────────────────────────

// jest.mock() is hoisted to the top of the file by Babel/Jest, which means
// any class or variable defined in the module scope is NOT yet initialised
// when the factory runs.  We therefore define MockApiClientError *inside* the
// factory so it is available at hoist time, and then retrieve it from the
// mocked module for use in individual tests.
jest.mock("@/lib/api", () => {
  class MockApiClientError extends Error {
    code: string;
    currentTurnVersion?: number;
    constructor(code: string, currentTurnVersion?: number) {
      super(code);
      this.name = "ApiClientError";
      this.code = code;
      this.currentTurnVersion = currentTurnVersion;
    }
  }
  return {
    createOrResumeGame: jest.fn(),
    fetchGame: jest.fn(),
    submitAction: jest.fn(),
    openGameEventSource: jest.fn(() => jest.fn()), // returns a no-op cleanup
    ApiClientError: MockApiClientError,
  };
});

import * as api from "@/lib/api";

// Retrieve the mock class from the mocked module so test bodies can
// instantiate it for stale-turn-version error scenarios.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockApiClientError = (api as any).ApiClientError as new (
  code: string,
  currentTurnVersion?: number,
) => { code: string; message: string };

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
    legal_moves: [{ x: 3, y: 3 }],
    moves: [],
    move_count: 0,
    moves_truncated: false,
    last_ai_rationale: null,
    ...overrides,
  };
}

/** Reset the Zustand store to its initial state between tests. */
function resetStore() {
  useGameStore.setState({
    game: null,
    loadingState: "idle",
    errorMessage: null,
    _closeEventSource: null,
    _pollIntervalId: null,
    _sseRetryCount: 0,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("startGame", () => {
  it("sets loadingState=idle and game after successful API call", async () => {
    const game = makeGame();
    (api.createOrResumeGame as jest.Mock).mockResolvedValueOnce(game);
    await act(async () => {
      await useGameStore.getState().startGame();
    });
    const state = useGameStore.getState();
    expect(state.game).toEqual(game);
    expect(state.loadingState).toBe("idle");
    expect(state.errorMessage).toBeNull();
  });

  it("sets loadingState=error on API failure", async () => {
    (api.createOrResumeGame as jest.Mock).mockRejectedValueOnce(
      new Error("network_error"),
    );
    await act(async () => {
      await useGameStore.getState().startGame();
    });
    const state = useGameStore.getState();
    expect(state.loadingState).toBe("error");
    expect(state.errorMessage).toBe("network_error");
    expect(state.game).toBeNull();
  });

  it("passes force_new and aiLevel to the API", async () => {
    const game = makeGame({ ai_level: "hard" });
    (api.createOrResumeGame as jest.Mock).mockResolvedValueOnce(game);
    await act(async () => {
      await useGameStore.getState().startGame({ forceNew: true, aiLevel: "hard" });
    });
    expect(api.createOrResumeGame).toHaveBeenCalledWith({
      force_new: true,
      ai_level: "hard",
    });
  });

  it("calls openGameEventSource after loading the game", async () => {
    const game = makeGame();
    (api.createOrResumeGame as jest.Mock).mockResolvedValueOnce(game);
    await act(async () => {
      await useGameStore.getState().startGame();
    });
    expect(api.openGameEventSource).toHaveBeenCalledWith(
      game.id,
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("resets _sseRetryCount to 0 on startGame", async () => {
    useGameStore.setState({ _sseRetryCount: 3 });
    const game = makeGame();
    (api.createOrResumeGame as jest.Mock).mockResolvedValueOnce(game);
    await act(async () => {
      await useGameStore.getState().startGame();
    });
    expect(useGameStore.getState()._sseRetryCount).toBe(0);
  });

  it("tears down existing SSE connection before starting a new game", async () => {
    const closeFn = jest.fn();
    useGameStore.setState({ _closeEventSource: closeFn });
    const game = makeGame();
    (api.createOrResumeGame as jest.Mock).mockResolvedValueOnce(game);
    await act(async () => {
      await useGameStore.getState().startGame();
    });
    // closeFn is called at least once: once in startGame and once in _connectSSE
    // (which also closes any existing connection before opening a new one).
    expect(closeFn).toHaveBeenCalled();
  });
});

describe("placeStone", () => {
  it("submits a place action and updates game state", async () => {
    const initialGame = makeGame({ turn_version: 1 });
    const updatedGame = makeGame({
      turn_version: 2,
      status: "ai_thinking",
    });
    useGameStore.setState({ game: initialGame, loadingState: "idle" });
    (api.submitAction as jest.Mock).mockResolvedValueOnce({
      game: updatedGame,
      idempotent: false,
    });
    await act(async () => {
      await useGameStore.getState().placeStone(3, 3);
    });
    expect(api.submitAction).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({
        action: "place",
        x: 3,
        y: 3,
        expected_turn_version: 1,
      }),
    );
    expect(useGameStore.getState().game?.turn_version).toBe(2);
    expect(useGameStore.getState().loadingState).toBe("idle");
  });

  it("does nothing when game is null", async () => {
    await act(async () => {
      await useGameStore.getState().placeStone(0, 0);
    });
    expect(api.submitAction).not.toHaveBeenCalled();
  });

  it("does nothing when status is ai_thinking", async () => {
    useGameStore.setState({ game: makeGame({ status: "ai_thinking" }) });
    await act(async () => {
      await useGameStore.getState().placeStone(0, 0);
    });
    expect(api.submitAction).not.toHaveBeenCalled();
  });

  it("sets error on API failure", async () => {
    useGameStore.setState({ game: makeGame(), loadingState: "idle" });
    (api.submitAction as jest.Mock).mockRejectedValueOnce(
      new Error("invalid_coordinate"),
    );
    await act(async () => {
      await useGameStore.getState().placeStone(0, 0);
    });
    expect(useGameStore.getState().loadingState).toBe("error");
    expect(useGameStore.getState().errorMessage).toBe("invalid_coordinate");
  });

  it("refreshes game state on stale_turn_version error", async () => {
    const initialGame = makeGame({ turn_version: 1 });
    const refreshedGame = makeGame({ turn_version: 3, status: "ai_thinking" });
    useGameStore.setState({ game: initialGame, loadingState: "idle" });
    (api.submitAction as jest.Mock).mockRejectedValueOnce(
      new MockApiClientError("stale_turn_version", 3),
    );
    (api.fetchGame as jest.Mock).mockResolvedValueOnce(refreshedGame);
    await act(async () => {
      await useGameStore.getState().placeStone(0, 0);
    });
    expect(api.fetchGame).toHaveBeenCalledWith("game-1");
    expect(useGameStore.getState().game?.turn_version).toBe(3);
    expect(useGameStore.getState().loadingState).toBe("idle");
  });
});

describe("pass", () => {
  it("submits a pass action", async () => {
    const game = makeGame();
    const updated = makeGame({ turn_version: 2, status: "ai_thinking" });
    useGameStore.setState({ game, loadingState: "idle" });
    (api.submitAction as jest.Mock).mockResolvedValueOnce({
      game: updated,
      idempotent: false,
    });
    await act(async () => {
      await useGameStore.getState().pass();
    });
    expect(api.submitAction).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({ action: "pass" }),
    );
  });

  it("refreshes game state on stale_turn_version error", async () => {
    const game = makeGame({ turn_version: 1 });
    const refreshed = makeGame({ turn_version: 2, status: "ai_thinking" });
    useGameStore.setState({ game, loadingState: "idle" });
    (api.submitAction as jest.Mock).mockRejectedValueOnce(
      new MockApiClientError("stale_turn_version", 2),
    );
    (api.fetchGame as jest.Mock).mockResolvedValueOnce(refreshed);
    await act(async () => {
      await useGameStore.getState().pass();
    });
    expect(api.fetchGame).toHaveBeenCalledWith("game-1");
    expect(useGameStore.getState().game?.turn_version).toBe(2);
  });
});

describe("resign", () => {
  it("submits a resign action and sets finished status", async () => {
    const game = makeGame();
    const finished = makeGame({ status: "finished", winner: "W" });
    useGameStore.setState({ game, loadingState: "idle" });
    (api.submitAction as jest.Mock).mockResolvedValueOnce({
      game: finished,
      idempotent: false,
    });
    await act(async () => {
      await useGameStore.getState().resign();
    });
    expect(useGameStore.getState().game?.status).toBe("finished");
    expect(useGameStore.getState().game?.winner).toBe("W");
  });

  it("refreshes game state on stale_turn_version error", async () => {
    const game = makeGame({ turn_version: 1 });
    const refreshed = makeGame({ turn_version: 2, status: "ai_thinking" });
    useGameStore.setState({ game, loadingState: "idle" });
    (api.submitAction as jest.Mock).mockRejectedValueOnce(
      new MockApiClientError("stale_turn_version", 2),
    );
    (api.fetchGame as jest.Mock).mockResolvedValueOnce(refreshed);
    await act(async () => {
      await useGameStore.getState().resign();
    });
    expect(api.fetchGame).toHaveBeenCalledWith("game-1");
    expect(useGameStore.getState().game?.turn_version).toBe(2);
  });
});

describe("applyGameUpdate", () => {
  it("replaces the game state with the new game", () => {
    const initial = makeGame({ turn_version: 1 });
    const updated = makeGame({ turn_version: 3 });
    useGameStore.setState({ game: initial });
    act(() => {
      useGameStore.getState().applyGameUpdate(updated);
    });
    expect(useGameStore.getState().game?.turn_version).toBe(3);
    expect(useGameStore.getState().loadingState).toBe("idle");
  });

  it("stops polling when game leaves ai_thinking state", () => {
    const intervalId = setInterval(() => {}, 9999) as ReturnType<typeof setInterval>;
    useGameStore.setState({
      game: makeGame({ status: "ai_thinking" }),
      _pollIntervalId: intervalId,
    });
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    act(() => {
      useGameStore.getState().applyGameUpdate(makeGame({ status: "human_turn" }));
    });
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
    expect(useGameStore.getState()._pollIntervalId).toBeNull();
  });

  it("does not stop polling when game stays in ai_thinking", () => {
    const intervalId = setInterval(() => {}, 9999) as ReturnType<typeof setInterval>;
    useGameStore.setState({
      game: makeGame({ status: "ai_thinking" }),
      _pollIntervalId: intervalId,
    });
    const clearIntervalSpy = jest.spyOn(global, "clearInterval");
    act(() => {
      useGameStore.getState().applyGameUpdate(makeGame({ status: "ai_thinking" }));
    });
    expect(clearIntervalSpy).not.toHaveBeenCalled();
    // Clean up
    clearInterval(intervalId);
  });
});

describe("clearError", () => {
  it("clears the error message", () => {
    useGameStore.setState({ errorMessage: "some error" });
    act(() => {
      useGameStore.getState().clearError();
    });
    expect(useGameStore.getState().errorMessage).toBeNull();
  });
});

describe("_refreshGame", () => {
  it("fetches the latest game and updates the store", async () => {
    const refreshed = makeGame({ turn_version: 5 });
    (api.fetchGame as jest.Mock).mockResolvedValueOnce(refreshed);
    await act(async () => {
      await useGameStore.getState()._refreshGame("game-1");
    });
    expect(api.fetchGame).toHaveBeenCalledWith("game-1");
    expect(useGameStore.getState().game?.turn_version).toBe(5);
    expect(useGameStore.getState().loadingState).toBe("idle");
  });

  it("sets error state when fetch fails", async () => {
    (api.fetchGame as jest.Mock).mockRejectedValueOnce(new Error("network_error"));
    await act(async () => {
      await useGameStore.getState()._refreshGame("game-1");
    });
    expect(useGameStore.getState().loadingState).toBe("error");
    expect(useGameStore.getState().errorMessage).toBe("Failed to refresh game state.");
  });
});

describe("_startPolling / _stopPolling", () => {
  it("sets a polling interval and clears it on stop", () => {
    const game = makeGame({ status: "ai_thinking" });
    useGameStore.setState({ game });
    act(() => {
      useGameStore.getState()._startPolling("game-1");
    });
    expect(useGameStore.getState()._pollIntervalId).not.toBeNull();
    act(() => {
      useGameStore.getState()._stopPolling();
    });
    expect(useGameStore.getState()._pollIntervalId).toBeNull();
  });

  it("polls fetchGame at the configured interval", async () => {
    const game = makeGame({ status: "ai_thinking" });
    const updated = makeGame({ status: "ai_thinking", turn_version: 2 });
    useGameStore.setState({ game });
    (api.fetchGame as jest.Mock).mockResolvedValue(updated);
    act(() => {
      useGameStore.getState()._startPolling("game-1");
    });
    // Advance timers to trigger one poll tick.
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(api.fetchGame).toHaveBeenCalledWith("game-1");
    // Clean up
    act(() => {
      useGameStore.getState()._stopPolling();
    });
  });

  it("stops polling automatically when game leaves ai_thinking", async () => {
    const game = makeGame({ status: "ai_thinking" });
    const finished = makeGame({ status: "finished", winner: "W" });
    useGameStore.setState({ game });
    (api.fetchGame as jest.Mock).mockResolvedValue(finished);
    act(() => {
      useGameStore.getState()._startPolling("game-1");
    });
    // Advance timers to trigger one poll tick.
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    // After receiving a non-ai_thinking game, polling should stop.
    expect(useGameStore.getState()._pollIntervalId).toBeNull();
  });

  it("does not poll when game id does not match", async () => {
    const game = makeGame({ id: "other-game", status: "ai_thinking" });
    useGameStore.setState({ game });
    act(() => {
      useGameStore.getState()._startPolling("game-1");
    });
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    // fetchGame should not be called because the game id doesn't match.
    expect(api.fetchGame).not.toHaveBeenCalled();
    // Clean up
    act(() => {
      useGameStore.getState()._stopPolling();
    });
  });

  it("_stopPolling is a no-op when no poll is active", () => {
    expect(useGameStore.getState()._pollIntervalId).toBeNull();
    expect(() => {
      act(() => {
        useGameStore.getState()._stopPolling();
      });
    }).not.toThrow();
  });
});

describe("_connectSSE", () => {
  it("opens an SSE connection and stores the cleanup function", () => {
    const closeFn = jest.fn();
    (api.openGameEventSource as jest.Mock).mockReturnValueOnce(closeFn);
    const game = makeGame();
    useGameStore.setState({ game });
    act(() => {
      useGameStore.getState()._connectSSE("game-1");
    });
    expect(api.openGameEventSource).toHaveBeenCalledWith(
      "game-1",
      expect.any(Function),
      expect.any(Function),
    );
    expect(useGameStore.getState()._closeEventSource).toBe(closeFn);
  });

  it("resets _sseRetryCount to 0 on successful game event", () => {
    let onGameCallback: ((game: Game) => void) | null = null;
    (api.openGameEventSource as jest.Mock).mockImplementationOnce(
      (_id: string, onGame: (game: Game) => void) => {
        onGameCallback = onGame;
        return jest.fn();
      },
    );
    useGameStore.setState({ game: makeGame(), _sseRetryCount: 3 });
    act(() => {
      useGameStore.getState()._connectSSE("game-1");
    });
    const updatedGame = makeGame({ turn_version: 2 });
    act(() => {
      onGameCallback!(updatedGame);
    });
    expect(useGameStore.getState()._sseRetryCount).toBe(0);
    expect(useGameStore.getState().game?.turn_version).toBe(2);
  });

  it("increments _sseRetryCount and schedules reconnect on SSE error", () => {
    let onErrorCallback: ((err: Event) => void) | null = null;
    (api.openGameEventSource as jest.Mock).mockImplementation(
      (_id: string, _onGame: unknown, onError: (err: Event) => void) => {
        onErrorCallback = onError;
        return jest.fn();
      },
    );
    useGameStore.setState({ game: makeGame(), _sseRetryCount: 0 });
    act(() => {
      useGameStore.getState()._connectSSE("game-1");
    });
    // Trigger SSE error.
    act(() => {
      onErrorCallback!(new Event("error"));
    });
    expect(useGameStore.getState()._sseRetryCount).toBe(1);
    // Advance timer to trigger the reconnect.
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    // Should have called openGameEventSource again for the reconnect.
    expect(api.openGameEventSource).toHaveBeenCalledTimes(2);
  });

  it("falls back to polling after MAX_SSE_RETRIES consecutive errors", () => {
    let onErrorCallback: ((err: Event) => void) | null = null;
    (api.openGameEventSource as jest.Mock).mockImplementation(
      (_id: string, _onGame: unknown, onError: (err: Event) => void) => {
        onErrorCallback = onError;
        return jest.fn();
      },
    );
    const game = makeGame({ status: "ai_thinking" });
    useGameStore.setState({ game, _sseRetryCount: MAX_SSE_RETRIES });
    act(() => {
      useGameStore.getState()._connectSSE("game-1");
    });
    // Trigger SSE error when retry count is already at max.
    act(() => {
      onErrorCallback!(new Event("error"));
    });
    // Should show a fallback message.
    expect(useGameStore.getState().errorMessage).toMatch(/Polling for updates/);
    // Should have started polling.
    expect(useGameStore.getState()._pollIntervalId).not.toBeNull();
    // Clean up
    act(() => {
      useGameStore.getState()._stopPolling();
    });
  });

  it("does not reconnect if game has changed", () => {
    let onErrorCallback: ((err: Event) => void) | null = null;
    (api.openGameEventSource as jest.Mock).mockImplementation(
      (_id: string, _onGame: unknown, onError: (err: Event) => void) => {
        onErrorCallback = onError;
        return jest.fn();
      },
    );
    const game = makeGame({ id: "game-1" });
    useGameStore.setState({ game, _sseRetryCount: 0 });
    act(() => {
      useGameStore.getState()._connectSSE("game-1");
    });
    // Trigger SSE error.
    act(() => {
      onErrorCallback!(new Event("error"));
    });
    // Change the game to a different id before the retry fires.
    useGameStore.setState({ game: makeGame({ id: "game-2" }) });
    // Advance timer to trigger the reconnect.
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    // Should NOT have called openGameEventSource again because game id changed.
    expect(api.openGameEventSource).toHaveBeenCalledTimes(1);
  });
});

describe("selectHumanMoveEnabled", () => {
  it("returns true when status=human_turn and loadingState=idle", () => {
    const state = {
      ...useGameStore.getState(),
      game: makeGame({ status: "human_turn" }),
      loadingState: "idle" as const,
    };
    expect(selectHumanMoveEnabled(state)).toBe(true);
  });

  it("returns false when status=ai_thinking", () => {
    const state = {
      ...useGameStore.getState(),
      game: makeGame({ status: "ai_thinking" }),
      loadingState: "idle" as const,
    };
    expect(selectHumanMoveEnabled(state)).toBe(false);
  });

  it("returns false when loadingState=submitting", () => {
    const state = {
      ...useGameStore.getState(),
      game: makeGame({ status: "human_turn" }),
      loadingState: "submitting" as const,
    };
    expect(selectHumanMoveEnabled(state)).toBe(false);
  });

  it("returns false when game is null", () => {
    const state = {
      ...useGameStore.getState(),
      game: null,
      loadingState: "idle" as const,
    };
    expect(selectHumanMoveEnabled(state)).toBe(false);
  });
});
