const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const ENV_PATH = path.join(ROOT_DIR, ".env");

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) {
    return;
  }

  const raw = fs.readFileSync(ENV_PATH, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const value = stripQuotes(trimmed.slice(eqIndex + 1).trim());
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    process.env[key] = value;
  }
}

loadEnvFile();

const DATABASE_PATH = process.env.DATABASE_PATH?.trim()
  ? path.resolve(ROOT_DIR, process.env.DATABASE_PATH.trim())
  : path.join(ROOT_DIR, "db.sqlite3");

const sharedConfig = {
  client: "sqlite3",
  connection: {
    filename: DATABASE_PATH,
  },
  useNullAsDefault: true,
  migrations: {
    directory: path.join(ROOT_DIR, "db/migrations"),
  },
};

module.exports = {
  development: sharedConfig,
  production: sharedConfig,
  test: sharedConfig,
};
