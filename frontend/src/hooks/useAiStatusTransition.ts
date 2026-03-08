/**
 * `useAiStatusTransition` – manages the display lifecycle of transient AI
 * status values so the UI automatically clears them after a brief period.
 *
 * ## Motivation
 *
 * The `done` and `error` states from the backend are informational: once the
 * user has had a moment to register them they should disappear to avoid
 * cluttering the status row.  The raw `ai_status` field on the game object
 * persists in the database (it is the last-written value), so the frontend
 * must own the "clear after N ms" behaviour.
 *
 * ## Behaviour
 *
 * | Incoming status | Display status | Auto-clears after |
 * |-----------------|----------------|-------------------|
 * | `null`          | `null`         | –                 |
 * | `"idle"`        | `null`         | –                 |
 * | `"thinking"`    | `"thinking"`   | –                 |
 * | `"retrying"`    | `"retrying"`   | –                 |
 * | `"done"`        | `"done"`       | `doneDisplayMs`   |
 * | `"error"`       | `"error"`      | `errorDisplayMs`  |
 *
 * When the incoming status changes to a non-transient value (`thinking`,
 * `retrying`, or `null`/`idle`) any pending timer is cancelled immediately.
 *
 * ## Usage
 *
 * ```tsx
 * const displayStatus = useAiStatusTransition(aiStatus);
 * return <AIStatus status={displayStatus} />;
 * ```
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type { AiStatus } from "@/types/game";

export interface UseAiStatusTransitionOptions {
  /**
   * How long (in milliseconds) to display the `"done"` status before clearing
   * it back to `null`.
   * @default 2000
   */
  doneDisplayMs?: number;
  /**
   * How long (in milliseconds) to display the `"error"` status before clearing
   * it back to `null`.
   * @default 4000
   */
  errorDisplayMs?: number;
}

/**
 * Returns a display-ready AI status that automatically clears transient states
 * (`"done"` and `"error"`) after a configurable delay.
 *
 * @param status - The raw `ai_status` value from the game store.
 * @param options - Optional timing configuration.
 * @returns The status to pass to `<AIStatus />`.
 */
export function useAiStatusTransition(
  status: AiStatus,
  {
    doneDisplayMs = 2000,
    errorDisplayMs = 4000,
  }: UseAiStatusTransitionOptions = {},
): AiStatus {
  // Normalise idle → null so callers don't need to handle both.
  const normalised: AiStatus = status === "idle" ? null : status;

  const [displayStatus, setDisplayStatus] = useState<AiStatus>(normalised);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Cancel any pending auto-clear timer when the incoming status changes.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setDisplayStatus(normalised);

    // Schedule auto-clear for transient states.
    if (normalised === "done") {
      timerRef.current = setTimeout(
        () => setDisplayStatus(null),
        doneDisplayMs,
      );
    } else if (normalised === "error") {
      timerRef.current = setTimeout(
        () => setDisplayStatus(null),
        errorDisplayMs,
      );
    }

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalised, doneDisplayMs, errorDisplayMs]);

  return displayStatus;
}
