/**
 * Unit tests for the AIStatus component.
 *
 * Tests cover:
 *  - Rendering nothing for `null` and `"idle"` statuses.
 *  - Correct label text for each active status.
 *  - Presence of the spinner SVG for animated states.
 *  - Presence of icon SVGs for non-animated states.
 *  - Correct ARIA attributes for accessibility.
 *  - The `className` prop is forwarded to the root element.
 *  - Danger colour class applied for the `error` state.
 *  - `retryCount` and `maxRetries` props for retry progress display.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { AIStatus } from "@/components/game/AIStatus";
import type { AiStatus } from "@/types/game";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Renders `<AIStatus status={status} />` and returns the Testing Library
 * utilities for further assertions.
 */
function renderStatus(
  status: AiStatus,
  className?: string,
  retryCount?: number,
  maxRetries?: number,
) {
  return render(
    <AIStatus
      status={status}
      className={className}
      retryCount={retryCount}
      maxRetries={maxRetries}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AIStatus – hidden states", () => {
  it("renders nothing when status is null", () => {
    const { container } = renderStatus(null);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when status is idle", () => {
    const { container } = renderStatus("idle");
    expect(container.firstChild).toBeNull();
  });
});

describe("AIStatus – thinking state", () => {
  it('shows "AI thinking…" label', () => {
    renderStatus("thinking");
    expect(screen.getByText(/AI thinking/i)).toBeInTheDocument();
  });

  it("renders a spinner SVG", () => {
    const { container } = renderStatus("thinking");
    const svg = container.querySelector("svg.animate-spin");
    expect(svg).toBeInTheDocument();
  });

  it("has aria-label describing thinking state", () => {
    renderStatus("thinking");
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "AI is thinking",
    );
  });
});

describe("AIStatus – retrying state (plain)", () => {
  it('shows "AI retrying…" label without retry progress when props are omitted', () => {
    renderStatus("retrying");
    expect(screen.getByText(/AI retrying/i)).toBeInTheDocument();
    // Should NOT show "(n/max)" format.
    expect(screen.queryByText(/\(\d+\/\d+\)/)).toBeNull();
  });

  it("renders a spinner SVG (same as thinking)", () => {
    const { container } = renderStatus("retrying");
    const svg = container.querySelector("svg.animate-spin");
    expect(svg).toBeInTheDocument();
  });

  it("has aria-label describing retrying state without progress", () => {
    renderStatus("retrying");
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "AI is retrying move selection",
    );
  });
});

describe("AIStatus – retrying state (with retry progress)", () => {
  it('shows "AI retrying… (1/2)" when retryCount=1 and maxRetries=2', () => {
    renderStatus("retrying", undefined, 1, 2);
    expect(screen.getByText(/AI retrying.*\(1\/2\)/)).toBeInTheDocument();
  });

  it('shows "AI retrying… (2/2)" on the final retry attempt', () => {
    renderStatus("retrying", undefined, 2, 2);
    expect(screen.getByText(/AI retrying.*\(2\/2\)/)).toBeInTheDocument();
  });

  it("has an aria-label with attempt progress when retryCount and maxRetries are provided", () => {
    renderStatus("retrying", undefined, 1, 2);
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "AI is retrying move selection, attempt 1 of 2",
    );
  });

  it("falls back to plain label when only retryCount is provided (no maxRetries)", () => {
    renderStatus("retrying", undefined, 1, undefined);
    expect(screen.getByText(/AI retrying/i)).toBeInTheDocument();
    expect(screen.queryByText(/\(\d+\/\d+\)/)).toBeNull();
  });

  it("falls back to plain label when only maxRetries is provided (no retryCount)", () => {
    renderStatus("retrying", undefined, undefined, 2);
    expect(screen.getByText(/AI retrying/i)).toBeInTheDocument();
    expect(screen.queryByText(/\(\d+\/\d+\)/)).toBeNull();
  });
});

describe("AIStatus – done state", () => {
  it('shows "AI move complete" label', () => {
    renderStatus("done");
    expect(screen.getByText("AI move complete")).toBeInTheDocument();
  });

  it("does NOT render a spinner SVG", () => {
    const { container } = renderStatus("done");
    expect(container.querySelector("svg.animate-spin")).toBeNull();
  });

  it("renders a checkmark icon SVG", () => {
    const { container } = renderStatus("done");
    // The check icon has aria-hidden="true"; look for any non-spinning SVG.
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
    // None of them should be the spinner.
    svgs.forEach((svg) => {
      expect(svg).not.toHaveClass("animate-spin");
    });
  });

  it("has aria-label describing done state", () => {
    renderStatus("done");
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "AI move complete",
    );
  });
});

describe("AIStatus – error state", () => {
  it('shows "AI error – using fallback" message', () => {
    renderStatus("error");
    expect(screen.getByText(/AI error/i)).toBeInTheDocument();
    expect(screen.getByText(/using fallback/i)).toBeInTheDocument();
  });

  it("applies the danger colour class to the error text", () => {
    renderStatus("error");
    const errorText = screen.getByText(/AI error/i);
    expect(errorText).toHaveClass("text-danger");
  });

  it("does NOT render a spinner SVG", () => {
    const { container } = renderStatus("error");
    expect(container.querySelector("svg.animate-spin")).toBeNull();
  });

  it("renders a warning icon SVG", () => {
    const { container } = renderStatus("error");
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
  });

  it("has aria-label describing error state", () => {
    renderStatus("error");
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "AI encountered an error; using fallback move",
    );
  });
});

describe("AIStatus – accessibility", () => {
  it("has role=status on the wrapper element", () => {
    renderStatus("thinking");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has aria-live=polite for non-intrusive announcements", () => {
    const { container } = renderStatus("thinking");
    expect(
      container.querySelector("[aria-live='polite']"),
    ).toBeInTheDocument();
  });

  it("icon SVGs have aria-hidden=true so they are not read by screen readers", () => {
    const { container } = renderStatus("thinking");
    const svgs = container.querySelectorAll("svg");
    svgs.forEach((svg) => {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    });
  });
});

describe("AIStatus – className prop", () => {
  it("forwards additional class names to the root element", () => {
    renderStatus("thinking", "my-custom-class");
    expect(screen.getByRole("status")).toHaveClass("my-custom-class");
  });

  it("does not break rendering when className is omitted", () => {
    const { container } = renderStatus("done");
    expect(container.firstChild).toBeInTheDocument();
  });
});

describe("AIStatus – state transitions", () => {
  it("switches from thinking to done without error", () => {
    const { rerender } = renderStatus("thinking");
    expect(screen.getByText(/AI thinking/i)).toBeInTheDocument();

    rerender(<AIStatus status="done" />);
    expect(screen.queryByText(/AI thinking/i)).toBeNull();
    expect(screen.getByText("AI move complete")).toBeInTheDocument();
  });

  it("switches from thinking to error without error", () => {
    const { rerender } = renderStatus("thinking");
    rerender(<AIStatus status="error" />);
    expect(screen.queryByText(/AI thinking/i)).toBeNull();
    expect(screen.getByText(/AI error/i)).toBeInTheDocument();
  });

  it("switches from thinking to retrying without error", () => {
    const { rerender } = renderStatus("thinking");
    rerender(<AIStatus status="retrying" />);
    expect(screen.queryByText(/AI thinking/i)).toBeNull();
    expect(screen.getByText(/AI retrying/i)).toBeInTheDocument();
  });

  it("switches from retrying (plain) to retrying with progress", () => {
    const { rerender } = render(<AIStatus status="retrying" />);
    expect(screen.queryByText(/\(\d+\/\d+\)/)).toBeNull();
    rerender(<AIStatus status="retrying" retryCount={2} maxRetries={2} />);
    expect(screen.getByText(/AI retrying.*\(2\/2\)/)).toBeInTheDocument();
  });

  it("hides when status transitions to idle", () => {
    const { rerender, container } = renderStatus("thinking");
    rerender(<AIStatus status="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it("hides when status transitions to null", () => {
    const { rerender, container } = renderStatus("done");
    rerender(<AIStatus status={null} />);
    expect(container.firstChild).toBeNull();
  });
});
