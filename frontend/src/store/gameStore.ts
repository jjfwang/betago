/**
 * Global game state store powered by Zustand.
 *
 * The store is the single source of truth for the current game on the client.
 * It exposes:
 *  - The current `Game` object (or `null` before the first load).
 *  - Loading / error flags.
 *  - Actions that call the API and update state atomically.
 *
 * Components should read state via `useGameStore` and call actions directly;
 * they must never call the API client themselves.
 *
 * ## Real-time update strategy
 *
 * The store uses a two-tier strategy to keep the game state current while the
 * AI is thinking:
 *
 * 1. **SSE (primary)** – `openGameEventSource` opens a persistent connection
 *    that the backend pushes updates through.  This is the preferred path
 *    because it has the lowest latency and no unnecessary requests.
 *
 * 2. **Polling (fallback)** – If the SSE connection fails (network hiccup,
 *    proxy timeout, etc.) the store automatically falls back to polling
 *    `GET /api/games/:id` at a configurable interval.  Polling stops as soon
 *    as the game leaves the `ai_thinking` state or a new SSE connection is
 *    re-established.
 *
 * ## Stale turn version recovery
 *
 * When a `submitAction` call returns a 409 `stale_turn_version` error the
 * store automatically fetches the latest game state so the UI reflects the
 * true server state without requiring a manual refresh.
 */
import { create } from "zustand";
import {
  createOrResumeGame,
  fetchGame,
  openGameEventSource,
  submitAction,
  ApiClientError,
} from "@/lib/api";
import { generateActionId } from "@/lib/actionId";
import type { Game } from "@/types/game";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Interval (ms) between poll requests when SSE is unavailable. */
export const POLL_INTERVAL_MS = 2_000;

/** Maximum number of SSE reconnection attempts before falling back to polling. */
export const MAX_SSE_RETRIES = 5;

/** Base delay (ms) for SSE reconnection exponential backoff. */
export const SSE_RETRY_BASE_MS = 1_000;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Possible loading states for async operations. */
export type LoadingState = "idle" | "loading" | "submitting" | "error";

export interface GameState {
  /** The current game, or null if not yet loaded. */
  game: Game | null;

  /** Loading state for the most recent async operation. */
  loadingState: LoadingState;

  /** Human-readable error message, or null if no error. */
  errorMessage: string | null;

  /** Cleanup function for the active SSE connection. */
  _closeEventSource: (() => void) | null;

  /** Handle for the active polling interval, or null when not polling. */
  _pollIntervalId: ReturnType<typeof setInterval> | null;

  /** Number of consecutive SSE reconnection attempts. */
  _sseRetryCount: number;

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Start or resume the session's active game.
   * Connects the SSE stream for real-time updates.
   */
  startGame(opts?: { forceNew?: boolean; aiLevel?: "entry" | "medium" | "hard" }): Promise<void>;

  /**
   * Place a stone at (x, y).
   */
  placeStone(x: number, y: number): Promise<void>;

  /**
   * Pass the current turn.
   */
  pass(): Promise<void>;

  /**
   * Resign the current game.
   */
  resign(): Promise<void>;

  /**
   * Apply a game update received from the SSE stream or a direct API call.
   * This is exposed so the SSE handler can push updates into the store.
   */
  applyGameUpdate(game: Game): void;

  /** Clear any displayed error message. */
  clearError(): void;

  // ── Internal helpers (exposed for testing) ────────────────────────────────

  /**
   * Start the polling fallback for the given game id.
   * Stops any existing poll loop first.
   *
   * @internal
   */
  _startPolling(gameId: string): void;

  /**
   * Stop the polling fallback loop.
   *
   * @internal
   */
  _stopPolling(): void;

  /**
   * Connect (or reconnect) the SSE stream for the given game id.
   * Implements exponential backoff up to MAX_SSE_RETRIES.
   *
   * @internal
   */
  _connectSSE(gameId: string): void;

  /**
   * Fetch the latest game state from the server and apply it to the store.
   * Used for stale-turn-version recovery.
   *
   * @internal
   */
  _refreshGame(gameId: string): Promise<void>;
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useGameStore = create<GameState>((set, get) => ({
  game: null,
  loadingState: "idle",
  errorMessage: null,
  _closeEventSource: null,
  _pollIntervalId: null,
  _sseRetryCount: 0,

  // ── startGame ─────────────────────────────────────────────────────────────
  async startGame({ forceNew = false, aiLevel } = {}) {
    // Tear down any existing real-time connections before starting a new game.
    get()._closeEventSource?.();
    get()._stopPolling();
    set({ loadingState: "loading", errorMessage: null, _sseRetryCount: 0 });

    try {
      const game = await createOrResumeGame({
        force_new: forceNew,
        ai_level: aiLevel,
      });

      set({ game, loadingState: "idle" });

      // Connect the SSE stream for real-time updates.
      get()._connectSSE(game.id);
    } catch (err) {
      set({
        loadingState: "error",
        errorMessage: err instanceof Error ? err.message : "Failed to load game.",
      });
    }
  },

  // ── placeStone ────────────────────────────────────────────────────────────
  async placeStone(x, y) {
    const { game } = get();
    if (!game || game.status !== "human_turn") return;

    set({ loadingState: "submitting", errorMessage: null });

    try {
      const { game: updated } = await submitAction(game.id, {
        action: "place",
        action_id: generateActionId(),
        expected_turn_version: game.turn_version,
        x,
        y,
      });
      set({ game: updated, loadingState: "idle" });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "stale_turn_version") {
        // The server has already advanced; refresh to get the latest state.
        await get()._refreshGame(game.id);
      } else {
        set({
          loadingState: "error",
          errorMessage: err instanceof Error ? err.message : "Failed to place stone.",
        });
      }
    }
  },

  // ── pass ──────────────────────────────────────────────────────────────────
  async pass() {
    const { game } = get();
    if (!game || game.status !== "human_turn") return;

    set({ loadingState: "submitting", errorMessage: null });

    try {
      const { game: updated } = await submitAction(game.id, {
        action: "pass",
        action_id: generateActionId(),
        expected_turn_version: game.turn_version,
      });
      set({ game: updated, loadingState: "idle" });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "stale_turn_version") {
        await get()._refreshGame(game.id);
      } else {
        set({
          loadingState: "error",
          errorMessage: err instanceof Error ? err.message : "Failed to pass.",
        });
      }
    }
  },

  // ── resign ────────────────────────────────────────────────────────────────
  async resign() {
    const { game } = get();
    if (!game || game.status !== "human_turn") return;

    set({ loadingState: "submitting", errorMessage: null });

    try {
      const { game: updated } = await submitAction(game.id, {
        action: "resign",
        action_id: generateActionId(),
        expected_turn_version: game.turn_version,
      });
      set({ game: updated, loadingState: "idle" });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "stale_turn_version") {
        await get()._refreshGame(game.id);
      } else {
        set({
          loadingState: "error",
          errorMessage: err instanceof Error ? err.message : "Failed to resign.",
        });
      }
    }
  },

  // ── applyGameUpdate ───────────────────────────────────────────────────────
  applyGameUpdate(game) {
    // Stop polling once the game is no longer in ai_thinking state.
    if (game.status !== "ai_thinking") {
      get()._stopPolling();
    }
    set({ game, loadingState: "idle" });
  },

  // ── clearError ────────────────────────────────────────────────────────────
  clearError() {
    set({ errorMessage: null });
  },

  // ── _connectSSE ───────────────────────────────────────────────────────────
  _connectSSE(gameId: string) {
    // Close any existing SSE connection first.
    get()._closeEventSource?.();

    const close = openGameEventSource(
      gameId,
      (updated) => {
        // Successful event resets the retry counter.
        set({ _sseRetryCount: 0 });
        get().applyGameUpdate(updated);
      },
      () => {
        // SSE connection error – attempt reconnection with exponential backoff.
        const retryCount = get()._sseRetryCount;

        if (retryCount >= MAX_SSE_RETRIES) {
          // Give up on SSE and fall back to polling.
          set({
            errorMessage: "Real-time updates unavailable. Polling for updates…",
          });
          get()._startPolling(gameId);
          return;
        }

        const delay = SSE_RETRY_BASE_MS * Math.pow(2, retryCount);
        set({ _sseRetryCount: retryCount + 1 });

        setTimeout(() => {
          // Only reconnect if the game is still the same one.
          if (get().game?.id === gameId) {
            get()._connectSSE(gameId);
          }
        }, delay);
      },
    );

    set({ _closeEventSource: close });
  },

  // ── _startPolling ─────────────────────────────────────────────────────────
  _startPolling(gameId: string) {
    // Clear any existing poll loop.
    get()._stopPolling();

    const intervalId = setInterval(async () => {
      const { game } = get();
      // Stop polling if the game has changed or is no longer in ai_thinking.
      if (!game || game.id !== gameId || game.status !== "ai_thinking") {
        get()._stopPolling();
        return;
      }

      try {
        const updated = await fetchGame(gameId);
        get().applyGameUpdate(updated);
      } catch {
        // Non-fatal – next tick will retry.
      }
    }, POLL_INTERVAL_MS);

    set({ _pollIntervalId: intervalId });
  },

  // ── _stopPolling ──────────────────────────────────────────────────────────
  _stopPolling() {
    const { _pollIntervalId } = get();
    if (_pollIntervalId !== null) {
      clearInterval(_pollIntervalId);
      set({ _pollIntervalId: null });
    }
  },

  // ── _refreshGame ──────────────────────────────────────────────────────────
  async _refreshGame(gameId: string) {
    try {
      const updated = await fetchGame(gameId);
      set({ game: updated, loadingState: "idle" });
    } catch {
      set({ loadingState: "error", errorMessage: "Failed to refresh game state." });
    }
  },
}));

// ── Selectors ─────────────────────────────────────────────────────────────────

/**
 * Convenience selector: returns true when a human action can be submitted.
 */
export function selectHumanMoveEnabled(state: GameState): boolean {
  return (
    state.game?.status === "human_turn" &&
    state.loadingState !== "submitting" &&
    state.loadingState !== "loading"
  );
}
