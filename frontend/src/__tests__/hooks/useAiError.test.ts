/**
 * Unit tests for the `useAiError` hook.
 *
 * Coverage:
 * - Initial state: banner hidden when aiStatus is not "error".
 * - Banner becomes visible immediately when aiStatus transitions to "error".
 * - Banner auto-dismisses after `autoDismissMs`.
 * - Banner does NOT auto-dismiss before `autoDismissMs` has elapsed.
 * - `dismissBanner` hides the banner immediately and cancels the timer.
 * - Banner hides immediately when aiStatus transitions away from "error".
 * - Timer is cancelled when aiStatus transitions away from "error".
 * - Auto-dismiss is disabled when `autoDismissMs === 0`.
 * - Default `autoDismissMs` of 8000 ms is used when no option is provided.
 * - Banner re-shows if aiStatus transitions back to "error" after being dismissed.
 * - Timer is reset when aiStatus cycles through error → thinking → error.
 */
import { act, renderHook } from "@testing-library/react";
import { useAiError } from "@/hooks/useAiError";
import type { AiStatus } from "@/types/game";

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useAiError – initial state", () => {
  it("banner is hidden when aiStatus is null", () => {
    const { result } = renderHook(() => useAiError(null));
    expect(result.current.bannerVisible).toBe(false);
  });

  it("banner is hidden when aiStatus is idle", () => {
    const { result } = renderHook(() => useAiError("idle"));
    expect(result.current.bannerVisible).toBe(false);
  });

  it("banner is hidden when aiStatus is thinking", () => {
    const { result } = renderHook(() => useAiError("thinking"));
    expect(result.current.bannerVisible).toBe(false);
  });

  it("banner is hidden when aiStatus is retrying", () => {
    const { result } = renderHook(() => useAiError("retrying"));
    expect(result.current.bannerVisible).toBe(false);
  });

  it("banner is hidden when aiStatus is done", () => {
    const { result } = renderHook(() => useAiError("done"));
    expect(result.current.bannerVisible).toBe(false);
  });
});

describe("useAiError – error state visibility", () => {
  it("banner becomes visible immediately when aiStatus is error", () => {
    const { result } = renderHook(() =>
      useAiError("error", { autoDismissMs: 8000 }),
    );
    expect(result.current.bannerVisible).toBe(true);
  });

  it("banner becomes visible when aiStatus transitions to error", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: AiStatus }) =>
        useAiError(status, { autoDismissMs: 8000 }),
      { initialProps: { status: "thinking" as AiStatus } },
    );
    expect(result.current.bannerVisible).toBe(false);

    rerender({ status: "error" });
    expect(result.current.bannerVisible).toBe(true);
  });
});

describe("useAiError – auto-dismiss", () => {
  it("auto-dismisses after autoDismissMs", () => {
    const { result } = renderHook(() =>
      useAiError("error", { autoDismissMs: 8000 }),
    );
    expect(result.current.bannerVisible).toBe(true);

    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(result.current.bannerVisible).toBe(false);
  });

  it("does NOT auto-dismiss before autoDismissMs has elapsed", () => {
    const { result } = renderHook(() =>
      useAiError("error", { autoDismissMs: 8000 }),
    );
    act(() => {
      jest.advanceTimersByTime(7999);
    });
    expect(result.current.bannerVisible).toBe(true);
  });

  it("uses the default 8000 ms when no option is provided", () => {
    const { result } = renderHook(() => useAiError("error"));
    act(() => {
      jest.advanceTimersByTime(8000);
    });
    expect(result.current.bannerVisible).toBe(false);
  });

  it("does NOT auto-dismiss when autoDismissMs is 0", () => {
    const { result } = renderHook(() =>
      useAiError("error", { autoDismissMs: 0 }),
    );
    act(() => {
      jest.advanceTimersByTime(60_000); // advance a full minute
    });
    expect(result.current.bannerVisible).toBe(true);
  });
});

describe("useAiError – manual dismiss", () => {
  it("dismissBanner hides the banner immediately", () => {
    const { result } = renderHook(() =>
      useAiError("error", { autoDismissMs: 8000 }),
    );
    expect(result.current.bannerVisible).toBe(true);

    act(() => {
      result.current.dismissBanner();
    });
    expect(result.current.bannerVisible).toBe(false);
  });

  it("dismissBanner cancels the auto-dismiss timer", () => {
    const { result } = renderHook(() =>
      useAiError("error", { autoDismissMs: 8000 }),
    );
    act(() => {
      jest.advanceTimersByTime(4000);
    });

    // Dismiss manually before the timer fires.
    act(() => {
      result.current.dismissBanner();
    });
    expect(result.current.bannerVisible).toBe(false);

    // Advance past the original timer; it should not re-show the banner.
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.bannerVisible).toBe(false);
  });
});

describe("useAiError – status transitions away from error", () => {
  it("hides the banner immediately when aiStatus transitions to thinking", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: AiStatus }) =>
        useAiError(status, { autoDismissMs: 8000 }),
      { initialProps: { status: "error" as AiStatus } },
    );
    expect(result.current.bannerVisible).toBe(true);

    rerender({ status: "thinking" });
    expect(result.current.bannerVisible).toBe(false);
  });

  it("hides the banner immediately when aiStatus transitions to null", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: AiStatus }) =>
        useAiError(status, { autoDismissMs: 8000 }),
      { initialProps: { status: "error" as AiStatus } },
    );
    rerender({ status: null });
    expect(result.current.bannerVisible).toBe(false);
  });

  it("cancels the auto-dismiss timer when aiStatus transitions away from error", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: AiStatus }) =>
        useAiError(status, { autoDismissMs: 8000 }),
      { initialProps: { status: "error" as AiStatus } },
    );
    act(() => {
      jest.advanceTimersByTime(4000);
    });

    // Transition away before the timer fires.
    rerender({ status: "thinking" });
    expect(result.current.bannerVisible).toBe(false);

    // Advance past the original timer; banner should remain hidden.
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(result.current.bannerVisible).toBe(false);
  });
});

describe("useAiError – re-show after dismiss", () => {
  it("banner re-shows if aiStatus transitions back to error after being dismissed", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: AiStatus }) =>
        useAiError(status, { autoDismissMs: 8000 }),
      { initialProps: { status: "error" as AiStatus } },
    );
    // Dismiss manually.
    act(() => {
      result.current.dismissBanner();
    });
    expect(result.current.bannerVisible).toBe(false);

    // Simulate a new AI error on the next turn.
    rerender({ status: "thinking" });
    rerender({ status: "error" });
    expect(result.current.bannerVisible).toBe(true);
  });

  it("resets the auto-dismiss timer when aiStatus cycles error → thinking → error", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: AiStatus }) =>
        useAiError(status, { autoDismissMs: 8000 }),
      { initialProps: { status: "error" as AiStatus } },
    );
    // Advance partway through first error display.
    act(() => {
      jest.advanceTimersByTime(5000);
    });

    // Transition away then back to error.
    rerender({ status: "thinking" });
    rerender({ status: "error" });
    expect(result.current.bannerVisible).toBe(true);

    // The new timer should run for a full 8000 ms from this point.
    act(() => {
      jest.advanceTimersByTime(7999);
    });
    expect(result.current.bannerVisible).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.bannerVisible).toBe(false);
  });
});

describe("useAiError – custom autoDismissMs", () => {
  it("respects a custom autoDismissMs of 2000 ms", () => {
    const { result } = renderHook(() =>
      useAiError("error", { autoDismissMs: 2000 }),
    );
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current.bannerVisible).toBe(false);
  });

  it("does not dismiss before the custom autoDismissMs", () => {
    const { result } = renderHook(() =>
      useAiError("error", { autoDismissMs: 2000 }),
    );
    act(() => {
      jest.advanceTimersByTime(1999);
    });
    expect(result.current.bannerVisible).toBe(true);
  });
});
