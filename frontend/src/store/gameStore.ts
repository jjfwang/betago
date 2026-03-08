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
 */

import { create } from "zustand";
import {
  createOrResumeGame,
  fetchGame,
  openGameEventSource,
  submitAction,
} from "@/lib/api";
import { generateActionId } from "@/lib/actionId";
import type { Game } from "@/types/game";

/** Possible loading states for async operations. */
export type LoadingState = "idle" | "loading" | "submitting" | "error";

interface GameState {
  /** The current game, or null if not yet loaded. */
  game: Game | null;

  /** Loading state for the most recent async operation. */
  loadingState: LoadingState;

  /** Human-readable error message, or null if no error. */
  errorMessage: string | null;

  /** Cleanup function for the active SSE connection. */
  _closeEventSource: (() => void) | null;

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
}

export const useGameStore = create<GameState>((set, get) => ({
  game: null,
  loadingState: "idle",
  errorMessage: null,
  _closeEventSource: null,

  // ── startGame ─────────────────────────────────────────────────────────────
  async startGame({ forceNew = false, aiLevel } = {}) {
    // Tear down any existing SSE connection before starting a new game.
    get()._closeEventSource?.();

    set({ loadingState: "loading", errorMessage: null });

    try {
      const game = await createOrResumeGame({
        force_new: forceNew,
        ai_level: aiLevel,
      });

      // Open the SSE stream for real-time updates.
      const close = openGameEventSource(
        game.id,
        (updated) => get().applyGameUpdate(updated),
        () => {
          // SSE error: fall back to polling or show a soft warning.
          // For now we just surface a non-blocking message.
          set({ errorMessage: "Real-time updates interrupted. Retrying…" });
        },
      );

      set({ game, loadingState: "idle", _closeEventSource: close });
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
      set({
        loadingState: "error",
        errorMessage: err instanceof Error ? err.message : "Failed to place stone.",
      });
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
      set({
        loadingState: "error",
        errorMessage: err instanceof Error ? err.message : "Failed to pass.",
      });
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
      set({
        loadingState: "error",
        errorMessage: err instanceof Error ? err.message : "Failed to resign.",
      });
    }
  },

  // ── applyGameUpdate ───────────────────────────────────────────────────────
  applyGameUpdate(game) {
    set({ game, loadingState: "idle" });
  },

  // ── clearError ────────────────────────────────────────────────────────────
  clearError() {
    set({ errorMessage: null });
  },
}));

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
