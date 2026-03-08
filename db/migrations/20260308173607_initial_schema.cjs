exports.up = function(knex) {
  return knex.schema
    .createTable("sessions", function (table) {
      table.uuid("id").primary();
      table.string("client_fingerprint");
      table.timestamps(true, true);
    })
    .createTable("games", function (table) {
      table.uuid("id").primary();
      table.uuid("session_id").references("id").inTable("sessions");
      table.integer("board_size").notNullable();
      table.float("komi").notNullable();
      table.string("status").notNullable();
      table.string("winner");
      table.integer("turn_version").notNullable();
      table.timestamps(true, true);
    })
    .createTable("moves", function (table) {
      table.uuid("id").primary();
      table.uuid("game_id").references("id").inTable("games");
      table.integer("move_index").notNullable();
      table.string("player").notNullable();
      table.string("action").notNullable();
      table.string("coordinate");
      table.integer("captures").notNullable();
      table.string("board_hash").notNullable();
      table.timestamp("created_at").defaultTo(knex.fn.now());
    })
    .createTable("action_requests", function (table) {
      table.uuid("id").primary();
      table.uuid("game_id").references("id").inTable("games");
      table.string("action_id").notNullable().unique();
      table.integer("expected_turn_version").notNullable();
      table.string("status").notNullable();
      table.string("error_code");
      table.timestamp("created_at").defaultTo(knex.fn.now());
    })
    .createTable("ai_turn_logs", function (table) {
      table.uuid("id").primary();
      table.uuid("game_id").references("id").inTable("games");
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

exports.down = function(knex) {
  return knex.schema
    .dropTable("ai_turn_logs")
    .dropTable("action_requests")
    .dropTable("moves")
    .dropTable("games")
    .dropTable("sessions");
};
