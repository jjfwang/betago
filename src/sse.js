/**
 * @fileoverview Server-Sent Events (SSE) subscriber registry.
 *
 * This module manages a shared registry of SSE response objects, keyed by
 * game ID. It provides functions to subscribe, unsubscribe, and publish
 * game state updates to all connected clients.
 *
 * Separating this into its own module allows both the HTTP app (app.js) and
 * the background AI worker (worker.js) to publish SSE events without creating
 * circular import dependencies.
 */

/**
 * Map of gameId -> Set of SSE response objects.
 * @type {Map<string, Set<import('express').Response>>}
 */
const sseSubscribers = new Map();

/**
 * Subscribe a response object to SSE events for a game.
 * @param {string} gameId
 * @param {import('express').Response} res
 */
export function sseSubscribe(gameId, res) {
  if (!sseSubscribers.has(gameId)) {
    sseSubscribers.set(gameId, new Set());
  }
  sseSubscribers.get(gameId).add(res);
}

/**
 * Unsubscribe a response object from SSE events for a game.
 * @param {string} gameId
 * @param {import('express').Response} res
 */
export function sseUnsubscribe(gameId, res) {
  sseSubscribers.get(gameId)?.delete(res);
}

/**
 * Publish a game state update to all SSE subscribers for a game.
 * @param {string} gameId
 * @param {object} gamePayload
 */
export function ssePublish(gameId, gamePayload) {
  const subscribers = sseSubscribers.get(gameId);
  if (!subscribers || subscribers.size === 0) return;
  const payload = `data: ${JSON.stringify(gamePayload)}\n\n`;
  for (const res of subscribers) {
    try {
      res.write(`event: game\n${payload}`);
    } catch {
      subscribers.delete(res);
    }
  }
}
