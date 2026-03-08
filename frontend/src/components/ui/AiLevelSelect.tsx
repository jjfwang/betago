/**
 * AiLevelSelect – dropdown for choosing the AI difficulty level.
 *
 * The level only takes effect when a new game is started.  If the user
 * changes the level mid-game, a soft notice is shown.
 */

"use client";

import React from "react";
import type { Game } from "@/types/game";

type AiLevel = "entry" | "medium" | "hard";

interface AiLevelSelectProps {
  value: AiLevel;
  currentGame: Game | null;
  onChange: (level: AiLevel) => void;
}

const LEVEL_LABELS: Record<AiLevel, string> = {
  entry: "Entry",
  medium: "Medium",
  hard: "Hard",
};

export function AiLevelSelect({
  value,
  currentGame,
  onChange,
}: AiLevelSelectProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as AiLevel;
    onChange(next);
  };

  const showNotice =
    currentGame &&
    currentGame.status !== "finished" &&
    currentGame.ai_level !== value;

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="ai-level-select"
        className="text-sm text-ink-muted"
      >
        Level
      </label>
      <select
        id="ai-level-select"
        value={value}
        onChange={handleChange}
        className="border border-ink-faint rounded-pill bg-surface text-ink-DEFAULT text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ink-faint"
      >
        {(Object.keys(LEVEL_LABELS) as AiLevel[]).map((level) => (
          <option key={level} value={level}>
            {LEVEL_LABELS[level]}
          </option>
        ))}
      </select>
      {showNotice && (
        <span className="text-xs text-ink-muted">
          Applies on new game
        </span>
      )}
    </div>
  );
}
