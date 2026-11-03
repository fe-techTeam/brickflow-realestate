#!/bin/sh
# Applies migrations, seeds demo data on first start (or when SEED_ON_START=true), then starts the server.
set -eu

case "${DATABASE_URL:-}" in
  file:*) db_file="${DATABASE_URL#file:}" ;;
  *) echo "DATABASE_URL must be a SQLite file: URL" >&2; exit 1 ;;
esac

if [ -z "${AUTH_SECRET:-}" ]; then
  echo "AUTH_SECRET is not set; refusing to start" >&2
  exit 1
fi

mkdir -p "$(dirname "$db_file")" "${STORAGE_DIR:-/app/data/storage}"

echo "Applying database migrations"
node node_modules/prisma/build/index.js migrate deploy

user_count=$(node -e 'const Database = require("better-sqlite3"); const db = new Database(process.argv[1], { readonly: true }); console.log(String(db.prepare("SELECT COUNT(*) AS n FROM User").get().n)); db.close();' "$db_file")

if [ "${SEED_ON_START:-false}" = "true" ] || [ "$user_count" = "0" ]; then
  echo "Seeding demo data"
  node node_modules/tsx/dist/cli.mjs prisma/seed.ts
fi

exec "$@"
