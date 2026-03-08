/**
 * GamePanel – sidebar component showing game metadata, move history,
 * and action controls (Pass / Resign / New Game).
 */

"use client";

import React from "react";
import type { Game } from "@/types/game";

interface GamePanelProps {
  game: Game | null;
  humanMoveEnabled: boolean;
  isSubmitting: boolean;
  onPass: () => void;
  onResign: () => void;
  onNewGame: () => void;
}

export function GamePanel({
  game,
  humanMoveEnabled,
  isSubmitting,
  onPass,
  onResign,
  onNewGame,
}: GamePanelProps) {
  return (
    <aside className="flex flex-col gap-4 h-full overflow-hidden">
      {/* ── Game metadata ─────────────────────────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold mb-2">Game Info</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <MetaRow label="Status" value={statusLabel(game)} />
          <MetaRow label="Turn" value={game?.turn ?? "–"} />
          <MetaRow label="Version" value={game?.turn_version?.toString() ?? "–"} />
          <MetaRow label="AI Status" value={game?.ai_status ?? "–"} />
          <MetaRow label="Level" value={game?.ai_level ?? "–"} />
          <MetaRow
            label="Captures"
            value={
              game
                ? `B: ${game.captures.B}  W: ${game.captures.W}`
                : "–"
            }
          />
          {game?.status === "finished" && (
            <MetaRow label="Winner" value={winnerLabel(game)} />
          )}
        </dl>
      </section>

      {/* ── AI rationale ──────────────────────────────────────────────── */}
      {game?.last_ai_rationale && (
        <section>
          <h3 className="text-sm font-semibold mb-1">AI Rationale</h3>
          <p className="text-xs text-ink-muted leading-relaxed bg-surface-muted rounded-lg p-2">
            {game.last_ai_rationale}
          </p>
        </section>
      )}

      {/* ── Controls ──────────────────────────────────────────────────── */}
      <section className="flex flex-wrap gap-2">
        <button
          className="btn"
          disabled={!humanMoveEnabled || isSubmitting}
          onClick={onPass}
          aria-label="Pass turn"
        >
          Pass
        </button>
        <button
          className="btn danger"
          disabled={!humanMoveEnabled || isSubmitting}
          onClick={onResign}
          aria-label="Resign game"
        >
          Resign
        </button>
        <button
          className="btn ghost"
          disabled={isSubmitting}
          onClick={onNewGame}
          aria-label="Start new game"
        >
          New Game
        </button>
      </section>

      {/* ── Move history ──────────────────────────────────────────────── */}
      <section className="flex-1 overflow-hidden flex flex-col min-h-0">
        <h3 className="text-sm font-semibold mb-1">
          Move History
          {game?.moves_truncated && (
            <span className="ml-1 text-xs font-normal text-ink-muted">
              (truncated)
            </span>
          )}
        </h3>
        <ol className="flex-1 overflow-y-auto font-mono text-xs space-y-0.5 pr-1">
          {game?.moves.map((move) => (
            <li key={move.move_index} className="flex gap-1.5">
              <span className="text-ink-muted w-5 text-right shrink-0">
                {move.move_index + 1}.
              </span>
              <span
                className={
                  move.player === "human"
                    ? "text-ink-DEFAULT"
                    : "text-ink-muted"
                }
              >
                {move.player === "human" ? "You" : "AI"}
              </span>
              <span className="text-ink-muted">
                {move.action === "place"
                  ? move.coordinate ?? "?"
                  : move.action.charAt(0).toUpperCase() + move.action.slice(1)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function statusLabel(game: Game | null): string {
  if (!game) return "Loading…";
  switch (game.status) {
    case "human_turn":
      return "Your turn";
    case "ai_thinking":
      return "AI thinking…";
    case "finished":
      return "Game over";
    default:
      return game.status;
  }
}

function winnerLabel(game: Game): string {
  if (!game.winner) return "–";
  if (game.winner === "draw") return "Draw";
  return game.winner === "B" ? "Black (You)" : "White (AI)";
}
