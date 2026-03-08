/**
 * `useGame` – convenience hook for components that need the full game state
 * and all available actions.
 *
 * This is a thin re-export of `useGameStore` that co-locates the selector
 * logic so individual components stay free of store internals.
 */

"use client";

import { useGameStore, selectHumanMoveEnabled } from "@/store/gameStore";

export function useGame() {
  const game = useGameStore((s) => s.game);
  const loadingState = useGameStore((s) => s.loadingState);
  const errorMessage = useGameStore((s) => s.errorMessage);
  const humanMoveEnabled = useGameStore(selectHumanMoveEnabled);

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
    startGame,
    placeStone,
    pass,
    resign,
    clearError,
  };
}
