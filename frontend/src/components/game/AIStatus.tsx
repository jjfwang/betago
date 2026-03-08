/**
 * AIStatus – small inline indicator of the AI processing state.
 *
 * Shows a spinner while the AI is thinking and a subtle confirmation once
 * the move is complete.  Hidden when the AI is idle.
 */

"use client";

import React from "react";
import type { AiStatus } from "@/types/game";

interface AIStatusProps {
  status: AiStatus;
}

export function AIStatus({ status }: AIStatusProps) {
  if (!status || status === "idle") return null;

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-ink-muted"
      aria-live="polite"
      aria-label={`AI status: ${status}`}
    >
      {status === "thinking" && (
        <>
          <Spinner />
          AI thinking
        </>
      )}
      {status === "done" && "AI move complete"}
      {status === "error" && (
        <span className="text-danger">AI error – using fallback</span>
      )}
    </span>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-3 w-3 text-ink-muted"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
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
