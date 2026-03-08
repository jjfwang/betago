/**
 * GameView – top-level game layout component.
 *
 * Composes the GoBoard, GamePanel, TurnIndicator, AIStatus, AppHeader,
 * ErrorBanner, and AiErrorBanner into the two-column layout described in the
 * product plan.
 *
 * This component is intentionally kept thin: it wires the store to the
 * presentational sub-components and handles the "last move" derivation.
 *
 * ## AIStatus integration
 *
 * The raw `ai_status` field from the game object is surfaced via the
 * `selectAiStatus` selector in `useGame`.  Before passing it to `<AIStatus />`
 * we run it through `useAiStatusTransition`, which:
 *
 *  - Normalises `"idle"` → `null` (no badge shown).
 *  - Auto-clears `"done"` after 2 s so the badge disappears once the user
 *    has registered the AI move.
 *  - Auto-clears `"error"` after 4 s, giving the user time to read the
 *    fallback notice before it fades.
 *  - Cancels any pending timer immediately when the status changes to a
 *    non-transient value (e.g. `"thinking"` for the next AI turn).
 *
 * ## AiErrorBanner integration
 *
 * In addition to the compact inline `AIStatus` badge, a more prominent
 * `AiErrorBanner` is shown below the header whenever `ai_status === "error"`.
 * This banner:
 *
 *  - Explains in plain language that the AI had trouble and a fallback was
 *    applied (the game is still playable).
 *  - Auto-dismisses after 8 s via `useAiError`.
 *  - Can be dismissed immediately by the user.
 */

"use client";

import React, { useCallback, useEffect, useMemo } from "react";
import { GoBoard } from "@/components/board/GoBoard";
import { GamePanel } from "@/components/game/GamePanel";
import { TurnIndicator } from "@/components/game/TurnIndicator";
import { AIStatus } from "@/components/game/AIStatus";
import { AppHeader } from "@/components/layout/AppHeader";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { AiErrorBanner } from "@/components/ui/AiErrorBanner";
import { useGame } from "@/hooks/useGame";
import { useAiStatusTransition } from "@/hooks/useAiStatusTransition";
import { useAiError } from "@/hooks/useAiError";

export function GameView() {
  const {
    game,
    loadingState,
    errorMessage,
    humanMoveEnabled,
    aiStatus,
    startGame,
    placeStone,
    pass,
    resign,
    clearError,
  } = useGame();

  /**
   * Display-ready AI status: transient states (`"done"`, `"error"`) are
   * automatically cleared after a short delay so the badge doesn't linger.
   */
  const displayAiStatus = useAiStatusTransition(aiStatus);

  /**
   * AI error banner state: shows a prominent, dismissible banner when the AI
   * encounters an error and a fallback move is applied.  Auto-dismisses after
   * 8 s so it does not permanently clutter the layout.
   */
  const { bannerVisible: aiErrorBannerVisible, dismissBanner: dismissAiError } =
    useAiError(aiStatus);

  // Start or resume the game on mount.
  useEffect(() => {
    startGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derive the last move coordinate for the board highlight.
  const lastMove = useMemo(() => {
    if (!game) return null;
    const lastPlaced = [...game.moves]
      .reverse()
      .find((m) => m.action === "place");
    if (!lastPlaced || !lastPlaced.coordinate) return null;
    // The coordinate is stored as a label (e.g. "D4"); we need (x, y).
    // The backend also includes it in the move list, but we can derive it
    // from the board directly by scanning for the most recently placed stone.
    // For simplicity, we store the raw coordinate and let GoBoard handle it.
    // We return null here and rely on the board rendering the last stone.
    return null;
  }, [game]);

  const handleNewGame = useCallback(
    (aiLevel: "entry" | "medium" | "hard") => {
      startGame({ forceNew: true, aiLevel });
    },
    [startGame],
  );

  const isLoading = loadingState === "loading";
  const isSubmitting = loadingState === "submitting";

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-muted via-[#f0e4d1] to-[#f1d9bc]">
      <main className="w-full max-w-[1380px] mx-auto px-4 py-4 min-h-screen flex flex-col gap-4">
        {/* Header */}
        <AppHeader
          game={game}
          onNewGame={handleNewGame}
          isLoading={isLoading}
        />

        {/* Generic error banner (network / API errors) */}
        <ErrorBanner message={errorMessage} onDismiss={clearError} />

        {/* AI error banner – shown when the AI fails and a fallback is applied */}
        <AiErrorBanner
          visible={aiErrorBannerVisible}
          onDismiss={dismissAiError}
        />

        {/* Two-column layout: board + panel */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 items-start">
          {/* Board card */}
          <section className="bg-surface-card border border-ink-faint rounded-card shadow-card p-4 flex flex-col gap-3">
            {/* Status row: turn indicator on the left, AI status on the right */}
            <div className="flex items-center justify-between gap-2 min-h-[1.5rem]">
              <TurnIndicator game={game} />
              {/*
               * `displayAiStatus` is the auto-cleared version of `aiStatus`:
               *  - "done"  fades after 2 s
               *  - "error" fades after 4 s
               *  - "thinking" / "retrying" persist until the backend updates
               */}
              <AIStatus status={displayAiStatus} />
            </div>

            {/* Board */}
            <div className="aspect-square w-full">
              {game ? (
                <GoBoard
                  board={game.board}
                  boardSize={game.board_size}
                  legalMoves={humanMoveEnabled ? game.legal_moves : []}
                  interactive={humanMoveEnabled}
                  onIntersectionClick={placeStone}
                  lastMove={lastMove}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-ink-muted text-sm">
                  {isLoading ? "Loading board\u2026" : "No active game"}
                </div>
              )}
            </div>

            {/* Pass / Resign controls (also shown in panel, mirrored here for mobile) */}
            <div className="flex gap-2 lg:hidden">
              <button
                className="btn"
                disabled={!humanMoveEnabled || isSubmitting}
                onClick={pass}
              >
                Pass
              </button>
              <button
                className="btn danger"
                disabled={!humanMoveEnabled || isSubmitting}
                onClick={resign}
              >
                Resign
              </button>
            </div>
          </section>

          {/* Panel card */}
          <section className="bg-surface-card border border-ink-faint rounded-card shadow-card p-4 hidden lg:block h-full">
            <GamePanel
              game={game}
              humanMoveEnabled={humanMoveEnabled}
              isSubmitting={isSubmitting}
              onPass={pass}
              onResign={resign}
              onNewGame={() => handleNewGame(game?.ai_level ?? "medium")}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
