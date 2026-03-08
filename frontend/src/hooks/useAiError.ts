/**
 * `useAiError` – manages the display lifecycle of AI move error notifications.
 *
 * ## Motivation
 *
 * When the backend exhausts its AI move retries it applies a deterministic
 * fallback and sets `ai_status = "error"` on the game object.  The frontend
 * needs to:
 *
 *  1. Show a contextual banner explaining what happened (not a generic error).
 *  2. Auto-dismiss the banner after a reasonable delay so it does not clutter
 *     the UI indefinitely.
 *  3. Allow the user to manually dismiss the banner before the timer fires.
 *  4. Reset cleanly when a new game starts or when the AI status transitions
 *     away from "error".
 *
 * ## Behaviour
 *
 * | `aiStatus` value | Banner visible | Auto-dismisses after |
 * |------------------|----------------|----------------------|
 * | `"error"`        | yes            | `autoDismissMs`      |
 * | anything else    | no             | –                    |
 *
 * The banner becomes visible the moment `aiStatus` transitions to `"error"`.
 * If the user dismisses it manually the timer is cancelled.  If `aiStatus`
 * changes away from `"error"` before the timer fires the banner is hidden
 * immediately and the timer is cancelled.
 *
 * ## Usage
 *
 * ```tsx
 * const { bannerVisible, dismissBanner } = useAiError(aiStatus);
 * return (
 *   <AiErrorBanner
 *     visible={bannerVisible}
 *     onDismiss={dismissBanner}
 *   />
 * );
 * ```
 */
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AiStatus } from "@/types/game";

// ── Public interface ──────────────────────────────────────────────────────────

export interface UseAiErrorOptions {
  /**
   * How long (in milliseconds) to display the AI error banner before
   * auto-dismissing it.
   *
   * Set to `0` to disable auto-dismiss (the user must dismiss manually).
   *
   * @default 8000
   */
  autoDismissMs?: number;
}

export interface UseAiErrorResult {
  /** Whether the AI error banner should currently be visible. */
  bannerVisible: boolean;
  /**
   * Call this to hide the banner immediately (e.g., when the user clicks the
   * dismiss button).  Also cancels any pending auto-dismiss timer.
   */
  dismissBanner: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns banner visibility state and a dismiss callback for AI move errors.
 *
 * @param aiStatus     The raw `ai_status` value from the game store.
 * @param options      Optional configuration.
 */
export function useAiError(
  aiStatus: AiStatus,
  { autoDismissMs = 8_000 }: UseAiErrorOptions = {},
): UseAiErrorResult {
  const [bannerVisible, setBannerVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Cancel any pending auto-dismiss timer. */
  const cancelTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Dismiss the banner immediately and cancel the timer. */
  const dismissBanner = useCallback(() => {
    cancelTimer();
    setBannerVisible(false);
  }, [cancelTimer]);

  useEffect(() => {
    if (aiStatus === "error") {
      // Show the banner.
      setBannerVisible(true);

      // Schedule auto-dismiss if configured.
      if (autoDismissMs > 0) {
        cancelTimer();
        timerRef.current = setTimeout(() => {
          setBannerVisible(false);
          timerRef.current = null;
        }, autoDismissMs);
      }
    } else {
      // AI is no longer in error state – hide the banner and cancel any timer.
      cancelTimer();
      setBannerVisible(false);
    }

    return cancelTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiStatus, autoDismissMs]);

  return { bannerVisible, dismissBanner };
}
