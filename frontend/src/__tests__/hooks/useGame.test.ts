/**
 * Unit tests for the useGame hook.
 *
 * These tests verify that the hook correctly surfaces store state and
 * actions.  The underlying store is tested separately in gameStore.test.ts.
 *
 * New tests added:
 *  - `aiStatus` selector returns the correct AI status from the game object.
 *  - `aiStatus` returns null when no game is loaded.
 *  - `selectAiStatus` correctly maps all AiStatus values.
 */

import { renderHook, act } from "@testing-library/react";
import { useGame, selectAiStatus } from "@/hooks/useGame";
import { useGameStore } from "@/store/gameStore";
import type { Game, AiStatus } from "@/types/game";

// Mock the API so the store actions don't make real HTTP calls.
jest.mock("@/lib/api", () => ({
  createOrResumeGame: jest.fn(),
  fetchGame: jest.fn(),
  submitAction: jest.fn(),
  openGameEventSource: jest.fn(() => jest.fn()),
}));

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "g1",
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
    board: [],
    legal_moves: [],
    moves: [],
    move_count: 0,
    moves_truncated: false,
    ...overrides,
  };
}

beforeEach(() => {
  useGameStore.setState({
    game: null,
    loadingState: "idle",
    errorMessage: null,
    _closeEventSource: null,
  });
  jest.clearAllMocks();
});

describe("useGame", () => {
  it("returns null game initially", () => {
    const { result } = renderHook(() => useGame());
    expect(result.current.game).toBeNull();
  });

  it("returns the game when the store has one", () => {
    const game = makeGame();
    useGameStore.setState({ game });
    const { result } = renderHook(() => useGame());
    expect(result.current.game).toEqual(game);
  });

  it("returns humanMoveEnabled=true when status=human_turn and idle", () => {
    useGameStore.setState({
      game: makeGame({ status: "human_turn" }),
      loadingState: "idle",
    });
    const { result } = renderHook(() => useGame());
    expect(result.current.humanMoveEnabled).toBe(true);
  });

  it("returns humanMoveEnabled=false when status=ai_thinking", () => {
    useGameStore.setState({
      game: makeGame({ status: "ai_thinking" }),
      loadingState: "idle",
    });
    const { result } = renderHook(() => useGame());
    expect(result.current.humanMoveEnabled).toBe(false);
  });

  it("returns humanMoveEnabled=false when loadingState=submitting", () => {
    useGameStore.setState({
      game: makeGame({ status: "human_turn" }),
      loadingState: "submitting",
    });
    const { result } = renderHook(() => useGame());
    expect(result.current.humanMoveEnabled).toBe(false);
  });

  it("exposes startGame, placeStone, pass, resign, clearError actions", () => {
    const { result } = renderHook(() => useGame());
    expect(typeof result.current.startGame).toBe("function");
    expect(typeof result.current.placeStone).toBe("function");
    expect(typeof result.current.pass).toBe("function");
    expect(typeof result.current.resign).toBe("function");
    expect(typeof result.current.clearError).toBe("function");
  });

  it("returns the errorMessage from the store", () => {
    useGameStore.setState({ errorMessage: "test error" });
    const { result } = renderHook(() => useGame());
    expect(result.current.errorMessage).toBe("test error");
  });

  // ── aiStatus tests ──────────────────────────────────────────────────────

  it("returns aiStatus=null when no game is loaded", () => {
    const { result } = renderHook(() => useGame());
    expect(result.current.aiStatus).toBeNull();
  });

  it("returns aiStatus=idle when game ai_status is idle", () => {
    useGameStore.setState({ game: makeGame({ ai_status: "idle" }) });
    const { result } = renderHook(() => useGame());
    expect(result.current.aiStatus).toBe("idle");
  });

  it("returns aiStatus=thinking when game ai_status is thinking", () => {
    useGameStore.setState({ game: makeGame({ ai_status: "thinking" }) });
    const { result } = renderHook(() => useGame());
    expect(result.current.aiStatus).toBe("thinking");
  });

  it("returns aiStatus=retrying when game ai_status is retrying", () => {
    useGameStore.setState({ game: makeGame({ ai_status: "retrying" }) });
    const { result } = renderHook(() => useGame());
    expect(result.current.aiStatus).toBe("retrying");
  });

  it("returns aiStatus=done when game ai_status is done", () => {
    useGameStore.setState({ game: makeGame({ ai_status: "done" }) });
    const { result } = renderHook(() => useGame());
    expect(result.current.aiStatus).toBe("done");
  });

  it("returns aiStatus=error when game ai_status is error", () => {
    useGameStore.setState({ game: makeGame({ ai_status: "error" }) });
    const { result } = renderHook(() => useGame());
    expect(result.current.aiStatus).toBe("error");
  });

  it("aiStatus updates reactively when game state changes", () => {
    useGameStore.setState({ game: makeGame({ ai_status: "thinking" }) });
    const { result, rerender } = renderHook(() => useGame());
    expect(result.current.aiStatus).toBe("thinking");

    // Simulate backend pushing a state update (e.g. via SSE).
    act(() => {
      useGameStore.setState({ game: makeGame({ ai_status: "done" }) });
    });
    expect(result.current.aiStatus).toBe("done");
  });
});

// ── selectAiStatus tests ──────────────────────────────────────────────────────

describe("selectAiStatus", () => {
  const baseState = useGameStore.getState();

  it("returns null when game is null", () => {
    expect(selectAiStatus({ ...baseState, game: null })).toBeNull();
  });

  const statuses: AiStatus[] = ["idle", "thinking", "retrying", "done", "error", null];

  statuses.forEach((aiStatus) => {
    it(`returns "${aiStatus}" when game.ai_status is "${aiStatus}"`, () => {
      const game = makeGame({ ai_status: aiStatus });
      expect(selectAiStatus({ ...baseState, game })).toBe(aiStatus);
    });
  });
});
