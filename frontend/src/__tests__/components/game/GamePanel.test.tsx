/**
 * Unit tests for the GamePanel component.
 *
 * Coverage:
 * - Game metadata display (captures, komi, status labels).
 * - Result summary section for finished games (winner, scoring, draw).
 * - AI rationale display.
 * - Control button states (enabled/disabled, aria-busy, spinner).
 * - Button click handlers (onPass, onResign, onNewGame).
 * - Move history rendering (place, pass, resign action types).
 * - Truncated move history notice.
 * - Empty move history state.
 * - Null game state graceful rendering.
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
  // ── Game metadata ──────────────────────────────────────────────────────────

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

  it("shows komi in game info", () => {
    render(
      <GamePanel
        game={makeGame({ komi: 6.5 })}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByText("6.5")).toBeInTheDocument();
  });

  it("shows 'Your turn' status when game is human_turn", () => {
    render(
      <GamePanel
        game={makeGame({ status: "human_turn" })}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByText("Your turn")).toBeInTheDocument();
  });

  it("shows 'AI thinking...' status when game is ai_thinking", () => {
    render(
      <GamePanel
        game={makeGame({ status: "ai_thinking" })}
        humanMoveEnabled={false}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByText(/AI thinking/)).toBeInTheDocument();
  });

  it("shows 'Game over' status when game is finished", () => {
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
    expect(screen.getByText("Game over")).toBeInTheDocument();
  });

  // ── Result summary ─────────────────────────────────────────────────────────

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

  it("shows 'White (AI)' when AI wins", () => {
    render(
      <GamePanel
        game={makeGame({ status: "finished", winner: "W" })}
        humanMoveEnabled={false}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByText(/White \(AI\)/)).toBeInTheDocument();
  });

  it("shows 'Draw' when game ends in a draw", () => {
    render(
      <GamePanel
        game={makeGame({ status: "finished", winner: "draw" })}
        humanMoveEnabled={false}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByText("Draw")).toBeInTheDocument();
  });

  it("shows result section with scoring summary when game is finished", () => {
    render(
      <GamePanel
        game={makeGame({
          status: "finished",
          winner: "B",
          captures: { B: 3, W: 2 },
          komi: 5.5,
          move_count: 42,
        })}
        humanMoveEnabled={false}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByText("Result")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("does not show result section when game is active", () => {
    render(
      <GamePanel
        game={makeGame({ status: "human_turn" })}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });

  // ── AI rationale ───────────────────────────────────────────────────────────

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

  it("does not show AI rationale section when last_ai_rationale is absent", () => {
    render(
      <GamePanel
        game={makeGame({ last_ai_rationale: undefined })}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.queryByText("AI Rationale")).not.toBeInTheDocument();
  });

  // ── Control button states ──────────────────────────────────────────────────

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

  it("disables all action buttons when isSubmitting=true", () => {
    render(
      <GamePanel
        game={makeGame()}
        humanMoveEnabled={true}
        isSubmitting={true}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByRole("button", { name: /pass/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /resign/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /new game/i })).toBeDisabled();
  });

  it("shows spinner on Pass button when isSubmitting=true", () => {
    render(
      <GamePanel
        game={makeGame()}
        humanMoveEnabled={true}
        isSubmitting={true}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByTestId("spinner")).toBeInTheDocument();
  });

  it("does not show spinner when isSubmitting=false", () => {
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
    expect(screen.queryByTestId("spinner")).not.toBeInTheDocument();
  });

  // ── Button click handlers ──────────────────────────────────────────────────

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

  it("does not call onPass when button is disabled", async () => {
    const onPass = jest.fn();
    render(
      <GamePanel
        game={makeGame()}
        humanMoveEnabled={false}
        isSubmitting={false}
        onPass={onPass}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /pass/i }));
    expect(onPass).not.toHaveBeenCalled();
  });

  // ── Move history ───────────────────────────────────────────────────────────

  it("renders move history with place actions", () => {
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

  it("renders pass action in move history", () => {
    const moves: Move[] = [
      makeMove({ move_index: 0, player: "human", action: "pass", coordinate: null }),
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
    // The move history list should contain a "Pass" span (distinct from the Pass button)
    const historyList = screen.getByRole("list", { name: /move history/i });
    expect(historyList).toHaveTextContent("Pass");
  });

  it("renders resign action in move history", () => {
    const moves: Move[] = [
      makeMove({ move_index: 0, player: "human", action: "resign", coordinate: null }),
    ];
    render(
      <GamePanel
        game={makeGame({ moves })}
        humanMoveEnabled={false}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    // The move history list should contain a "Resign" span (distinct from the Resign button)
    const historyList = screen.getByRole("list", { name: /move history/i });
    expect(historyList).toHaveTextContent("Resign");
  });

  it("shows move index numbers in history", () => {
    const moves: Move[] = [
      makeMove({ move_index: 0, player: "human", coordinate: "A1" }),
      makeMove({ move_index: 1, player: "ai", coordinate: "B2" }),
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
    expect(screen.getByText("1.")).toBeInTheDocument();
    expect(screen.getByText("2.")).toBeInTheDocument();
  });

  it("shows 'You' and 'AI' player labels in history", () => {
    const moves: Move[] = [
      makeMove({ move_index: 0, player: "human", coordinate: "A1" }),
      makeMove({ move_index: 1, player: "ai", coordinate: "B2" }),
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
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
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

  it("shows 'No moves yet' when move list is empty", () => {
    render(
      <GamePanel
        game={makeGame({ moves: [] })}
        humanMoveEnabled={true}
        isSubmitting={false}
        onPass={noop}
        onResign={noop}
        onNewGame={noop}
      />,
    );
    expect(screen.getByText(/no moves yet/i)).toBeInTheDocument();
  });

  // ── Null game state ────────────────────────────────────────────────────────

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
    // Should render without crashing; all meta values show dash
    expect(screen.getAllByText("\u2013").length).toBeGreaterThan(0);
  });

  it("shows 'No moves yet' when game is null", () => {
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
    expect(screen.getByText(/no moves yet/i)).toBeInTheDocument();
  });

  it("shows 'Loading...' status when game is null", () => {
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
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });
});
