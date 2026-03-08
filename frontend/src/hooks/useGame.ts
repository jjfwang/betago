/**
 * `useGame` – convenience hook for components that need the full game state
 * and all available actions.
 *
 * This is a thin re-export of `useGameStore` that co-locates the selector
 * logic so individual components stay free of store internals.
 *
 * Exported selectors:
 *  - `selectHumanMoveEnabled` – true when the human can submit a move.
 *  - `selectAiStatus`         – the current AI processing status from the game.
 */

"use client";

import { useGameStore, selectHumanMoveEnabled } from "@/store/gameStore";
import type { AiStatus } from "@/types/game";
import type { GameState } from "@/store/gameStore";

/**
 * Selector that extracts the AI status from the game state.
 *
 * Returns `null` when no game is loaded so callers can treat it as "nothing
 * to display" without additional null-checks.
 */
export function selectAiStatus(state: GameState): AiStatus {
  return state.game?.ai_status ?? null;
}

export function useGame() {
  const game = useGameStore((s) => s.game);
  const loadingState = useGameStore((s) => s.loadingState);
  const errorMessage = useGameStore((s) => s.errorMessage);
  const humanMoveEnabled = useGameStore(selectHumanMoveEnabled);
  const aiStatus = useGameStore(selectAiStatus);

  const startGame = useGameStore((s) => s.startGame);
  const placeStone = useGameStore((s) => s.placeStone);
  const pass = useGameStore((s) => s.pass);
  const resign = useGameStore((s) => s.resign);
  const clearError = useGameStore((s) => s.clearError);

  return {
    game,
    loadingState,
    errorMessage,
    humanMoveEnabled,
    /** Current AI processing status; null when no game is loaded. */
    aiStatus,
    startGame,
    placeStone,
    pass,
    resign,
    clearError,
  };
}
