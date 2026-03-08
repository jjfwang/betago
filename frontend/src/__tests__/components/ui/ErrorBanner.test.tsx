/**
 * Unit tests for the ErrorBanner component.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBanner } from "@/components/ui/ErrorBanner";

describe("ErrorBanner", () => {
  it("renders nothing when message is null", () => {
    const { container } = render(<ErrorBanner message={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the error message", () => {
    render(<ErrorBanner message="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("has role=alert for accessibility", () => {
    render(<ErrorBanner message="Error!" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("calls onDismiss when the dismiss button is clicked", async () => {
    const onDismiss = jest.fn();
    render(<ErrorBanner message="Error!" onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not render a dismiss button when onDismiss is not provided", () => {
    render(<ErrorBanner message="Error!" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
