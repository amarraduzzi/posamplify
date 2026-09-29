#!/usr/bin/env bash
# Local throwaway database for UI testing without a Supabase project:
#   bash scripts/local/db.sh start   -> Postgres on :54322 with migrations + seed
#   bash scripts/local/db.sh stop
# (With the Supabase CLI and Docker you can use `supabase start` instead.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="$ROOT/.localdb"
PORT=54322
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
RUN=(); [[ "$(id -u)" == "0" ]] && RUN=(runuser -u postgres --)
URL="postgres://postgres@localhost:$PORT/postgres"

case "${1:-start}" in
  start)
    if [[ ! -d "$DATA" ]]; then
      mkdir -p "$DATA"; [[ "$(id -u)" == "0" ]] && chown postgres "$DATA"
      "${RUN[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
      "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=localhost" -w -l "$DATA/log" start >/dev/null
      psql "$URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/supabase_shim.sql"
      for f in "$ROOT"/supabase/migrations/*.sql; do psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f"; done
      psql "$URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seed.sql"
    else
      "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=localhost" -w -l "$DATA/log" start >/dev/null || true
    fi
    echo "Database: $URL"
    ;;
  stop) "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DATA" -m fast stop ;;
  reset) "$0" stop || true; rm -rf "$DATA"; "$0" start ;;
esac
