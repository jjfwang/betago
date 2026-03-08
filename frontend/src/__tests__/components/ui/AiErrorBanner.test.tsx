/**
 * Unit tests for the AiErrorBanner component.
 *
 * Coverage:
 * - Renders nothing when `visible` is false.
 * - Renders the default message when no `message` prop is provided.
 * - Renders a custom message when `message` is provided.
 * - Accessibility: role="status" and aria-live="polite".
 * - Dismiss button: rendered when `onDismiss` is provided.
 * - Dismiss button: not rendered when `onDismiss` is omitted.
 * - Dismiss button: calls `onDismiss` when clicked.
 * - Dismiss button: has an accessible aria-label.
 * - className prop is forwarded to the root element.
 * - Warning icon is present and aria-hidden.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiErrorBanner } from "@/components/ui/AiErrorBanner";

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderBanner(
  props: Partial<React.ComponentProps<typeof AiErrorBanner>> = {},
) {
  return render(
    <AiErrorBanner
      visible={true}
      {...props}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AiErrorBanner – visibility", () => {
  it("renders nothing when visible is false", () => {
    const { container } = render(<AiErrorBanner visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the banner when visible is true", () => {
    renderBanner({ visible: true });
    expect(screen.getByTestId("ai-error-banner")).toBeInTheDocument();
  });
});

describe("AiErrorBanner – message content", () => {
  it("renders the default message when no message prop is provided", () => {
    renderBanner();
    // The default message mentions the AI issue and fallback.
    expect(screen.getByText(/AI encountered an issue/i)).toBeInTheDocument();
    expect(screen.getByText(/fallback move/i)).toBeInTheDocument();
  });

  it("renders a custom message when message prop is provided", () => {
    renderBanner({ message: "Custom AI error message for testing." });
    expect(
      screen.getByText("Custom AI error message for testing."),
    ).toBeInTheDocument();
  });

  it("does not render the default message when a custom message is provided", () => {
    renderBanner({ message: "Custom message." });
    expect(screen.queryByText(/AI encountered an issue/i)).toBeNull();
  });
});

describe("AiErrorBanner – accessibility", () => {
  it("has role=status for non-intrusive screen reader announcements", () => {
    renderBanner();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has aria-live=polite", () => {
    const { container } = renderBanner();
    expect(
      container.querySelector("[aria-live='polite']"),
    ).toBeInTheDocument();
  });

  it("warning icon SVG has aria-hidden=true", () => {
    const { container } = renderBanner();
    const svgs = container.querySelectorAll("svg");
    svgs.forEach((svg) => {
      expect(svg).toHaveAttribute("aria-hidden", "true");
    });
  });
});

describe("AiErrorBanner – dismiss button", () => {
  it("renders a dismiss button when onDismiss is provided", () => {
    renderBanner({ onDismiss: jest.fn() });
    expect(
      screen.getByRole("button", { name: /dismiss/i }),
    ).toBeInTheDocument();
  });

  it("does not render a dismiss button when onDismiss is omitted", () => {
    renderBanner();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("calls onDismiss when the dismiss button is clicked", async () => {
    const onDismiss = jest.fn();
    renderBanner({ onDismiss });
    await userEvent.click(
      screen.getByRole("button", { name: /dismiss/i }),
    );
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismiss button has an accessible aria-label", () => {
    renderBanner({ onDismiss: jest.fn() });
    const btn = screen.getByTestId("ai-error-banner-dismiss");
    expect(btn).toHaveAttribute("aria-label");
    expect(btn.getAttribute("aria-label")).toMatch(/dismiss/i);
  });
});

describe("AiErrorBanner – className prop", () => {
  it("forwards additional class names to the root element", () => {
    renderBanner({ className: "my-custom-class" });
    expect(screen.getByTestId("ai-error-banner")).toHaveClass("my-custom-class");
  });

  it("does not break rendering when className is omitted", () => {
    const { container } = renderBanner();
    expect(container.firstChild).toBeInTheDocument();
  });
});

describe("AiErrorBanner – visual style", () => {
  it("applies amber background styling for a non-critical warning appearance", () => {
    renderBanner();
    const banner = screen.getByTestId("ai-error-banner");
    // Amber background indicates a warning (not a critical error).
    expect(banner.className).toMatch(/amber/);
  });
});
