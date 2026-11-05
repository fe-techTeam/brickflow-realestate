#!/bin/sh
# Nightly logical backup for docker-compose.prod.yml. Writes a pg_dump (custom format) into
# /backups every day at BACKUP_HOUR_UTC and deletes dumps older than BACKUP_RETENTION_DAYS.
# Connection settings come from the standard PGHOST/PGUSER/PGPASSWORD/PGDATABASE variables.
#
#   pg-backup.sh          run on schedule (container entrypoint)
#   pg-backup.sh --now    take one backup immediately and exit
set -eu

BACKUP_DIR=/backups
BACKUP_HOUR_UTC=${BACKUP_HOUR_UTC:-21}
BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-14}

backup() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  partial="$BACKUP_DIR/.brickflow-$stamp.dump.partial"
  if pg_dump --format=custom --no-owner --no-privileges --file="$partial"; then
    mv "$partial" "$BACKUP_DIR/brickflow-$stamp.dump"
    echo "$(date -u +%FT%TZ) backup written: brickflow-$stamp.dump"
  else
    rm -f "$partial"
    echo "$(date -u +%FT%TZ) backup FAILED" >&2
    return 1
  fi
  # -mtime +N matches files at least N+1 days old.
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'brickflow-*.dump' -mtime +"$((BACKUP_RETENTION_DAYS - 1))" -print -delete
}

seconds_until_next_run() {
  now=$(date -u +%s)
  target=$(date -u -d "$(date -u +%Y-%m-%d) $(printf '%02d' "$BACKUP_HOUR_UTC"):00:00" +%s)
  [ "$target" -gt "$now" ] || target=$((target + 86400))
  echo $((target - now))
}

mkdir -p "$BACKUP_DIR"

if [ "${1:-}" = "--now" ]; then
  backup
  exit
fi

echo "Daily backups at $(printf '%02d' "$BACKUP_HOUR_UTC"):00 UTC, keeping $BACKUP_RETENTION_DAYS days"
while :; do
  sleep "$(seconds_until_next_run)"
  backup || true
done
