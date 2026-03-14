#!/bin/sh
set -eu

db_path="${DATABASE_PATH:-/app/data/db.sqlite3}"
mkdir -p "$(dirname "$db_path")"

npm run migrate
exec npm start
