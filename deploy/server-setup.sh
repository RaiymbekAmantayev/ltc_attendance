#!/usr/bin/env bash
# Разовая подготовка сервера под ltc-cabinet-node. Запускать от root; повторный запуск безопасен.
#   bash server-setup.sh "<публичный SSH-ключ CI>"
# Ничего чужого не трогает: свой пользователь, своя папка, свой порт (127.0.0.1:9120),
# своя MySQL в Docker (127.0.0.1:3307), свой systemd-юнит. Caddy НЕ меняет.
set -euo pipefail

APP=ltc-cabinet-node
APP_USER=ltccab
BASE=/opt/$APP
APP_PORT=9120
DB_PORT=3307
DB_NAME=ltc_attendance
DB_CONTAINER=$APP-mysql
CI_PUBKEY=${1:-}

[ "$(id -u)" = 0 ] || { echo "нужен root"; exit 1; }
[ -n "$CI_PUBKEY" ] || { echo "передайте публичный SSH-ключ CI первым аргументом"; exit 1; }

# Порты должны быть свободны (или уже заняты нами).
busy() { ss -Htln "( sport = :$1 )" | grep -q .; }
if busy $APP_PORT && ! systemctl is-active --quiet $APP; then echo "порт $APP_PORT занят чужим процессом — стоп"; exit 1; fi
if busy $DB_PORT && ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then echo "порт $DB_PORT занят чужим процессом — стоп"; exit 1; fi

# 1. Пользователь, под которым работает приложение и заходит CI.
id $APP_USER &>/dev/null || useradd --system --create-home --home-dir /home/$APP_USER --shell /bin/bash $APP_USER
install -d -m 700 -o $APP_USER -g $APP_USER /home/$APP_USER/.ssh
AK=/home/$APP_USER/.ssh/authorized_keys
touch $AK && chown $APP_USER:$APP_USER $AK && chmod 600 $AK
grep -qxF "$CI_PUBKEY" $AK || echo "$CI_PUBKEY" >> $AK

# 2. Папки: releases/<sha>, current -> релиз, shared/.env, backups/.
install -d -o $APP_USER -g $APP_USER $BASE $BASE/releases $BASE/shared
install -d -m 700 -o root -g root $BASE/backups

# 3. MySQL 8.4 в Docker, только на localhost, данные в именованном томе.
DB_ROOT_FILE=/root/.$APP-mysql-root
if ! docker ps -a --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  [ -f $DB_ROOT_FILE ] || (umask 077; openssl rand -hex 24 > $DB_ROOT_FILE)
  docker run -d --name $DB_CONTAINER --restart unless-stopped \
    -p 127.0.0.1:$DB_PORT:3306 \
    -v $APP-mysql-data:/var/lib/mysql \
    -e MYSQL_ROOT_PASSWORD="$(cat $DB_ROOT_FILE)" \
    --memory 1g \
    mysql:8.4 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
fi
echo -n "ждём MySQL"
for i in $(seq 1 60); do
  docker exec $DB_CONTAINER mysqladmin ping -uroot -p"$(cat $DB_ROOT_FILE)" --silent &>/dev/null && break
  echo -n .; sleep 2
done; echo

# 4. Пользователь БД и shared/.env (создаётся один раз; дальше правится руками).
ENV_FILE=$BASE/shared/.env
if [ ! -f $ENV_FILE ]; then
  DB_PASS=$(openssl rand -hex 20)
  docker exec -i $DB_CONTAINER mysql -uroot -p"$(cat $DB_ROOT_FILE)" <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$APP_USER'@'%' IDENTIFIED BY '$DB_PASS';
ALTER USER '$APP_USER'@'%' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$APP_USER'@'%';
FLUSH PRIVILEGES;
SQL
  (umask 077; cat > $ENV_FILE <<ENV
# ltc-cabinet-node — боевые настройки. Файл живёт только на сервере.
HOST=127.0.0.1
PORT=$APP_PORT
DATABASE_URL=mysql://$APP_USER:$DB_PASS@127.0.0.1:$DB_PORT/$DB_NAME
APP_TZ=Asia/Almaty
TRUST_PROXY=1
# Домен ещё не подключён — бот выключен, чтобы не конфликтовать с @LTC_Teacher_bot.
APP_URL=
BOT_DISABLED=1
BOT_TOKEN=CHANGE_ME
TELEGRAM_API_BASE=https://api.telegram.org
HH_MOCK=0
HH_DOMAIN=CHANGE_ME
HH_AUTHKEY=CHANGE_ME
ADMIN_USER=admin
ADMIN_PASS=$(openssl rand -hex 12)
DIRECTOR_TG_IDS=
ENV
  )
  chown $APP_USER:$APP_USER $ENV_FILE
  echo ">>> создан $ENV_FILE — впишите BOT_TOKEN, HH_DOMAIN, HH_AUTHKEY"
fi

# 5. systemd-юнит.
cat > /etc/systemd/system/$APP.service <<UNIT
[Unit]
Description=LTC cabinet (Node.js, ltc_attendance) — деплой из GitHub Actions
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$BASE/current
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
MemoryMax=768M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable $APP >/dev/null 2>&1 || true   # стартует после первого деплоя (нужен current)

# 6. CI может только перезапускать свой сервис.
cat > /etc/sudoers.d/$APP <<SUDO
$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart $APP, /usr/bin/systemctl is-active $APP, /usr/bin/systemctl status $APP *, /usr/bin/journalctl -u $APP *
SUDO
chmod 440 /etc/sudoers.d/$APP && visudo -cf /etc/sudoers.d/$APP >/dev/null

# 7. Ежедневный бэкап БД (03:30 UTC), храним 14 дней.
cat > /etc/cron.d/$APP-backup <<CRON
30 3 * * * root docker exec $DB_CONTAINER sh -c 'mysqldump -uroot -p"\$MYSQL_ROOT_PASSWORD" --single-transaction $DB_NAME' | gzip > $BASE/backups/$DB_NAME-\$(date +\%F).sql.gz && find $BASE/backups -name '*.sql.gz' -mtime +14 -delete
CRON

echo "готово: пользователь $APP_USER, папка $BASE, MySQL 127.0.0.1:$DB_PORT, сервис $APP (порт $APP_PORT)"
