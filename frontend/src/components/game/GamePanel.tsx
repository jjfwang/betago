/**
 * GamePanel – sidebar component showing game metadata, move history,
 * and action controls (Pass / Resign / New Game).
 *
 * Layout (top-to-bottom):
 *  1. Game Info      – board size, komi, turn version, AI level, capture counts.
 *  2. Result         – winner + scoring summary, shown only when game is finished.
 *  3. AI Rationale   – latest AI move explanation (optional).
 *  4. Controls       – Pass, Resign, New Game buttons.
 *  5. Move History   – scrollable ordered list of all moves.
 */
"use client";
import React from "react";
import type { Game, Move } from "@/types/game";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GamePanelProps {
  game: Game | null;
  humanMoveEnabled: boolean;
  isSubmitting: boolean;
  onPass: () => void;
  onResign: () => void;
  onNewGame: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GamePanel({
  game,
  humanMoveEnabled,
  isSubmitting,
  onPass,
  onResign,
  onNewGame,
}: GamePanelProps) {
  const isFinished = game?.status === "finished";

  return (
    <aside
      className="flex flex-col gap-4 h-full overflow-hidden"
      aria-label="Game panel"
    >
      {/* ── 1. Game metadata ─────────────────────────────────────────── */}
      <section aria-labelledby="game-info-heading">
        <h2 id="game-info-heading" className="text-base font-semibold mb-2">
          Game Info
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <MetaRow label="Status" value={statusLabel(game)} />
          <MetaRow label="Turn" value={game?.turn ?? "–"} />
          <MetaRow
            label="Version"
            value={game?.turn_version?.toString() ?? "–"}
          />
          <MetaRow label="AI Status" value={game?.ai_status ?? "–"} />
          <MetaRow label="Level" value={game?.ai_level ?? "–"} />
          <MetaRow
            label="Komi"
            value={game ? game.komi.toString() : "–"}
          />
          <MetaRow
            label="Captures"
            value={
              game
                ? `B: ${game.captures.B}  W: ${game.captures.W}`
                : "–"
            }
          />
        </dl>
      </section>

      {/* ── 2. Result summary (finished games only) ──────────────────── */}
      {isFinished && (
        <section
          className="rounded-lg border border-ink-faint bg-surface-muted px-3 py-2"
          aria-labelledby="result-heading"
          aria-live="polite"
        >
          <h3
            id="result-heading"
            className="text-sm font-semibold mb-1"
          >
            Result
          </h3>
          <p className="text-sm font-medium">{winnerLabel(game!)}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs mt-1 text-ink-muted">
            <MetaRow
              label="Black captures"
              value={game!.captures.B.toString()}
            />
            <MetaRow
              label="White captures"
              value={game!.captures.W.toString()}
            />
            <MetaRow label="Komi" value={game!.komi.toString()} />
            <MetaRow
              label="Total moves"
              value={game!.move_count.toString()}
            />
          </dl>
        </section>
      )}

      {/* ── 3. AI rationale ──────────────────────────────────────────── */}
      {game?.last_ai_rationale && (
        <section aria-labelledby="ai-rationale-heading">
          <h3
            id="ai-rationale-heading"
            className="text-sm font-semibold mb-1"
          >
            AI Rationale
          </h3>
          <p className="text-xs text-ink-muted leading-relaxed bg-surface-muted rounded-lg p-2">
            {game.last_ai_rationale}
          </p>
        </section>
      )}

      {/* ── 4. Controls ──────────────────────────────────────────────── */}
      <section className="flex flex-wrap gap-2" aria-label="Game controls">
        <button
          className="btn"
          disabled={!humanMoveEnabled || isSubmitting}
          onClick={onPass}
          aria-label="Pass turn"
          aria-busy={isSubmitting}
        >
          {isSubmitting && <Spinner />}
          Pass
        </button>
        <button
          className="btn danger"
          disabled={!humanMoveEnabled || isSubmitting}
          onClick={onResign}
          aria-label="Resign game"
          aria-busy={isSubmitting}
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

      {/* ── 5. Move history ──────────────────────────────────────────── */}
      <section
        className="flex-1 overflow-hidden flex flex-col min-h-0"
        aria-labelledby="move-history-heading"
      >
        <h3 id="move-history-heading" className="text-sm font-semibold mb-1">
          Move History
          {game?.moves_truncated && (
            <span className="ml-1 text-xs font-normal text-ink-muted">
              (truncated)
            </span>
          )}
        </h3>
        {!game || game.moves.length === 0 ? (
          <p className="text-xs text-ink-muted italic">No moves yet.</p>
        ) : (
          <ol
            className="flex-1 overflow-y-auto font-mono text-xs space-y-0.5 pr-1"
            aria-label="Move history list"
          >
            {game.moves.map((move) => (
              <MoveRow key={move.move_index} move={move} />
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * MetaRow renders a single definition-list row (label + value pair).
 */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

/**
 * MoveRow renders a single entry in the move history list.
 *
 * Visual differentiation by action type:
 * - `place`  – coordinate in default ink (human) or muted ink (AI).
 * - `pass`   – italic "Pass" in muted ink.
 * - `resign` – "Resign" in danger colour for clear visual emphasis.
 */
function MoveRow({ move }: { move: Move }) {
  const playerLabel = move.player === "human" ? "You" : "AI";
  const showRationale = move.player === "ai" && Boolean(move.rationale);

  let actionLabel: string;
  let actionClass: string;

  switch (move.action) {
    case "place":
      actionLabel = move.coordinate ?? "?";
      actionClass =
        move.player === "human" ? "text-ink-DEFAULT" : "text-ink-muted";
      break;
    case "pass":
      actionLabel = "Pass";
      actionClass = "text-ink-muted italic";
      break;
    case "resign":
      actionLabel = "Resign";
      actionClass = "text-danger";
      break;
    default:
      actionLabel = move.action;
      actionClass = "text-ink-muted";
  }

  return (
    <li className="py-0.5">
      <div className="flex gap-1.5 items-baseline">
        <span className="text-ink-muted w-5 text-right shrink-0">
          {move.move_index + 1}.
        </span>
        <span
          className={
            move.player === "human" ? "text-ink-DEFAULT" : "text-ink-muted"
          }
        >
          {playerLabel}
        </span>
        <span className={actionClass}>{actionLabel}</span>
      </div>
      {showRationale && (
        <p className="ml-6 mt-0.5 text-[11px] leading-relaxed text-ink-muted">
          Why: {move.rationale}
        </p>
      )}
    </li>
  );
}

/**
 * Spinner – a small inline SVG spinner shown on the Pass button while
 * a move submission is in flight.
 */
function Spinner() {
  return (
    <svg
      className="animate-spin h-3 w-3 mr-1"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
      data-testid="spinner"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns a human-readable label for the current game status.
 */
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

/**
 * Returns a human-readable winner description for finished games.
 */
function winnerLabel(game: Game): string {
  if (!game.winner) return "–";
  if (game.winner === "draw") return "Draw";
  return game.winner === "B" ? "Black (You)" : "White (AI)";
}
