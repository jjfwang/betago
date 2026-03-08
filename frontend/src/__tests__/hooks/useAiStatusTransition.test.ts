/**
 * Unit tests for the `useAiStatusTransition` hook.
 *
 * Tests cover:
 *  - Pass-through of non-transient statuses (thinking, retrying, null).
 *  - Normalisation of "idle" → null.
 *  - Auto-clear of "done" after `doneDisplayMs`.
 *  - Auto-clear of "error" after `errorDisplayMs`.
 *  - Timer cancellation when status changes before the delay fires.
 *  - Custom delay overrides.
 */

import { renderHook, act } from "@testing-library/react";
import { useAiStatusTransition } from "@/hooks/useAiStatusTransition";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe("useAiStatusTransition – pass-through states", () => {
  it("returns null when status is null", () => {
    const { result } = renderHook(() => useAiStatusTransition(null));
    expect(result.current).toBeNull();
  });

  it("normalises 'idle' to null", () => {
    const { result } = renderHook(() => useAiStatusTransition("idle"));
    expect(result.current).toBeNull();
  });

  it("returns 'thinking' immediately", () => {
    const { result } = renderHook(() => useAiStatusTransition("thinking"));
    expect(result.current).toBe("thinking");
  });

  it("returns 'retrying' immediately", () => {
    const { result } = renderHook(() => useAiStatusTransition("retrying"));
    expect(result.current).toBe("retrying");
  });
});

describe("useAiStatusTransition – done state auto-clear", () => {
  it("shows 'done' immediately", () => {
    const { result } = renderHook(() =>
      useAiStatusTransition("done", { doneDisplayMs: 2000 }),
    );
    expect(result.current).toBe("done");
  });

  it("clears 'done' to null after doneDisplayMs", () => {
    const { result } = renderHook(() =>
      useAiStatusTransition("done", { doneDisplayMs: 2000 }),
    );
    expect(result.current).toBe("done");

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current).toBeNull();
  });

  it("does not clear 'done' before doneDisplayMs has elapsed", () => {
    const { result } = renderHook(() =>
      useAiStatusTransition("done", { doneDisplayMs: 2000 }),
    );
    act(() => {
      jest.advanceTimersByTime(1999);
    });
    expect(result.current).toBe("done");
  });

  it("uses the default 2000 ms when no option is provided", () => {
    const { result } = renderHook(() => useAiStatusTransition("done"));
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current).toBeNull();
  });
});

describe("useAiStatusTransition – error state auto-clear", () => {
  it("shows 'error' immediately", () => {
    const { result } = renderHook(() =>
      useAiStatusTransition("error", { errorDisplayMs: 4000 }),
    );
    expect(result.current).toBe("error");
  });

  it("clears 'error' to null after errorDisplayMs", () => {
    const { result } = renderHook(() =>
      useAiStatusTransition("error", { errorDisplayMs: 4000 }),
    );
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(result.current).toBeNull();
  });

  it("does not clear 'error' before errorDisplayMs has elapsed", () => {
    const { result } = renderHook(() =>
      useAiStatusTransition("error", { errorDisplayMs: 4000 }),
    );
    act(() => {
      jest.advanceTimersByTime(3999);
    });
    expect(result.current).toBe("error");
  });

  it("uses the default 4000 ms when no option is provided", () => {
    const { result } = renderHook(() => useAiStatusTransition("error"));
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(result.current).toBeNull();
  });
});

describe("useAiStatusTransition – timer cancellation on status change", () => {
  it("cancels the done timer when status changes to thinking before it fires", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: import("@/types/game").AiStatus }) =>
        useAiStatusTransition(status, { doneDisplayMs: 2000 }),
      { initialProps: { status: "done" as import("@/types/game").AiStatus } },
    );
    expect(result.current).toBe("done");

    // Change status before the timer fires.
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    rerender({ status: "thinking" });
    expect(result.current).toBe("thinking");

    // Advance past the original done timer; it should not fire.
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(result.current).toBe("thinking");
  });

  it("cancels the error timer when status changes to null before it fires", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: import("@/types/game").AiStatus }) =>
        useAiStatusTransition(status, { errorDisplayMs: 4000 }),
      { initialProps: { status: "error" as import("@/types/game").AiStatus } },
    );
    expect(result.current).toBe("error");

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    rerender({ status: null });
    expect(result.current).toBeNull();

    // Advance past the original error timer; it should not fire.
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current).toBeNull();
  });

  it("resets the done timer when status cycles done → thinking → done", () => {
    const { result, rerender } = renderHook(
      ({ status }: { status: import("@/types/game").AiStatus }) =>
        useAiStatusTransition(status, { doneDisplayMs: 2000 }),
      { initialProps: { status: "done" as import("@/types/game").AiStatus } },
    );

    // Advance partway through first done display.
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    rerender({ status: "thinking" });

    // AI makes another move.
    rerender({ status: "done" });
    expect(result.current).toBe("done");

    // The new timer should run for a full 2000 ms from this point.
    act(() => {
      jest.advanceTimersByTime(1999);
    });
    expect(result.current).toBe("done");

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBeNull();
  });
});

describe("useAiStatusTransition – custom delay overrides", () => {
  it("respects a custom doneDisplayMs of 500 ms", () => {
    const { result } = renderHook(() =>
      useAiStatusTransition("done", { doneDisplayMs: 500 }),
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current).toBeNull();
  });

  it("respects a custom errorDisplayMs of 1000 ms", () => {
    const { result } = renderHook(() =>
      useAiStatusTransition("error", { errorDisplayMs: 1000 }),
    );
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toBeNull();
  });
});
