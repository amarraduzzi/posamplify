#!/usr/bin/env bash
# Runs the database tests against a throwaway local Postgres (16+).
# Usage: npm run test:db
# With DATABASE_URL set, it uses that database instead (must be EMPTY, it
# gets the Supabase shim + all migrations applied).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${DATABASE_URL:-}" ]]; then
  PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  DATA="$(mktemp -d)"
  PORT="${PGPORT_TEST:-54329}"
  RUN=()
  if [[ "$(id -u)" == "0" ]]; then chown postgres "$DATA"; RUN=(runuser -u postgres --); fi
  "${RUN[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
  "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=localhost" -w -l "$DATA/log" start >/dev/null
  trap '"${RUN[@]}" "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
  export DATABASE_URL="postgres://postgres@localhost:$PORT/postgres"
fi

psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$f" || { echo "Migration failed: $f"; exit 1; }
done
echo "Migrations applied."
node --test --test-concurrency=1 "$ROOT"/supabase/tests/*.test.mjs
