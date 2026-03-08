/**
 * Unit tests for the GamePanel component.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GamePanel } from "@/components/game/GamePanel";
import type { Game, Move } from "@/types/game";

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
    captures: { B: 2, W: 1 },
    board: [],
    legal_moves: [],
    moves: [],
    move_count: 0,
    moves_truncated: false,
    ...overrides,
  };
}

function makeMove(overrides: Partial<Move> = {}): Move {
  return {
    move_index: 0,
    player: "human",
    action: "place",
    coordinate: "D4",
    captures: 0,
    board_hash: "abc",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const noop = () => {};

describe("GamePanel", () => {
  it("shows capture counts", () => {
    render(
      <GamePanel
        game={makeGame()}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByText(/B: 2.*W: 1/)).toBeInTheDocument();
  });

  it("shows winner when game is finished", () => {
    render(
      <GamePanel
        game={makeGame({ status: "finished", winner: "B" })}
        humanMoveEnabled={false}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByText(/Black \(You\)/)).toBeInTheDocument();
  });

  it("disables Pass and Resign when humanMoveEnabled=false", () => {
    render(
      <GamePanel
        game={makeGame()}
        humanMoveEnabled={false}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /pass/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /resign/i })).toBeDisabled();
  });

  it("enables Pass and Resign when humanMoveEnabled=true", () => {
    render(
      <GamePanel
        game={makeGame()}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /pass/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /resign/i })).not.toBeDisabled();
  });

  it("calls onPass when Pass is clicked", async () => {
    const onPass = jest.fn();
    render(
      <GamePanel
        game={makeGame()}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={onPass}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /pass/i }));
    expect(onPass).toHaveBeenCalledTimes(1);
  });

  it("calls onResign when Resign is clicked", async () => {
    const onResign = jest.fn();
    render(
      <GamePanel
        game={makeGame()}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={noop}
        onResign={onResign}
        onNewGame={noop}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /resign/i }));
    expect(onResign).toHaveBeenCalledTimes(1);
  });

  it("calls onNewGame when New Game is clicked", async () => {
    const onNewGame = jest.fn();
    render(
      <GamePanel
        game={makeGame()}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={onNewGame}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /new game/i }));
    expect(onNewGame).toHaveBeenCalledTimes(1);
  });

  it("renders move history", () => {
    const moves: Move[] = [
      makeMove({ move_index: 0, player: "human", coordinate: "D4" }),
      makeMove({
        move_index: 1,
        player: "ai",
        coordinate: "E5",
        rationale: "Good move",
      }),
    ];
    render(
      <GamePanel
        game={makeGame({ moves })}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByText("D4")).toBeInTheDocument();
    expect(screen.getByText("E5")).toBeInTheDocument();
  });

  it("shows truncated notice when moves_truncated=true", () => {
    render(
      <GamePanel
        game={makeGame({ moves_truncated: true })}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });

  it("shows AI rationale when last_ai_rationale is set", () => {
    render(
      <GamePanel
        game={makeGame({ last_ai_rationale: "Extending my group." })}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByText("Extending my group.")).toBeInTheDocument();
  });

  it("renders correctly when game is null", () => {
    render(
      <GamePanel
        game={null}
        humanMoveEnabled={false}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    // Should render without crashing; all meta values show "–"
    expect(screen.getAllByText("–").length).toBeGreaterThan(0);
  });
});
