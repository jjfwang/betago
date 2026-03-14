exports.up = function (knex) {
  return knex.schema
    .createTable("chess_games", function (table) {
      table.uuid("id").primary();
      table.uuid("session_id").references("id").inTable("sessions");
      table.string("status").notNullable();
      table.string("winner");
      table.integer("turn_version").notNullable();
      table.string("ai_level").notNullable().defaultTo("medium");
      table.string("pending_action").nullable();
      table.string("ai_status").notNullable().defaultTo("idle");
      table.text("result_detail").nullable();
      table.timestamp("ai_turn_locked_at").nullable();
      table.string("ai_turn_worker_id").nullable();
      table.timestamps(true, true);
    })
    .createTable("chess_moves", function (table) {
      table.uuid("id").primary();
      table.uuid("game_id").references("id").inTable("chess_games");
      table.integer("move_index").notNullable();
      table.string("player").notNullable();
      table.string("action").notNullable();
      table.string("from_square");
      table.string("to_square");
      table.string("promotion");
      table.string("piece");
      table.string("captured_piece");
      table.string("notation");
      table.string("board_fen").notNullable();
      table.string("rationale").nullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
    })
    .createTable("chess_action_requests", function (table) {
      table.uuid("id").primary();
      table.uuid("game_id").references("id").inTable("chess_games");
      table.string("action_id").notNullable().unique();
      table.integer("expected_turn_version").notNullable();
      table.string("status").notNullable();
      table.string("error_code");
      table.timestamp("created_at").defaultTo(knex.fn.now());
    })
    .createTable("chess_ai_turn_logs", function (table) {
      table.uuid("id").primary();
      table.uuid("game_id").references("id").inTable("chess_games");
      table.integer("move_index").notNullable();
      table.string("model");
      table.string("prompt_version");
      table.string("response_id");
      table.integer("retry_count").notNullable();
      table.boolean("fallback_used").notNullable();
      table.integer("latency_ms");
      table.string("external_error");
      table.string("status");
      table.string("error_code");
      table.timestamp("created_at").defaultTo(knex.fn.now());
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTable("chess_ai_turn_logs")
    .dropTable("chess_action_requests")
    .dropTable("chess_moves")
    .dropTable("chess_games");
};
