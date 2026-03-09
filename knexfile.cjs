const path = require("path");

const ROOT_DIR = __dirname;

module.exports = {
  development: {
    client: "sqlite3",
    connection: {
      filename: path.join(ROOT_DIR, "db.sqlite3"),
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(ROOT_DIR, "db/migrations"),
    },
  },
};
