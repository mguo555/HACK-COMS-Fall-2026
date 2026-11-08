#!/usr/bin/env bash
# Deploys the committed code to a server with Docker Compose (see compose.yaml): Postgres, the
# site, and the Cloudflare Tunnel connector when ~/thedailystalk/tunnel.env exists.
#
#   scripts/deploy.sh user@host [port]        (port defaults to 5001, reachable only on the server)
#
# On the server, everything lives in ~/thedailystalk:
#   app/        the code (replaced on every deploy)
#   data/       uploaded photos
#   postgres/   the database files
#   backups/    nightly database dumps, 14 days kept (stalk-backup.timer)
#   .env        settings (see .env.example). POSTGRES_PASSWORD is generated on first deploy.
#   tunnel.env  TUNNEL_TOKEN=... for the Cloudflare Tunnel (optional)
# Only committed code is sent, so commit first.
set -euo pipefail

HOST="${1:?usage: scripts/deploy.sh user@host [port]}"
PORT="${2:-5001}"

if [ -n "$(git status --porcelain)" ]; then
  echo "You have uncommitted changes. Commit them first; only committed code is deployed."
  exit 1
fi

echo "Sending $(git rev-parse --short HEAD) to $HOST..."
git archive --format=tar HEAD | ssh "$HOST" \
  'rm -rf ~/thedailystalk/app && mkdir -p ~/thedailystalk/{app,data,postgres,backups} &&
   tar -x -C ~/thedailystalk/app && touch ~/thedailystalk/.env && chmod 600 ~/thedailystalk/.env'

ssh "$HOST" bash -s -- "$PORT" <<'REMOTE'
set -euo pipefail
PORT="$1"
DIR="$HOME/thedailystalk"
cd "$DIR"
SUDO=""
docker info >/dev/null 2>&1 || SUDO="sudo"

set_env() { # set_env NAME VALUE: add or replace a line in .env
  if grep -q "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else echo "$1=$2" >> .env; fi
}
grep -q '^POSTGRES_PASSWORD=' .env || set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
set_env STALK_PORT "$PORT"

PROFILES=()
[ -s tunnel.env ] && PROFILES=(--profile tunnel)
compose() { $SUDO docker compose -f app/compose.yaml --env-file .env "${PROFILES[@]}" "$@"; }

echo "Building..."
compose build --quiet

# Containers from before the move to Compose (plain `docker run`) give way to the stack.
for old in thedailystalk stalk-tunnel; do
  if $SUDO docker inspect "$old" >/dev/null 2>&1; then
    echo "Replacing the old $old container..."
    $SUDO docker rm -f "$old" >/dev/null
  fi
done

# First deploy after the move from SQLite: copy the old database into Postgres, once.
if [ -f data/stalk.db ]; then
  echo "Moving the old SQLite database into Postgres..."
  compose up -d --wait db
  compose run --rm --no-deps -T app node_modules/.bin/tsx scripts/import-sqlite.ts /data/stalk.db
  for f in data/stalk.db data/stalk.db-wal data/stalk.db-shm; do
    [ -f "$f" ] && mv "$f" "$f.migrated-$(date +%F)"
  done
fi

compose up -d --remove-orphans --wait

# Nightly database backups.
sed "s#@DIR@#$DIR#g" app/deploy/stalk-backup.service | sudo tee /etc/systemd/system/stalk-backup.service >/dev/null
sudo cp app/deploy/stalk-backup.timer /etc/systemd/system/stalk-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now stalk-backup.timer >/dev/null 2>&1

for _ in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    echo "Up on 127.0.0.1:$PORT."
    compose ps --format '  {{.Service}}: {{.Status}}'
    exit 0
  fi
  sleep 1
done
echo "It didn't come up. Last log lines:"
compose logs --tail 30 app
exit 1
REMOTE
