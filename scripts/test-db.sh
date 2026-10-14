#!/usr/bin/env bash
# Applies the Supabase migrations to a throwaway local Postgres and runs the
# row-level security checks. Needs Postgres 15+ binaries (initdb, pg_ctl,
# psql) on PATH or in PG_BIN; no Docker or Supabase CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

if [ -z "${PG_BIN:-}" ]; then
  if command -v initdb >/dev/null; then
    PG_BIN="$(dirname "$(command -v initdb)")"
  else
    PG_BIN="$(ls -d /opt/homebrew/opt/postgresql@*/bin /usr/local/opt/postgresql@*/bin 2>/dev/null | sort -V | tail -1 || true)"
  fi
fi
if [ -z "$PG_BIN" ] || [ ! -x "$PG_BIN/initdb" ]; then
  echo "Postgres binaries not found. Install Postgres (brew install postgresql@17) or set PG_BIN." >&2
  exit 1
fi

DIR="$(mktemp -d)"
PORT="${PG_PORT:-54329}"
cleanup() {
  "$PG_BIN/pg_ctl" -D "$DIR/data" stop -m fast >/dev/null 2>&1 || true
  rm -rf "$DIR"
}
trap cleanup EXIT

"$PG_BIN/initdb" -D "$DIR/data" -U postgres -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$DIR/data" -l "$DIR/pg.log" -w \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start >/dev/null

psql() { "$PG_BIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }

psql -f "$ROOT/supabase/tests/auth_stub.sql"
for m in "$ROOT"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$m")"
  psql -f "$m"
done
psql -f "$ROOT/supabase/tests/rls_test.sql" 2>&1 | sed -n 's/^.*NOTICE:  /  /p'
echo "Database checks passed."
