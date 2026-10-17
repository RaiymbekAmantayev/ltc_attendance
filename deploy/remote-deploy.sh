#!/usr/bin/env bash
# Выполняется на сервере пользователем ltccab из GitHub Actions:
#   remote-deploy.sh <sha> <путь к release.tar.gz>
# Релиз ставится в отдельную папку, current переключается атомарно, при неудачном /healthz — откат.
set -euo pipefail

APP=ltc-cabinet-node
BASE=/opt/$APP
SHA=$1
TARBALL=$2
KEEP=5
REL=$BASE/releases/$(date -u +%Y%m%d%H%M%S)-${SHA:0:7}
PORT=$(grep -E '^PORT=' $BASE/shared/.env | cut -d= -f2)

health() {
  for i in $(seq 1 20); do
    curl -fsS --max-time 3 "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

echo "==> релиз $REL"
mkdir -p "$REL"
tar -xzf "$TARBALL" -C "$REL"
rm -f "$TARBALL"
ln -sfn $BASE/shared/.env "$REL/.env"

cd "$REL"
npm ci --omit=dev --no-audit --no-fund
echo "==> миграции БД"
node scripts/init-db.js

PREV=$(readlink -f $BASE/current 2>/dev/null || true)
ln -sfn "$REL" $BASE/current.new && mv -Tf $BASE/current.new $BASE/current
sudo /usr/bin/systemctl restart $APP

if health; then
  echo "==> OK: $(curl -fsS http://127.0.0.1:$PORT/healthz)"
else
  echo "!!! /healthz не ответил — откат" >&2
  sudo /usr/bin/journalctl -u $APP -n 40 --no-pager || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    ln -sfn "$PREV" $BASE/current.new && mv -Tf $BASE/current.new $BASE/current
    sudo /usr/bin/systemctl restart $APP
  fi
  exit 1
fi

# Чистим старые релизы, текущий не трогаем.
CUR=$(readlink -f $BASE/current)
ls -1dt $BASE/releases/*/ | sed 's#/$##' | grep -vxF "$CUR" | tail -n +$KEEP | xargs -r rm -rf
