/**
 * AIStatus – inline indicator of the AI processing state.
 *
 * Renders a contextual badge that communicates the AI's current activity to
 * the user.  The component maps each `AiStatus` value to a distinct visual
 * treatment:
 *
 *  - `thinking`  – animated spinner with "AI thinking…" label
 *  - `retrying`  – animated spinner with "AI retrying…" label (fallback path)
 *  - `done`      – checkmark icon with "AI move complete" label (auto-fades)
 *  - `error`     – warning icon with "AI error – using fallback" in danger colour
 *  - `idle`/null – renders nothing
 *
 * The component is purely presentational; it receives `status` as a prop and
 * has no internal side-effects.  State transitions (e.g. clearing `done` after
 * a short delay) are the responsibility of the parent / store layer.
 *
 * Accessibility: the wrapping `<span>` carries `aria-live="polite"` so screen
 * readers announce status changes without interrupting the user.
 */

"use client";

import React from "react";
import type { AiStatus } from "@/types/game";

// ── Public interface ──────────────────────────────────────────────────────────

export interface AIStatusProps {
  /** Current AI processing status received from the game state. */
  status: AiStatus;
  /** Optional additional CSS class names for layout positioning. */
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Renders a small inline status badge for the AI player.
 *
 * Returns `null` when `status` is `null` or `"idle"` so the component can be
 * placed unconditionally in the layout without reserving space.
 */
export function AIStatus({ status, className = "" }: AIStatusProps) {
  if (!status || status === "idle") return null;

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={ariaLabel(status)}
      className={`inline-flex items-center gap-1.5 text-xs font-medium ${className}`}
    >
      {(status === "thinking" || status === "retrying") && (
        <>
          <Spinner />
          <span className="text-ink-muted">
            {status === "thinking" ? "AI thinking\u2026" : "AI retrying\u2026"}
          </span>
        </>
      )}

      {status === "done" && (
        <>
          <CheckIcon />
          <span className="text-ink-muted">AI move complete</span>
        </>
      )}

      {status === "error" && (
        <>
          <WarningIcon />
          <span className="text-danger">AI error \u2013 using fallback</span>
        </>
      )}
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns a descriptive aria-label for each status value. */
function ariaLabel(status: NonNullable<AiStatus>): string {
  switch (status) {
    case "thinking":
      return "AI is thinking";
    case "retrying":
      return "AI is retrying move selection";
    case "done":
      return "AI move complete";
    case "error":
      return "AI encountered an error; using fallback move";
    default:
      return `AI status: ${status}`;
  }
}

// ── Icon sub-components ───────────────────────────────────────────────────────

/**
 * Animated spinning indicator used for `thinking` and `retrying` states.
 */
function Spinner() {
  return (
    <svg
      className="animate-spin h-3 w-3 text-ink-muted shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
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

/**
 * Checkmark icon used for the `done` state.
 */
function CheckIcon() {
  return (
    <svg
      className="h-3 w-3 text-ink-muted shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/**
 * Warning triangle icon used for the `error` state.
 */
function WarningIcon() {
  return (
    <svg
      className="h-3 w-3 text-danger shrink-0"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}
