#!/bin/sh
set -eu

PGHOST="${PGHOST:-db}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-guulingiinhan}"
PGDATABASE="${PGDATABASE:-guulingiinhan}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

export PGHOST PGPORT PGUSER

mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="guulin_${STAMP}.dump"
FINAL_FILE="${BACKUP_DIR%/}/${BASENAME}"
TMP_FILE="${FINAL_FILE}.tmp.$$"

cleanup() {
  rm -f "$TMP_FILE"
}
trap cleanup EXIT

pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file="$TMP_FILE" \
  "$PGDATABASE"

pg_restore --list "$TMP_FILE" >/dev/null
mv "$TMP_FILE" "$FINAL_FILE"

(
  cd "$BACKUP_DIR"
  sha256sum "$BASENAME" > "${BASENAME}.sha256"
)
printf '%s\n' "$BASENAME" > "${BACKUP_DIR%/}/LATEST"

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'guulin_*.dump' -o -name 'guulin_*.dump.sha256' \) \
  -mtime +"$BACKUP_RETENTION_DAYS" -delete

SIZE_BYTES="$(wc -c < "$FINAL_FILE" | tr -d ' ')"
printf '{"event":"pg_backup_completed","file":"%s","bytes":%s,"retention_days":%s}\n' \
  "$BASENAME" "$SIZE_BYTES" "$BACKUP_RETENTION_DAYS"
