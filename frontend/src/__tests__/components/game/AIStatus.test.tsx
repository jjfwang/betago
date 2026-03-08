/**
 * Unit tests for the AIStatus component.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { AIStatus } from "@/components/game/AIStatus";

describe("AIStatus", () => {
  it("renders nothing when status is null", () => {
    const { container } = render(<AIStatus status={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when status is idle", () => {
    const { container } = render(<AIStatus status="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "AI thinking" when status is thinking', () => {
    render(<AIStatus status="thinking" />);
    expect(screen.getByText(/AI thinking/i)).toBeInTheDocument();
  });

  it('shows "AI move complete" when status is done', () => {
    render(<AIStatus status="done" />);
    expect(screen.getByText("AI move complete")).toBeInTheDocument();
  });

  it('shows an error message when status is error', () => {
    render(<AIStatus status="error" />);
    expect(screen.getByText(/AI error/i)).toBeInTheDocument();
  });

  it("has aria-live=polite for accessibility", () => {
    const { container } = render(<AIStatus status="thinking" />);
    expect(container.querySelector("[aria-live='polite']")).toBeInTheDocument();
  });
});
