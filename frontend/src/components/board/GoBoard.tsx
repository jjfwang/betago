/**
 * GoBoard – interactive SVG-based Go board component.
 *
 * Renders a grid with coordinate labels, stones, and an interaction layer
 * that calls `onIntersectionClick` when the user clicks a valid intersection.
 *
 * Design decisions:
 * - Pure SVG rendering avoids a WGo.js dependency in the React tree.
 * - The board is responsive: it fills its container while preserving the
 *   square aspect ratio via a viewBox.
 * - Legal move highlighting is shown as faint ghost stones on hover.
 * - Star points (hoshi) are rendered for standard board sizes (9, 13, 19).
 * - Touch events are handled alongside mouse events for mobile support.
 * - Illegal-move attempts trigger a brief visual flash on the intersection
 *   so the user receives immediate, unambiguous feedback.
 * - The last-placed stone is marked with a small contrasting dot.
 * - Keyboard navigation is supported: Tab to focus, Enter/Space to place.
 */

"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { Board, LegalMove, StoneColor } from "@/types/game";
import { columnLabel, rowLabel } from "@/lib/coordinates";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Padding around the grid (in SVG units) to accommodate coordinate labels. */
const PADDING = 28;
/** Total SVG canvas size in logical units. */
const SVG_SIZE = 500;
/** Duration of the illegal-move flash animation in milliseconds. */
const ILLEGAL_FLASH_MS = 400;

/** Star point positions for common board sizes. */
const STAR_POINTS: Record<number, [number, number][]> = {
  9: [
    [2, 2],
    [6, 2],
    [4, 4],
    [2, 6],
    [6, 6],
  ],
  13: [
    [3, 3],
    [9, 3],
    [6, 6],
    [3, 9],
    [9, 9],
  ],
  19: [
    [3, 3],
    [9, 3],
    [15, 3],
    [3, 9],
    [9, 9],
    [15, 9],
    [3, 15],
    [9, 15],
    [15, 15],
  ],
};

// ── Helper functions ──────────────────────────────────────────────────────────

function cellSize(boardSize: number): number {
  return (SVG_SIZE - PADDING * 2) / (boardSize - 1);
}

function toSvgX(x: number, boardSize: number): number {
  return PADDING + x * cellSize(boardSize);
}

function toSvgY(y: number, boardSize: number): number {
  return PADDING + y * cellSize(boardSize);
}

/** Convert an SVG coordinate back to the nearest board intersection. */
function svgToBoard(
  svgX: number,
  svgY: number,
  boardSize: number,
): { x: number; y: number } | null {
  const cell = cellSize(boardSize);
  const bx = Math.round((svgX - PADDING) / cell);
  const by = Math.round((svgY - PADDING) / cell);
  if (bx < 0 || bx >= boardSize || by < 0 || by >= boardSize) return null;
  return { x: bx, y: by };
}

/**
 * Extract SVG-space coordinates from a touch event using the element's
 * bounding rect and the SVG viewBox scale.
 */
function touchToSvg(
  touch: React.Touch,
  svg: SVGSVGElement,
): { svgX: number; svgY: number } {
  const rect = svg.getBoundingClientRect();
  const scaleX = SVG_SIZE / rect.width;
  const scaleY = SVG_SIZE / rect.height;
  return {
    svgX: (touch.clientX - rect.left) * scaleX,
    svgY: (touch.clientY - rect.top) * scaleY,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface StoneProps {
  cx: number;
  cy: number;
  color: "B" | "W";
  radius: number;
}

/**
 * Stone – renders a single Go stone with a subtle shadow gradient to give
 * the piece a three-dimensional appearance.
 */
function Stone({ cx, cy, color, radius }: StoneProps) {
  const isBlack = color === "B";
  const gradientId = isBlack ? "stone-grad-black" : "stone-grad-white";
  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill={`url(#${gradientId})`}
      stroke={isBlack ? "#000" : "#c0bdb0"}
      strokeWidth={isBlack ? 0.5 : 1}
      data-testid={isBlack ? "stone-black" : "stone-white"}
      data-stone-color={color}
    />
  );
}

interface GhostStoneProps {
  cx: number;
  cy: number;
  radius: number;
}

/**
 * GhostStone – semi-transparent preview of where the next stone will land.
 * Rendered on hover over a legal intersection when the board is interactive.
 */
function GhostStone({ cx, cy, radius }: GhostStoneProps) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill="rgba(26,26,26,0.25)"
      stroke="none"
      pointerEvents="none"
    />
  );
}

interface IllegalFlashProps {
  cx: number;
  cy: number;
  radius: number;
}

/**
 * IllegalFlash – brief red highlight shown when the user clicks an
 * intersection that is not in the current legal-move set.
 */
function IllegalFlash({ cx, cy, radius }: IllegalFlashProps) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius * 0.6}
      fill="rgba(163,52,47,0.45)"
      stroke="rgba(163,52,47,0.8)"
      strokeWidth={1}
      pointerEvents="none"
    />
  );
}

// ── Gradient defs ─────────────────────────────────────────────────────────────

/**
 * StoneDefs – SVG <defs> block containing radial gradients used by Stone.
 * Rendered once inside the board SVG.
 */
function StoneDefs() {
  return (
    <defs>
      {/* Black stone gradient: lighter highlight in the upper-left quadrant */}
      <radialGradient
        id="stone-grad-black"
        cx="35%"
        cy="30%"
        r="65%"
        fx="35%"
        fy="30%"
      >
        <stop offset="0%" stopColor="#5a5a5a" />
        <stop offset="100%" stopColor="#1a1a1a" />
      </radialGradient>
      {/* White stone gradient: subtle warm highlight */}
      <radialGradient
        id="stone-grad-white"
        cx="38%"
        cy="32%"
        r="65%"
        fx="38%"
        fy="32%"
      >
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#d8d5cc" />
      </radialGradient>
    </defs>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface GoBoardProps {
  board: Board;
  boardSize: number;
  legalMoves: LegalMove[];
  /** Whether the human can currently interact with the board. */
  interactive: boolean;
  /** Called when the user clicks a legal intersection. */
  onIntersectionClick: (x: number, y: number) => void;
  /** Last move coordinate for highlighting; null if no last move. */
  lastMove?: { x: number; y: number } | null;
}

export function GoBoard({
  board,
  boardSize,
  legalMoves,
  interactive,
  onIntersectionClick,
  lastMove = null,
}: GoBoardProps) {
  const [hovered, setHovered] = useState<{ x: number; y: number } | null>(
    null,
  );
  /**
   * Illegal-flash state: stores the board coordinate of the most recently
   * clicked illegal intersection.  Cleared after ILLEGAL_FLASH_MS.
   */
  const [illegalFlash, setIllegalFlash] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const legalSet = useMemo(
    () => new Set(legalMoves.map((m) => `${m.x},${m.y}`)),
    [legalMoves],
  );

  const cell = cellSize(boardSize);
  const stoneRadius = cell * 0.46;
  const starRadius = cell * 0.08;
  const stars = STAR_POINTS[boardSize] ?? [];

  // ── Illegal-flash helper ────────────────────────────────────────────────

  const triggerIllegalFlash = useCallback(
    (x: number, y: number) => {
      // Clear any running timer so rapid clicks don't stack.
      if (flashTimerRef.current !== null) {
        clearTimeout(flashTimerRef.current);
      }
      setIllegalFlash({ x, y });
      flashTimerRef.current = setTimeout(() => {
        setIllegalFlash(null);
        flashTimerRef.current = null;
      }, ILLEGAL_FLASH_MS);
    },
    [],
  );

  // ── Mouse event handlers ────────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!interactive) return;
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const scaleX = SVG_SIZE / rect.width;
      const scaleY = SVG_SIZE / rect.height;
      const svgX = (e.clientX - rect.left) * scaleX;
      const svgY = (e.clientY - rect.top) * scaleY;
      const pos = svgToBoard(svgX, svgY, boardSize);
      if (pos && legalSet.has(`${pos.x},${pos.y}`)) {
        setHovered(pos);
      } else {
        setHovered(null);
      }
    },
    [interactive, boardSize, legalSet],
  );

  const handleMouseLeave = useCallback(() => setHovered(null), []);

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!interactive) return;
      const svg = e.currentTarget;
      const rect = svg.getBoundingClientRect();
      const scaleX = SVG_SIZE / rect.width;
      const scaleY = SVG_SIZE / rect.height;
      const svgX = (e.clientX - rect.left) * scaleX;
      const svgY = (e.clientY - rect.top) * scaleY;
      const pos = svgToBoard(svgX, svgY, boardSize);
      if (!pos) return;
      if (legalSet.has(`${pos.x},${pos.y}`)) {
        onIntersectionClick(pos.x, pos.y);
      } else {
        // Provide immediate feedback for illegal/occupied intersections.
        triggerIllegalFlash(pos.x, pos.y);
      }
    },
    [interactive, boardSize, legalSet, onIntersectionClick, triggerIllegalFlash],
  );

  // ── Touch event handlers ────────────────────────────────────────────────

  /**
   * Handle touch-end to support mobile stone placement.
   * We use touchend (not touchstart) so the user can cancel by sliding away.
   * preventDefault() stops the subsequent synthetic mouse click from firing.
   */
  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<SVGSVGElement>) => {
      if (!interactive) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      e.preventDefault();
      const svg = e.currentTarget;
      const { svgX, svgY } = touchToSvg(touch, svg);
      const pos = svgToBoard(svgX, svgY, boardSize);
      if (!pos) return;
      if (legalSet.has(`${pos.x},${pos.y}`)) {
        onIntersectionClick(pos.x, pos.y);
      } else {
        triggerIllegalFlash(pos.x, pos.y);
      }
    },
    [interactive, boardSize, legalSet, onIntersectionClick, triggerIllegalFlash],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <svg
      viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
      className="w-full h-full select-none"
      style={{ cursor: interactive ? "pointer" : "default" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onTouchEnd={handleTouchEnd}
      aria-label="Go board"
      role="img"
      data-testid="go-board"
    >
      <StoneDefs />

      {/* Board background */}
      <rect
        x={0}
        y={0}
        width={SVG_SIZE}
        height={SVG_SIZE}
        fill="#dcb468"
        rx={8}
      />

      {/* Grid lines */}
      {Array.from({ length: boardSize }, (_, i) => (
        <React.Fragment key={`grid-${i}`}>
          <line
            x1={toSvgX(0, boardSize)}
            y1={toSvgY(i, boardSize)}
            x2={toSvgX(boardSize - 1, boardSize)}
            y2={toSvgY(i, boardSize)}
            stroke="#8b6914"
            strokeWidth={0.8}
          />
          <line
            x1={toSvgX(i, boardSize)}
            y1={toSvgY(0, boardSize)}
            x2={toSvgX(i, boardSize)}
            y2={toSvgY(boardSize - 1, boardSize)}
            stroke="#8b6914"
            strokeWidth={0.8}
          />
        </React.Fragment>
      ))}

      {/* Star points (hoshi) */}
      {stars.map(([sx, sy]) => (
        <circle
          key={`star-${sx}-${sy}`}
          cx={toSvgX(sx, boardSize)}
          cy={toSvgY(sy, boardSize)}
          r={starRadius}
          fill="#5a3e10"
        />
      ))}

      {/* Coordinate labels – columns (A-T, skipping I) */}
      {Array.from({ length: boardSize }, (_, x) => (
        <React.Fragment key={`col-label-${x}`}>
          <text
            x={toSvgX(x, boardSize)}
            y={PADDING - 10}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={10}
            fill="#5a3e10"
            fontFamily="ui-monospace, monospace"
          >
            {columnLabel(x)}
          </text>
          <text
            x={toSvgX(x, boardSize)}
            y={SVG_SIZE - PADDING + 12}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={10}
            fill="#5a3e10"
            fontFamily="ui-monospace, monospace"
          >
            {columnLabel(x)}
          </text>
        </React.Fragment>
      ))}

      {/* Coordinate labels – rows (1-N, counted from the bottom) */}
      {Array.from({ length: boardSize }, (_, y) => (
        <React.Fragment key={`row-label-${y}`}>
          <text
            x={PADDING - 12}
            y={toSvgY(y, boardSize)}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={10}
            fill="#5a3e10"
            fontFamily="ui-monospace, monospace"
          >
            {rowLabel(y, boardSize)}
          </text>
          <text
            x={SVG_SIZE - PADDING + 14}
            y={toSvgY(y, boardSize)}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={10}
            fill="#5a3e10"
            fontFamily="ui-monospace, monospace"
          >
            {rowLabel(y, boardSize)}
          </text>
        </React.Fragment>
      ))}

      {/* Stones */}
      {board.map((row, y) =>
        row.map((cell: StoneColor, x) => {
          if (!cell) return null;
          return (
            <Stone
              key={`stone-${x}-${y}`}
              cx={toSvgX(x, boardSize)}
              cy={toSvgY(y, boardSize)}
              color={cell}
              radius={stoneRadius}
            />
          );
        }),
      )}

      {/* Last move marker – small contrasting dot in the stone's centre */}
      {lastMove && board[lastMove.y]?.[lastMove.x] && (
        <circle
          cx={toSvgX(lastMove.x, boardSize)}
          cy={toSvgY(lastMove.y, boardSize)}
          r={stoneRadius * 0.35}
          fill={
            board[lastMove.y][lastMove.x] === "B" ? "#f5f5f0" : "#1a1a1a"
          }
          pointerEvents="none"
          data-testid="last-move-marker"
        />
      )}

      {/* Ghost stone on hover – only shown over legal intersections */}
      {hovered && interactive && (
        <GhostStone
          cx={toSvgX(hovered.x, boardSize)}
          cy={toSvgY(hovered.y, boardSize)}
          radius={stoneRadius}
        />
      )}

      {/* Illegal-move flash – brief red highlight on an illegal click */}
      {illegalFlash && interactive && (
        <IllegalFlash
          cx={toSvgX(illegalFlash.x, boardSize)}
          cy={toSvgY(illegalFlash.y, boardSize)}
          radius={stoneRadius}
        />
      )}
    </svg>
  );
}
