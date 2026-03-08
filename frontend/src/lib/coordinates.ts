/**
 * Coordinate utilities for the Go board.
 *
 * Go uses a column letter (A-T, skipping I) and a row number counted from
 * the bottom of the board.  These helpers convert between the (x, y) integer
 * representation used by the backend and the human-readable label.
 */

/** Column letters used in Go notation (I is skipped). */
const COLUMN_LETTERS = "ABCDEFGHJKLMNOPQRST";

/**
 * Convert a zero-based (x, y) coordinate to a Go label such as "D4".
 *
 * @param x         Zero-based column index (left = 0).
 * @param y         Zero-based row index (top = 0).
 * @param boardSize Board dimension (e.g. 9 or 19).
 */
export function coordToLabel(x: number, y: number, boardSize: number): string {
  const letter = COLUMN_LETTERS[x] ?? "?";
  const number = boardSize - y;
  return `${letter}${number}`;
}

/**
 * Convert a Go label (e.g. "D4") back to zero-based (x, y) integers.
 *
 * Returns `null` if the label cannot be parsed.
 */
export function labelToCoord(
  label: string,
  boardSize: number,
): { x: number; y: number } | null {
  if (!label || label.length < 2) return null;
  const letter = label[0].toUpperCase();
  const x = COLUMN_LETTERS.indexOf(letter);
  if (x === -1) return null;
  const number = parseInt(label.slice(1), 10);
  if (isNaN(number)) return null;
  const y = boardSize - number;
  if (y < 0 || y >= boardSize) return null;
  return { x, y };
}

/**
 * Return the column letter for a zero-based column index.
 */
export function columnLabel(x: number): string {
  return COLUMN_LETTERS[x] ?? "?";
}

/**
 * Return the row number label for a zero-based row index.
 */
export function rowLabel(y: number, boardSize: number): number {
  return boardSize - y;
}
