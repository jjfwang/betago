/**
 * AiErrorBanner – dismissible banner surfacing AI move errors to the user.
 *
 * This component is distinct from the generic `ErrorBanner` because AI move
 * errors have a specific, recoverable character: the backend has already
 * applied a deterministic fallback move, so the game continues.  The message
 * should therefore be informational rather than alarming, and it must be
 * clearly dismissible once the user has acknowledged it.
 *
 * ## When to render
 *
 * Render this component whenever `ai_status === "error"` is observed on the
 * game object.  The parent is responsible for deciding when to dismiss it
 * (e.g., after a configurable auto-dismiss timeout or on explicit user action).
 *
 * ## Accessibility
 *
 * The banner uses `role="status"` (not `role="alert"`) because the game is
 * still playable after a fallback move; the situation is informational rather
 * than critical.  Screen readers will announce the message politely without
 * interrupting the user's current focus.
 */
"use client";
import React from "react";

// ── Public interface ──────────────────────────────────────────────────────────

export interface AiErrorBannerProps {
  /**
   * Whether the banner is visible.  When `false` the component renders
   * nothing, allowing the parent to control visibility via state without
   * unmounting the node.
   */
  visible: boolean;
  /**
   * Human-readable description of what went wrong.  Defaults to a generic
   * fallback message when not provided.
   */
  message?: string;
  /**
   * Called when the user clicks the dismiss button.  If omitted the dismiss
   * button is not rendered (non-dismissible mode).
   */
  onDismiss?: () => void;
  /** Optional additional CSS class names for layout positioning. */
  className?: string;
}

/** Default message shown when no explicit message is provided. */
const DEFAULT_MESSAGE =
  "The AI encountered an issue selecting a move. A fallback move was applied automatically — the game continues normally.";

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Renders an informational banner describing an AI move error and the
 * automatic fallback that was applied.
 *
 * Returns `null` when `visible` is `false` so the component can be placed
 * unconditionally in the layout without reserving space.
 */
export function AiErrorBanner({
  visible,
  message = DEFAULT_MESSAGE,
  onDismiss,
  className = "",
}: AiErrorBannerProps) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="ai-error-banner"
      className={`flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ${className}`}
    >
      {/* Icon + message */}
      <div className="flex items-start gap-2 min-w-0">
        <WarningIcon />
        <p className="leading-snug">{message}</p>
      </div>

      {/* Dismiss button */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 text-amber-700 hover:text-amber-900 hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
          aria-label="Dismiss AI error notification"
          data-testid="ai-error-banner-dismiss"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

// ── Icon sub-components ───────────────────────────────────────────────────────

/**
 * Warning triangle icon indicating a non-critical issue.
 */
function WarningIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 mt-0.5 text-amber-600"
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

/**
 * Close / dismiss icon (×).
 */
function CloseIcon() {
  return (
    <svg
      className="h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}
