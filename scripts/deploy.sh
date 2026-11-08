#!/usr/bin/env bash
# Deploys the committed code to a server with Docker and runs it on a port.
#
#   scripts/deploy.sh user@host [port]        (port defaults to 5001)
#
# On the server, everything lives in ~/thedailystalk:
#   app/    the code (replaced on every deploy)
#   data/   the database and photos (kept across deploys; back this up)
#   .env    settings like SMTP and ADMIN_EMAILS (see .env.example). Created empty if missing.
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
  'rm -rf ~/thedailystalk/app && mkdir -p ~/thedailystalk/app ~/thedailystalk/data &&
   tar -x -C ~/thedailystalk/app && touch ~/thedailystalk/.env && chmod 600 ~/thedailystalk/.env'

ssh "$HOST" bash -s -- "$PORT" <<'REMOTE'
set -euo pipefail
PORT="$1"
DIR="$HOME/thedailystalk"
DOCKER=docker
docker info >/dev/null 2>&1 || DOCKER="sudo docker"

echo "Building the image (the first build takes a few minutes)..."
$DOCKER build -q -t thedailystalk "$DIR/app" >/dev/null
$DOCKER rm -f thedailystalk >/dev/null 2>&1 || true
# The -e flags win over .env, so the container always listens where the port mapping expects.
$DOCKER run -d --name thedailystalk --init --restart unless-stopped \
  -p "$PORT:3001" -v "$DIR/data:/data" --env-file "$DIR/.env" \
  -e HOST=0.0.0.0 -e PORT=3001 -e DATA_DIR=/data \
  thedailystalk >/dev/null

for _ in $(seq 1 30); do
  if curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null; then
    echo "Up on port $PORT."
    exit 0
  fi
  sleep 1
done
echo "It didn't come up. Last log lines:"
$DOCKER logs --tail 30 thedailystalk
exit 1
REMOTE
