#!/bin/sh
set -eu

PGHOST="${PGHOST:-db}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-guulingiinhan}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"

export PGHOST PGPORT PGUSER

DUMP_FILE="${1:-}"
if [ -z "$DUMP_FILE" ]; then
  if [ -f "${BACKUP_DIR%/}/LATEST" ]; then
    LATEST_NAME="$(tr -d '\r\n' < "${BACKUP_DIR%/}/LATEST")"
    DUMP_FILE="${BACKUP_DIR%/}/${LATEST_NAME}"
  else
    DUMP_FILE="$(ls -1t "${BACKUP_DIR%/}"/guulin_*.dump 2>/dev/null | head -n 1 || true)"
  fi
fi

if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Backup dump file not found in ${BACKUP_DIR}" >&2
  exit 1
fi

if [ -f "${DUMP_FILE}.sha256" ]; then
  (
    cd "$(dirname "$DUMP_FILE")"
    sha256sum -c "$(basename "$DUMP_FILE").sha256" >/dev/null
  )
fi

DRILL_DB="guulin_restore_drill_$(date -u +%Y%m%d%H%M%S)_$$"

cleanup() {
  psql -v ON_ERROR_STOP=0 --dbname=postgres --command="SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DRILL_DB}' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
  psql -v ON_ERROR_STOP=0 --dbname=postgres --command="DROP DATABASE IF EXISTS \"${DRILL_DB}\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql -v ON_ERROR_STOP=1 --dbname=postgres --command="CREATE DATABASE \"${DRILL_DB}\";" >/dev/null

pg_restore \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --dbname="$DRILL_DB" \
  "$DUMP_FILE"

ALEMBIC_REV="$(psql -v ON_ERROR_STOP=1 --dbname="$DRILL_DB" -t -A -c "
DO \$\$
DECLARE
  required_tables text[] := ARRAY[
    'alembic_version',
    'users',
    'families',
    'persons',
    'family_members',
    'parent_child_relationships',
    'marriages',
    'family_funds',
    'fund_expenses',
    'family_events',
    'chat_messages'
  ];
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY required_tables LOOP
    IF to_regclass('public.' || tbl) IS NULL THEN
      RAISE EXCEPTION 'Missing restored table: %', tbl;
    END IF;
  END LOOP;
END
\$\$;
SELECT version_num FROM alembic_version LIMIT 1;
" | tr -d '[:space:]')"

printf '{"event":"pg_restore_drill_passed","dump":"%s","alembic_revision":"%s"}\n' \
  "$(basename "$DUMP_FILE")" "$ALEMBIC_REV"
