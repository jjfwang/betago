/**
 * Domain types for the BetaGo game.
 *
 * These mirror the JSON shapes returned by the backend API so that the
 * frontend can be fully typed without duplicating business logic.
 */

/** Stone colour as used in the board matrix. */
export type StoneColor = "B" | "W" | null;

/** A two-dimensional board matrix: board[row][col] = StoneColor. */
export type Board = StoneColor[][];

/** Legal placement coordinate. */
export interface LegalMove {
  x: number;
  y: number;
}

/** A single move in the game history. */
export interface Move {
  /** Sequential index starting at 0. */
  move_index: number;
  /** Who made this move. */
  player: "human" | "ai";
  /** Type of action taken. */
  action: "place" | "pass" | "resign";
  /** Board coordinate for `place` actions; null otherwise. */
  coordinate: string | null;
  /** Number of opponent stones captured by this move. */
  captures: number;
  /** Zobrist-style board hash after this move. */
  board_hash: string;
  /** ISO-8601 timestamp. */
  created_at: string;
  /** Optional short AI rationale (AI moves only). */
  rationale?: string;
}

/** Capture counts per player. */
export interface Captures {
  B: number;
  W: number;
}

/** Overall game status. */
export type GameStatus = "human_turn" | "ai_thinking" | "finished";

/** Winner of a finished game. */
export type Winner = "B" | "W" | "draw" | null;

/** AI processing status. */
export type AiStatus = "idle" | "thinking" | "done" | "error" | null;

/** Full game state as returned by the backend. */
export interface Game {
  id: string;
  board_size: number;
  komi: number;
  ai_level: "entry" | "medium" | "hard";
  status: GameStatus;
  winner: Winner;
  /** Whose turn it is: "B" (human) or "W" (AI). */
  turn: "B" | "W";
  /** Monotonically increasing version counter; used for idempotency. */
  turn_version: number;
  /** Action id of the in-flight human action, if any. */
  pending_action: string | null;
  ai_status: AiStatus;
  captures: Captures;
  board: Board;
  legal_moves: LegalMove[];
  moves: Move[];
  move_count: number;
  /** True when the move list has been truncated to MAX_MOVES_IN_PAYLOAD. */
  moves_truncated: boolean;
  /** Latest AI rationale text (from the most recent AI move). */
  last_ai_rationale?: string | null;
}

/** Request body for POST /api/games. */
export interface CreateGameRequest {
  force_new?: boolean;
  ai_level?: "entry" | "medium" | "hard";
}

/** Request body for POST /api/games/:id/actions. */
export interface ActionRequest {
  action: "place" | "pass" | "resign";
  action_id: string;
  expected_turn_version: number;
  x?: number;
  y?: number;
}

/** Response from POST /api/games and GET /api/games/:id. */
export interface GameResponse {
  game: Game;
}

/** Response from POST /api/games/:id/actions. */
export interface ActionResponse {
  game: Game;
  idempotent: boolean;
}

/** Error response shape from the backend. */
export interface ApiError {
  error: string;
  current_turn_version?: number;
}
