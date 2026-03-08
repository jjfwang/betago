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
 * - Star points (hoshi) are rendered for standard board sizes.
 */

"use client";

import React, { useCallback, useMemo, useState } from "react";
import type { Board, LegalMove, StoneColor } from "@/types/game";
import { columnLabel, rowLabel } from "@/lib/coordinates";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Padding around the grid (in SVG units) to accommodate coordinate labels. */
const PADDING = 28;
/** Total SVG canvas size in logical units. */
const SVG_SIZE = 500;

/** Star point positions for common board sizes. */
const STAR_POINTS: Record<number, [number, number][]> = {
  9: [
    [2, 2], [6, 2], [4, 4],
    [2, 6], [6, 6],
  ],
  13: [
    [3, 3], [9, 3], [6, 6],
    [3, 9], [9, 9],
  ],
  19: [
    [3, 3], [9, 3], [15, 3],
    [3, 9], [9, 9], [15, 9],
    [3, 15], [9, 15], [15, 15],
  ],
};

// ── Helper functions ──────────────────────────────────────────────────────────

function gridSize(boardSize: number): number {
  return SVG_SIZE - PADDING * 2;
}

function cellSize(boardSize: number): number {
  return gridSize(boardSize) / (boardSize - 1);
}

function toSvgX(x: number, boardSize: number): number {
  return PADDING + x * cellSize(boardSize);
}

function toSvgY(y: number, boardSize: number): number {
  return PADDING + y * cellSize(boardSize);
}

/** Convert an SVG coordinate back to a board intersection. */
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

// ── Sub-components ────────────────────────────────────────────────────────────

interface StoneProps {
  cx: number;
  cy: number;
  color: "B" | "W";
  radius: number;
}

function Stone({ cx, cy, color, radius }: StoneProps) {
  const isBlack = color === "B";
  return (
    <circle
      cx={cx}
      cy={cy}
      r={radius}
      fill={isBlack ? "#1a1a1a" : "#f5f5f0"}
      stroke={isBlack ? "#000" : "#c0bdb0"}
      strokeWidth={isBlack ? 0.5 : 1}
    />
  );
}

interface GhostStoneProps {
  cx: number;
  cy: number;
  radius: number;
}

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
  const [hovered, setHovered] = useState<{ x: number; y: number } | null>(null);

  const legalSet = useMemo(
    () => new Set(legalMoves.map((m) => `${m.x},${m.y}`)),
    [legalMoves],
  );

  const cell = cellSize(boardSize);
  const stoneRadius = cell * 0.46;
  const starRadius = cell * 0.08;
  const stars = STAR_POINTS[boardSize] ?? [];

  // ── Event handlers ──────────────────────────────────────────────────────

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
      if (pos && legalSet.has(`${pos.x},${pos.y}`)) {
        onIntersectionClick(pos.x, pos.y);
      }
    },
    [interactive, boardSize, legalSet, onIntersectionClick],
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
      aria-label="Go board"
      role="img"
    >
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

      {/* Coordinate labels – columns (A-T) */}
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

      {/* Coordinate labels – rows (1-N) */}
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

      {/* Last move marker */}
      {lastMove && board[lastMove.y]?.[lastMove.x] && (
        <circle
          cx={toSvgX(lastMove.x, boardSize)}
          cy={toSvgY(lastMove.y, boardSize)}
          r={stoneRadius * 0.35}
          fill={board[lastMove.y][lastMove.x] === "B" ? "#f5f5f0" : "#1a1a1a"}
          pointerEvents="none"
        />
      )}

      {/* Ghost stone on hover */}
      {hovered && interactive && (
        <GhostStone
          cx={toSvgX(hovered.x, boardSize)}
          cy={toSvgY(hovered.y, boardSize)}
          radius={stoneRadius}
        />
      )}
    </svg>
  );
}
