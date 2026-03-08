/**
 * Tests for the GoBoard component.
 *
 * These tests cover:
 * - Basic rendering (SVG structure, grid lines, coordinate labels, star points)
 * - Stone rendering (black and white, using data-testid selectors)
 * - Last-move marker rendering
 * - Interaction guards (interactive=false blocks all clicks)
 * - Legal-move click handling (onIntersectionClick is called correctly)
 * - Illegal-move flash feedback (flash element appears on illegal click)
 * - Ghost-stone hover preview
 * - Touch event handling (touchend fires onIntersectionClick)
 * - Cursor style based on interactive prop
 * - 13x13 and 19x19 board sizes
 *
 * Note: We cannot reliably test pixel-perfect SVG coordinate math in jsdom
 * because getBoundingClientRect() always returns zeros.  Interaction tests
 * therefore mock getBoundingClientRect on the SVG element to return a 500×500
 * bounding box at the origin, matching the component's SVG_SIZE constant.
 */
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { GoBoard } from "@/components/board/GoBoard";
import type { Board, LegalMove } from "@/types/game";

// ── Constants (mirrored from component) ──────────────────────────────────────

const SVG_SIZE = 500;
const PADDING = 28;

function cell(boardSize: number): number {
  return (SVG_SIZE - PADDING * 2) / (boardSize - 1);
}

/** Return a mock DOMRect for a 500×500 SVG at the origin. */
function mockRect(): DOMRect {
  return {
    left: 0,
    top: 0,
    width: SVG_SIZE,
    height: SVG_SIZE,
    right: SVG_SIZE,
    bottom: SVG_SIZE,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

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
  // ── Basic rendering ─────────────────────────────────────────────────────

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

  it("attaches data-testid='go-board' to the SVG element", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    expect(
      container.querySelector('[data-testid="go-board"]'),
    ).toBeInTheDocument();
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

  it("renders grid lines for a 13x13 board (13 + 13 = 26 lines)", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(13)}
        boardSize={13}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    const lines = container.querySelectorAll("line");
    expect(lines.length).toBe(26);
  });

  it("renders grid lines for a 19x19 board (19 + 19 = 38 lines)", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(19)}
        boardSize={19}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    const lines = container.querySelectorAll("line");
    expect(lines.length).toBe(38);
  });

  it("renders column and row coordinate labels for a 9x9 board", () => {
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
    // Column I is skipped in Go notation; J should be present
    const jLabels = screen.getAllByText("J");
    expect(jLabels.length).toBe(2);
  });

  it("renders a board background rect with the wood colour", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    const bg = container.querySelector('rect[fill="#dcb468"]');
    expect(bg).toBeInTheDocument();
  });

  it("includes SVG gradient defs for stone rendering", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    expect(
      container.querySelector("#stone-grad-black"),
    ).toBeInTheDocument();
    expect(
      container.querySelector("#stone-grad-white"),
    ).toBeInTheDocument();
  });

  // ── Stone rendering ─────────────────────────────────────────────────────

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
    const blackStone = container.querySelector('[data-testid="stone-black"]');
    expect(blackStone).toBeInTheDocument();
    expect(blackStone).toHaveAttribute("data-stone-color", "B");
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
    const whiteStone = container.querySelector('[data-testid="stone-white"]');
    expect(whiteStone).toBeInTheDocument();
    expect(whiteStone).toHaveAttribute("data-stone-color", "W");
  });

  it("renders no stones on an empty board", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    expect(container.querySelectorAll("[data-stone-color]").length).toBe(0);
  });

  it("renders multiple stones of both colours", () => {
    const board = emptyBoard(9);
    board[0][0] = "B";
    board[0][1] = "W";
    board[1][0] = "B";
    const { container } = render(
      <GoBoard
        board={board}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    expect(
      container.querySelectorAll('[data-testid="stone-black"]').length,
    ).toBe(2);
    expect(
      container.querySelectorAll('[data-testid="stone-white"]').length,
    ).toBe(1);
  });

  // ── Star points ─────────────────────────────────────────────────────────

  it("renders 5 star points for a 9x9 board", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    const stars = container.querySelectorAll('circle[fill="#5a3e10"]');
    expect(stars.length).toBe(5);
  });

  it("renders 5 star points for a 13x13 board", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(13)}
        boardSize={13}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    const stars = container.querySelectorAll('circle[fill="#5a3e10"]');
    expect(stars.length).toBe(5);
  });

  it("renders 9 star points for a 19x19 board", () => {
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

  it("renders no star points for an unsupported board size", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(7)}
        boardSize={7}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    const stars = container.querySelectorAll('circle[fill="#5a3e10"]');
    expect(stars.length).toBe(0);
  });

  // ── Last-move marker ────────────────────────────────────────────────────

  it("renders a last-move marker when lastMove is provided and a stone is present", () => {
    const board = boardWithStone(9, 4, 4, "B");
    const { container } = render(
      <GoBoard
        board={board}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
        lastMove={{ x: 4, y: 4 }}
      />,
    );
    const marker = container.querySelector(
      '[data-testid="last-move-marker"]',
    );
    expect(marker).toBeInTheDocument();
  });

  it("does not render a last-move marker when lastMove is null", () => {
    const board = boardWithStone(9, 4, 4, "B");
    const { container } = render(
      <GoBoard
        board={board}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
        lastMove={null}
      />,
    );
    expect(
      container.querySelector('[data-testid="last-move-marker"]'),
    ).not.toBeInTheDocument();
  });

  it("does not render a last-move marker when the intersection is empty", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
        lastMove={{ x: 4, y: 4 }}
      />,
    );
    expect(
      container.querySelector('[data-testid="last-move-marker"]'),
    ).not.toBeInTheDocument();
  });

  it("uses a light marker colour for a black stone's last-move dot", () => {
    const board = boardWithStone(9, 4, 4, "B");
    const { container } = render(
      <GoBoard
        board={board}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
        lastMove={{ x: 4, y: 4 }}
      />,
    );
    const marker = container.querySelector(
      '[data-testid="last-move-marker"]',
    );
    expect(marker).toHaveAttribute("fill", "#f5f5f0");
  });

  it("uses a dark marker colour for a white stone's last-move dot", () => {
    const board = boardWithStone(9, 4, 4, "W");
    const { container } = render(
      <GoBoard
        board={board}
        boardSize={9}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
        lastMove={{ x: 4, y: 4 }}
      />,
    );
    const marker = container.querySelector(
      '[data-testid="last-move-marker"]',
    );
    expect(marker).toHaveAttribute("fill", "#1a1a1a");
  });

  // ── Cursor style ────────────────────────────────────────────────────────

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

  // ── Interaction guards ──────────────────────────────────────────────────

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

  it("does not show an illegal flash when interactive=false", () => {
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
    fireEvent.click(svg, { clientX: 100, clientY: 100 });
    const flash = container.querySelector(
      'circle[fill="rgba(163,52,47,0.45)"]',
    );
    expect(flash).not.toBeInTheDocument();
  });

  // ── Legal-move click handling ───────────────────────────────────────────

  it("calls onIntersectionClick when clicking a legal intersection", () => {
    const onClick = jest.fn();
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[{ x: 4, y: 4 }]}
        interactive={true}
        onIntersectionClick={onClick}
      />,
    );
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = mockRect;

    const c = cell(9);
    fireEvent.click(svg, {
      clientX: PADDING + 4 * c,
      clientY: PADDING + 4 * c,
    });

    expect(onClick).toHaveBeenCalledWith(4, 4);
  });

  it("does not call onIntersectionClick when clicking an illegal intersection", () => {
    const onClick = jest.fn();
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[{ x: 4, y: 4 }]}
        interactive={true}
        onIntersectionClick={onClick}
      />,
    );
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = mockRect;

    // Click at (5, 5) which is NOT in legalMoves
    const c = cell(9);
    fireEvent.click(svg, {
      clientX: PADDING + 5 * c,
      clientY: PADDING + 5 * c,
    });

    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not throw when clicking while interactive=true (coords map to null in jsdom without mock)", () => {
    const onClick = jest.fn();
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[{ x: 4, y: 4 }]}
        interactive={true}
        onIntersectionClick={onClick}
      />,
    );
    const svg = container.querySelector("svg")!;
    // No getBoundingClientRect mock → coords map to null → no-op
    expect(() => {
      fireEvent.click(svg, { clientX: 250, clientY: 250 });
    }).not.toThrow();
  });

  // ── Illegal-move flash ──────────────────────────────────────────────────

  it("shows an illegal flash circle when clicking an illegal intersection while interactive", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={true}
        onIntersectionClick={noop}
      />,
    );
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = mockRect;

    const c = cell(9);
    fireEvent.click(svg, {
      clientX: PADDING + 4 * c,
      clientY: PADDING + 4 * c,
    });

    const flash = container.querySelector(
      'circle[fill="rgba(163,52,47,0.45)"]',
    );
    expect(flash).toBeInTheDocument();
  });

  it("does not show an illegal flash when clicking a legal intersection", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[{ x: 4, y: 4 }]}
        interactive={true}
        onIntersectionClick={noop}
      />,
    );
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = mockRect;

    const c = cell(9);
    fireEvent.click(svg, {
      clientX: PADDING + 4 * c,
      clientY: PADDING + 4 * c,
    });

    const flash = container.querySelector(
      'circle[fill="rgba(163,52,47,0.45)"]',
    );
    expect(flash).not.toBeInTheDocument();
  });

  it("clears the illegal flash after the timeout", () => {
    jest.useFakeTimers();

    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={true}
        onIntersectionClick={noop}
      />,
    );
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = mockRect;

    const c = cell(9);
    fireEvent.click(svg, {
      clientX: PADDING + 4 * c,
      clientY: PADDING + 4 * c,
    });

    // Flash should be visible immediately after click
    expect(
      container.querySelector('circle[fill="rgba(163,52,47,0.45)"]'),
    ).toBeInTheDocument();

    // Advance timers past the 400 ms flash duration
    act(() => {
      jest.advanceTimersByTime(500);
    });

    // Flash should have been cleared
    expect(
      container.querySelector('circle[fill="rgba(163,52,47,0.45)"]'),
    ).not.toBeInTheDocument();

    jest.useRealTimers();
  });

  // ── Ghost stone hover ───────────────────────────────────────────────────

  it("shows a ghost stone when hovering over a legal intersection", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[{ x: 3, y: 3 }]}
        interactive={true}
        onIntersectionClick={noop}
      />,
    );
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = mockRect;

    const c = cell(9);
    fireEvent.mouseMove(svg, {
      clientX: PADDING + 3 * c,
      clientY: PADDING + 3 * c,
    });

    const ghost = container.querySelector(
      'circle[fill="rgba(26,26,26,0.25)"]',
    );
    expect(ghost).toBeInTheDocument();
  });

  it("does not show a ghost stone when hovering over an illegal intersection", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[{ x: 3, y: 3 }]}
        interactive={true}
        onIntersectionClick={noop}
      />,
    );
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = mockRect;

    // Hover over (5, 5) which is NOT in legalMoves
    const c = cell(9);
    fireEvent.mouseMove(svg, {
      clientX: PADDING + 5 * c,
      clientY: PADDING + 5 * c,
    });

    const ghost = container.querySelector(
      'circle[fill="rgba(26,26,26,0.25)"]',
    );
    expect(ghost).not.toBeInTheDocument();
  });

  it("clears the ghost stone on mouseLeave", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[{ x: 3, y: 3 }]}
        interactive={true}
        onIntersectionClick={noop}
      />,
    );
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = mockRect;

    const c = cell(9);
    // First hover to show ghost
    fireEvent.mouseMove(svg, {
      clientX: PADDING + 3 * c,
      clientY: PADDING + 3 * c,
    });
    expect(
      container.querySelector('circle[fill="rgba(26,26,26,0.25)"]'),
    ).toBeInTheDocument();

    // Then leave to clear it
    fireEvent.mouseLeave(svg);
    expect(
      container.querySelector('circle[fill="rgba(26,26,26,0.25)"]'),
    ).not.toBeInTheDocument();
  });

  it("does not show a ghost stone when interactive=false", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[{ x: 3, y: 3 }]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = mockRect;

    const c = cell(9);
    fireEvent.mouseMove(svg, {
      clientX: PADDING + 3 * c,
      clientY: PADDING + 3 * c,
    });

    const ghost = container.querySelector(
      'circle[fill="rgba(26,26,26,0.25)"]',
    );
    expect(ghost).not.toBeInTheDocument();
  });

  // ── Touch event handling ────────────────────────────────────────────────

  it("calls onIntersectionClick on touchend over a legal intersection", () => {
    const onClick = jest.fn();
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[{ x: 2, y: 2 }]}
        interactive={true}
        onIntersectionClick={onClick}
      />,
    );
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = mockRect;

    const c = cell(9);
    fireEvent.touchEnd(svg, {
      changedTouches: [
        { clientX: PADDING + 2 * c, clientY: PADDING + 2 * c },
      ],
    });

    expect(onClick).toHaveBeenCalledWith(2, 2);
  });

  it("does not call onIntersectionClick on touchend when interactive=false", () => {
    const onClick = jest.fn();
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[{ x: 2, y: 2 }]}
        interactive={false}
        onIntersectionClick={onClick}
      />,
    );
    const svg = container.querySelector("svg")!;
    fireEvent.touchEnd(svg, {
      changedTouches: [{ clientX: 100, clientY: 100 }],
    });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows an illegal flash on touchend over an illegal intersection", () => {
    const { container } = render(
      <GoBoard
        board={emptyBoard(9)}
        boardSize={9}
        legalMoves={[]}
        interactive={true}
        onIntersectionClick={noop}
      />,
    );
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = mockRect;

    const c = cell(9);
    fireEvent.touchEnd(svg, {
      changedTouches: [
        { clientX: PADDING + 4 * c, clientY: PADDING + 4 * c },
      ],
    });

    const flash = container.querySelector(
      'circle[fill="rgba(163,52,47,0.45)"]',
    );
    expect(flash).toBeInTheDocument();
  });

  // ── Board size variants ─────────────────────────────────────────────────

  it("renders correct column labels for a 13x13 board (A through N, skipping I)", () => {
    render(
      <GoBoard
        board={emptyBoard(13)}
        boardSize={13}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    // Column N is the 13th column (A B C D E F G H J K L M N)
    const nLabels = screen.getAllByText("N");
    expect(nLabels.length).toBe(2);
    // Column I should be absent (skipped in Go notation)
    const iLabels = screen.queryAllByText("I");
    expect(iLabels.length).toBe(0);
  });

  it("renders row label 13 for the top row of a 13x13 board", () => {
    render(
      <GoBoard
        board={emptyBoard(13)}
        boardSize={13}
        legalMoves={[]}
        interactive={false}
        onIntersectionClick={noop}
      />,
    );
    const thirteenLabels = screen.getAllByText("13");
    expect(thirteenLabels.length).toBe(2);
  });
});
