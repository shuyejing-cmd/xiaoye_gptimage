#!/bin/sh
set -eu
: "${BACKUP_ENCRYPTION_PASSWORD:?BACKUP_ENCRYPTION_PASSWORD is required}"
backup_file="${1:?usage: restore-drill.sh backup.sql.gz.enc}"
drill_db="workbuddy_restore_drill"
plain="$(mktemp)"
trap 'rm -f "$plain"' EXIT
openssl enc -d -aes-256-cbc -pbkdf2 -in "$backup_file" -out "$plain" -pass env:BACKUP_ENCRYPTION_PASSWORD
docker compose exec -T postgres dropdb -U workbuddy --if-exists "$drill_db"
docker compose exec -T postgres createdb -U workbuddy "$drill_db"
gzip -dc "$plain" | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U workbuddy -d "$drill_db"
schema_version="$(docker compose exec -T postgres psql -At -v ON_ERROR_STOP=1 -U workbuddy -d "$drill_db" -c 'select max(version) from schema_migrations')"
if [ "$schema_version" -ge 8 ]; then
  wallet_check='select count(*) from wallets where available_points < 0 or held_points < 0;'
else
  wallet_check='select count(*) from wallets where available_credits < 0 or held_credits < 0;'
fi
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U workbuddy -d "$drill_db" -c "$wallet_check"
docker compose exec -T postgres dropdb -U workbuddy "$drill_db"
