/**
 * TurnIndicator – compact status badge shown above the board.
 *
 * Displays "Your turn", "AI thinking…", or "Game over – <winner>" depending
 * on the current game status.
 */

"use client";

import React from "react";
import type { Game } from "@/types/game";

interface TurnIndicatorProps {
  game: Game | null;
}

export function TurnIndicator({ game }: TurnIndicatorProps) {
  if (!game) {
    return (
      <p className="text-sm text-ink-muted" aria-live="polite">
        Loading game…
      </p>
    );
  }

  let label: string;
  let colorClass: string;

  switch (game.status) {
    case "human_turn":
      label = "Your turn";
      colorClass = "text-ink-DEFAULT";
      break;
    case "ai_thinking":
      label = "AI thinking…";
      colorClass = "text-ink-muted";
      break;
    case "finished":
      label = finishedLabel(game);
      colorClass = "text-ink-DEFAULT font-semibold";
      break;
    default:
      label = game.status;
      colorClass = "text-ink-muted";
  }

  return (
    <p className={`text-sm ${colorClass}`} aria-live="polite">
      {label}
    </p>
  );
}

function finishedLabel(game: Game): string {
  if (!game.winner) return "Game over";
  if (game.winner === "draw") return "Game over – Draw";
  return game.winner === "B" ? "Game over – You win!" : "Game over – AI wins";
}
