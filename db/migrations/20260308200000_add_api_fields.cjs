/**
 * Migration: add API fields
 *
 * - games.ai_level        – difficulty level for the AI ('entry'|'medium'|'hard')
 * - games.pending_action  – action_id of the in-flight human action, if any
 * - games.ai_status       – current AI processing status ('idle'|'thinking'|'retrying'|'done'|'error')
 * - games.score_detail    – JSON blob with final scoring breakdown (set when game finishes)
 * - moves.rationale       – optional short AI rationale text (AI moves only)
 */
exports.up = function (knex) {
  return knex.schema
    .alterTable("games", function (table) {
      table.string("ai_level").notNullable().defaultTo("medium");
      table.string("pending_action").nullable();
      table.string("ai_status").notNullable().defaultTo("idle");
      table.text("score_detail").nullable();
    })
    .alterTable("moves", function (table) {
      table.string("rationale").nullable();
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable("games", function (table) {
      table.dropColumn("ai_level");
      table.dropColumn("pending_action");
      table.dropColumn("ai_status");
      table.dropColumn("score_detail");
    })
    .alterTable("moves", function (table) {
      table.dropColumn("rationale");
    });
};
