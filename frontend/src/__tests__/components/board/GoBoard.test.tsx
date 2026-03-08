/**
 * Unit tests for the GoBoard component.
 *
 * These tests verify the SVG structure, stone rendering, and click interaction
 * without relying on pixel-level layout (which varies by viewport).
 */

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { GoBoard } from "@/components/board/GoBoard";
import type { Board, LegalMove } from "@/types/game";

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyBoard(size: number): Board {
  return Array.from({ length: size }, () => Array(size).fill(null));
}

function boardWithStone(
  size: number,
  x: number,
  y: number,
  color: "B" | "W",
): Board {
  const board = emptyBoard(size);
  board[y][x] = color;
  return board;
}

const noop = () => {};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GoBoard", () => {
  it("renders an SVG element with role=img", () => {
    render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    expect(screen.getByRole("img", { name: /go board/i })).toBeInTheDocument();
  });

  it("renders grid lines for a 9x9 board (9 horizontal + 9 vertical = 18 lines)", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    const lines = container.querySelectorAll("line");
    expect(lines.length).toBe(18);
  });

  it("renders column and row coordinate labels", () => {
    render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    // Column A should appear twice (top and bottom labels)
    const aLabels = screen.getAllByText("A");
    expect(aLabels.length).toBe(2);
    // Row label 9 should appear twice (left and right)
    const nineLabels = screen.getAllByText("9");
    expect(nineLabels.length).toBe(2);
  });

  it("renders a black stone when the board has a B value", () => {
    const board = boardWithStone(9, 4, 4, "B");
    const { container } = render(
      <GoBoard
        board={board}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    // Black stone has fill="#1a1a1a"
    const blackStone = container.querySelector('circle[fill="#1a1a1a"]');
    expect(blackStone).toBeInTheDocument();
  });

  it("renders a white stone when the board has a W value", () => {
    const board = boardWithStone(9, 2, 2, "W");
    const { container } = render(
      <GoBoard
        board={board}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    // White stone has fill="#f5f5f0"
    const whiteStone = container.querySelector('circle[fill="#f5f5f0"]');
    expect(whiteStone).toBeInTheDocument();
  });

  it("does not call onIntersectionClick when interactive=false", () => {
    const onClick = jest.fn();
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[{ x: 4, y: 4 }]}
        interactive={false}
        onIntersectionClick={onClick}
      />,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.click(svg, { clientX: 250, clientY: 250 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders star points for a 9x9 board", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    // Star points have fill="#5a3e10"; there are 5 for a 9x9 board
    const stars = container.querySelectorAll('circle[fill="#5a3e10"]');
    expect(stars.length).toBe(5);
  });

  it("renders star points for a 19x19 board", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(19)}
        boardSize={19}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    const stars = container.querySelectorAll('circle[fill="#5a3e10"]');
    expect(stars.length).toBe(9);
  });

  it("uses pointer cursor when interactive=true", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[{ x: 0, y: 0 }]}
        interactive={true}
        onIntersectionClick={noop}
      />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.style.cursor).toBe("pointer");
  });

  it("uses default cursor when interactive=false", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    const svg = container.querySelector("svg")!;
    expect(svg.style.cursor).toBe("default");
  });
});
