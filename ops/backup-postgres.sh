#!/bin/sh
set -eu
: "${BACKUP_ENCRYPTION_PASSWORD:?BACKUP_ENCRYPTION_PASSWORD is required}"
backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
plain="$backup_dir/workbuddy-$stamp.sql.gz"
encrypted="$plain.enc"
docker compose exec -T postgres pg_dump -U workbuddy -d workbuddy | gzip -9 > "$plain"
openssl enc -aes-256-cbc -pbkdf2 -salt -in "$plain" -out "$encrypted" -pass env:BACKUP_ENCRYPTION_PASSWORD
rm -f "$plain"
find "$backup_dir" -type f -name 'workbuddy-*.sql.gz.enc' -mtime +30 -delete
printf '%s\n' "$encrypted"
