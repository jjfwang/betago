/**
 * Unit tests for the Zustand game store.
 *
 * The API client module is mocked so no real network calls are made.
 */

import { act } from "react";
import { useGameStore, selectHumanMoveEnabled } from "@/store/gameStore";
import type { Game } from "@/types/game";

// ── Mock the API client ───────────────────────────────────────────────────────

jest.mock("@/lib/api", () => ({
  createOrResumeGame: jest.fn(),
  fetchGame: jest.fn(),
  submitAction: jest.fn(),
  openGameEventSource: jest.fn(() => jest.fn()), // returns a no-op cleanup
}));

import * as api from "@/lib/api";

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
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
  jest.clearAllMocks();
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
