#!/usr/bin/env bash
# Dumps TheDailyStalk's database. Run nightly by the stalk-backup systemd timer that
# scripts/deploy.sh installs. Keeps 14 days of dumps in <dir>/backups.
#
#   scripts/backup-db.sh ~/thedailystalk
#
# Restore one with:
#   docker compose -f app/compose.yaml --env-file .env exec -T db \
#     pg_restore -U stalk -d stalk --clean --if-exists < backups/stalk-YYYY-MM-DD.dump
# Photos aren't in the dump; they're files in <dir>/data/images.
set -euo pipefail

DIR="${1:?usage: backup-db.sh /path/to/thedailystalk}"
mkdir -p "$DIR/backups"
out="$DIR/backups/stalk-$(date +%F).dump"

docker compose -f "$DIR/app/compose.yaml" --env-file "$DIR/.env" exec -T db \
  pg_dump -U stalk -d stalk --format=custom > "$out.tmp"
mv "$out.tmp" "$out"
chown --reference="$DIR" "$out"
find "$DIR/backups" -name 'stalk-*.dump' -mtime +14 -delete
echo "Saved $out ($(du -h "$out" | cut -f1))"
