#!/bin/sh
# Applies migrations, seeds demo data when the database is empty (or every start with
# SEED_ON_START=true), then starts the server. Data persists across restarts by default.
set -eu

case "${DATABASE_URL:-}" in
  postgresql://* | postgres://*) ;;
  *) echo "DATABASE_URL must be a postgresql:// connection URL" >&2; exit 1 ;;
esac

if [ -z "${AUTH_SECRET:-}" ]; then
  echo "AUTH_SECRET is not set; refusing to start" >&2
  exit 1
fi

mkdir -p "${STORAGE_DIR:-/app/data/storage}"

echo "Waiting for the database"
node -e '
const { Client } = require("pg");
const deadline = Date.now() + 60_000;
(async function attempt() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await client.end();
  } catch (error) {
    if (Date.now() > deadline) { console.error("Database unreachable:", error.message); process.exit(1); }
    setTimeout(attempt, 2_000);
  }
})();
'

echo "Applying database migrations"
node node_modules/prisma/build/index.js migrate deploy

user_count=$(node -e '
const { Client } = require("pg");
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect()
  .then(() => client.query("SELECT COUNT(*)::int AS n FROM \"User\""))
  .then((result) => { console.log(String(result.rows[0].n)); return client.end(); })
  .catch((error) => { console.error(error.message); process.exit(1); });
')

if [ "${SEED_ON_START:-false}" = "true" ] || [ "$user_count" = "0" ]; then
  echo "Seeding demo data"
  node node_modules/tsx/dist/cli.mjs prisma/seed.ts
fi

exec "$@"
