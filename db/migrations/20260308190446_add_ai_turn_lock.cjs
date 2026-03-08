/**
 * @migration add_ai_turn_lock
 *
 * Adds distributed locking columns to the `games` table to prevent
 * multiple worker processes from processing the same AI turn concurrently.
 *
 * - `ai_turn_locked_at`: Timestamp when the lock was acquired. Null means
 *   the game is not currently being processed. Used to detect and recover
 *   from stale locks (worker crash).
 *
 * - `ai_turn_worker_id`: UUID of the worker that holds the lock. Used to
 *   ensure only the owning worker can release the lock.
 */

exports.up = function (knex) {
  return knex.schema.alterTable("games", function (table) {
    table.timestamp("ai_turn_locked_at").nullable();
    table.string("ai_turn_worker_id").nullable();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable("games", function (table) {
    table.dropColumn("ai_turn_locked_at");
    table.dropColumn("ai_turn_worker_id");
  });
};
