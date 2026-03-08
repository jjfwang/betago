/**
 * Unit tests for the TurnIndicator component.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { TurnIndicator } from "@/components/game/TurnIndicator";
import type { Game } from "@/types/game";

function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: "g1",
    board_size: 9,
    komi: 5.5,
    ai_level: "medium",
    status: "human_turn",
    winner: null,
    turn: "B",
    turn_version: 1,
    pending_action: null,
    ai_status: "idle",
    captures: { B: 0, W: 0 },
    board: [],
    legal_moves: [],
    moves: [],
    move_count: 0,
    moves_truncated: false,
    ...overrides,
  };
}

describe("TurnIndicator", () => {
  it('shows "Loading game…" when game is null', () => {
    render(<TurnIndicator game={null} />);
    expect(screen.getByText("Loading game…")).toBeInTheDocument();
  });

  it('shows "Your turn" when status is human_turn', () => {
    render(<TurnIndicator game={makeGame({ status: "human_turn" })} />);
    expect(screen.getByText("Your turn")).toBeInTheDocument();
  });

  it('shows "AI thinking…" when status is ai_thinking', () => {
    render(<TurnIndicator game={makeGame({ status: "ai_thinking" })} />);
    expect(screen.getByText("AI thinking…")).toBeInTheDocument();
  });

  it('shows "Game over – You win!" when Black wins', () => {
    render(
      <TurnIndicator
        game={makeGame({ status: "finished", winner: "B" })}
      />,
    );
    expect(screen.getByText("Game over – You win!")).toBeInTheDocument();
  });

  it('shows "Game over – AI wins" when White wins', () => {
    render(
      <TurnIndicator
        game={makeGame({ status: "finished", winner: "W" })}
      />,
    );
    expect(screen.getByText("Game over – AI wins")).toBeInTheDocument();
  });

  it('shows "Game over – Draw" for a draw', () => {
    render(
      <TurnIndicator
        game={makeGame({ status: "finished", winner: "draw" })}
      />,
    );
    expect(screen.getByText("Game over – Draw")).toBeInTheDocument();
  });

  it("has aria-live=polite for accessibility", () => {
    const { container } = render(<TurnIndicator game={null} />);
    expect(container.querySelector("[aria-live='polite']")).toBeInTheDocument();
  });
});
