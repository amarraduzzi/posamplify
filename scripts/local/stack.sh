#!/usr/bin/env bash
# Full local Supabase-like stack for testing the till (logins included):
#   Postgres :54332 + real Supabase Auth (GoTrue) :9999 + PostgREST :3000
#   + a small gateway on :54331 that routes /auth/v1 and /rest/v1 like Supabase.
# Needs the postgrest and auth binaries in $BIN (default ~/bin, from GitHub releases).
#   bash scripts/local/stack.sh start | stop | reset
# Prints the URL and anon key to use as VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${BIN:-$HOME/bin}"
DATA="$ROOT/.localstack"
PORT=54332
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
RUN=(); [[ "$(id -u)" == "0" ]] && RUN=(runuser -u postgres --)
SUPER="postgres://postgres@localhost:$PORT/postgres"
SECRET="local-dev-jwt-secret-at-least-32-characters-long"

start_pg() {
  "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DATA/pg" -o "-p $PORT -k $DATA/pg -c listen_addresses=localhost -c timezone=UTC" -w -l "$DATA/pg/server.log" start >/dev/null
}

start_services() {
  cd "$BIN"
  GOTRUE_DB_DRIVER=postgres \
  DATABASE_URL="postgres://supabase_auth_admin:authpw@localhost:$PORT/postgres?search_path=auth" \
  GOTRUE_DB_MIGRATIONS_PATH="$BIN/migrations" \
  GOTRUE_JWT_SECRET="$SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
  API_EXTERNAL_URL=http://localhost:54331/auth/v1 GOTRUE_SITE_URL=http://localhost:5174 \
  GOTRUE_API_HOST=127.0.0.1 PORT=9999 GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  GOTRUE_DISABLE_SIGNUP=false GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=true GOTRUE_LOG_LEVEL=warn \
    sh -c './auth migrate >> "$0/auth.log" 2>&1 && exec ./auth serve >> "$0/auth.log" 2>&1' "$DATA" &
  echo $! > "$DATA/auth.pid"
  for i in $(seq 1 30); do curl -sf localhost:9999/health >/dev/null && break; sleep 0.5; done
}

start_rest() {
  PGRST_DB_URI="postgres://authenticator:authpw@localhost:$PORT/postgres" \
  PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$SECRET" \
  PGRST_SERVER_PORT=3000 PGRST_DB_EXTRA_SEARCH_PATH=public,extensions PGRST_LOG_LEVEL=warn \
    nohup "$BIN/postgrest" > "$DATA/rest.log" 2>&1 &
  echo $! > "$DATA/rest.pid"
  nohup node "$ROOT/scripts/local/gateway.mjs" > "$DATA/gateway.log" 2>&1 &
  echo $! > "$DATA/gateway.pid"
  sleep 1
}

case "${1:-start}" in
  start)
    if [[ ! -d "$DATA/pg" ]]; then
      mkdir -p "$DATA/pg"; [[ "$(id -u)" == "0" ]] && chown postgres "$DATA/pg"
      "${RUN[@]}" "$PGBIN/initdb" -D "$DATA/pg" -U postgres -A trust >/dev/null
      start_pg
      psql "$SUPER" -q -v ON_ERROR_STOP=1 <<SQL
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'authpw';
grant anon, authenticated, service_role to authenticator;
create role supabase_auth_admin login superuser password 'authpw';
create schema auth authorization supabase_auth_admin;
create schema extensions;
grant usage on schema auth, extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL
      start_services   # runs the Auth migrations (creates auth.users, auth.uid(), ...)
      psql "$SUPER" -q -c "grant execute on all functions in schema auth to anon, authenticated, service_role; grant select on auth.users to service_role;"
      for f in "$ROOT"/supabase/migrations/*.sql; do psql "$SUPER" -q -v ON_ERROR_STOP=1 -f "$f"; done
      psql "$SUPER" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seed.sql"
    else
      start_pg; start_services
    fi
    start_rest
    ANON=$(node -e "
      const c=require('crypto'),b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
      const h=b({alg:'HS256',typ:'JWT'}),p=b({role:'anon',iss:'local',exp:2000000000});
      console.log(h+'.'+p+'.'+c.createHmac('sha256','$SECRET').update(h+'.'+p).digest('base64url'))")
    echo "$ANON" > "$DATA/anon.key"
    echo "VITE_SUPABASE_URL=http://localhost:54331"
    echo "VITE_SUPABASE_ANON_KEY=$ANON"
    ;;
  stop)
    for p in gateway rest auth; do [[ -f "$DATA/$p.pid" ]] && kill "$(cat "$DATA/$p.pid")" 2>/dev/null || true; done
    "${RUN[@]}" "$PGBIN/pg_ctl" -D "$DATA/pg" -m fast stop >/dev/null || true
    ;;
  reset) bash "$0" stop; rm -rf "$DATA"; bash "$0" start ;;
esac
