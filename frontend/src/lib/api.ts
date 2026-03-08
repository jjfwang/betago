/**
 * BetaGo API client.
 *
 * Thin wrapper around `fetch` that provides typed helpers for every backend
 * endpoint.  All requests go to `/api/*` which is proxied to the backend
 * server via the Next.js `rewrites` configuration in `next.config.ts`.
 */

import type {
  ActionRequest,
  ActionResponse,
  ApiError,
  CreateGameRequest,
  Game,
  GameResponse,
} from "@/types/game";

/** Base URL for API calls.  Empty string means same-origin (proxied). */
const API_BASE = "";

class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly currentTurnVersion?: number,
  ) {
    super(code);
    this.name = "ApiClientError";
  }
}

/**
 * Generic JSON fetch helper.
 *
 * Throws `ApiClientError` on non-2xx responses so callers can distinguish
 * network errors from domain errors.
 */
async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!response.ok) {
    let errorBody: ApiError = { error: `http_${response.status}` };
    try {
      errorBody = (await response.json()) as ApiError;
    } catch {
      // ignore parse errors; use the default error code
    }
    throw new ApiClientError(errorBody.error, errorBody.current_turn_version);
  }

  return response.json() as Promise<T>;
}

/**
 * Create or resume the session's active game.
 *
 * Returns HTTP 201 for a new game and HTTP 200 when reusing an existing one.
 * The caller does not need to distinguish these cases for normal game flow.
 */
export async function createOrResumeGame(
  opts: CreateGameRequest = {},
): Promise<Game> {
  const data = await apiFetch<GameResponse>("/api/games", {
    method: "POST",
    body: JSON.stringify(opts),
  });
  return data.game;
}

/**
 * Fetch the current state of a game by id.
 */
export async function fetchGame(gameId: string): Promise<Game> {
  const data = await apiFetch<GameResponse>(`/api/games/${gameId}`);
  return data.game;
}

/**
 * Submit a human action (place, pass, or resign).
 *
 * Returns the updated game state and whether the request was a duplicate
 * (idempotent replay).
 */
export async function submitAction(
  gameId: string,
  body: ActionRequest,
): Promise<ActionResponse> {
  return apiFetch<ActionResponse>(`/api/games/${gameId}/actions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Open a Server-Sent Events connection for real-time game state updates.
 *
 * @param gameId  The game to subscribe to.
 * @param onGame  Callback invoked on each `game` event.
 * @param onError Callback invoked when the connection fails.
 * @returns A cleanup function that closes the EventSource.
 */
export function openGameEventSource(
  gameId: string,
  onGame: (game: Game) => void,
  onError: (err: Event) => void,
): () => void {
  const es = new EventSource(`/api/games/${gameId}/events`);

  es.addEventListener("game", (event: MessageEvent) => {
    try {
      const game = JSON.parse(event.data as string) as Game;
      onGame(game);
    } catch {
      // Malformed event – ignore; the next event will correct state.
    }
  });

  es.onerror = onError;

  return () => es.close();
}

export { ApiClientError };
