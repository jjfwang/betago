/**
 * AppHeader – top-level page header with the BetaGo wordmark,
 * AI level selector, and New Game button.
 */

"use client";

import React, { useState } from "react";
import { AiLevelSelect } from "@/components/ui/AiLevelSelect";
import type { Game } from "@/types/game";

type AiLevel = "entry" | "medium" | "hard";

interface AppHeaderProps {
  game: Game | null;
  onNewGame: (aiLevel: AiLevel) => void;
  isLoading: boolean;
}

export function AppHeader({ game, onNewGame, isLoading }: AppHeaderProps) {
  const [selectedLevel, setSelectedLevel] = useState<AiLevel>(
    game?.ai_level ?? "medium",
  );

  const handleNewGame = () => {
    onNewGame(selectedLevel);
  };

  return (
    <header className="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-bold tracking-wide">BetaGo</h1>
        <p className="text-sm text-ink-muted mt-0.5">Human vs AI · 9×9</p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <AiLevelSelect
          value={selectedLevel}
          currentGame={game}
          onChange={setSelectedLevel}
        />
        <button
          className="btn ghost"
          onClick={handleNewGame}
          disabled={isLoading}
          aria-label="Start a new game"
        >
          New Game
        </button>
      </div>
    </header>
  );
}
