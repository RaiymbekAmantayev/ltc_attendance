# Деплой ltc-cabinet-node

Сервер `45.93.136.191` общий с другими проектами LTC. Наш проект изолирован:

| Что | Где |
|---|---|
| Пользователь | `ltccab` (работает приложение, заходит CI) |
| Код | `/opt/ltc-cabinet-node/releases/<время>-<sha>`, активный — симлинк `current` |
| Настройки | `/opt/ltc-cabinet-node/shared/.env` (только на сервере) |
| Сервис | `ltc-cabinet-node.service`, `127.0.0.1:9120` |
| БД | Docker `ltc-cabinet-node-mysql` (MySQL 8.4), `127.0.0.1:3307`, база `ltc_attendance` |
| Бэкапы | `/opt/ltc-cabinet-node/backups`, ежедневно 03:30 UTC, 14 дней |

Caddy, `/opt/ltc-teacher-cabinet`, `@LTC_Teacher_bot` и остальные сервисы не трогаются.

## Как работает CI/CD
`.github/workflows/deploy.yml`: на каждый push/PR — тесты на MySQL; на push в `master` после зелёных тестов —
архив коммита по SSH на сервер → `deploy/remote-deploy.sh`: новый релиз, `npm ci`, миграции (`init-db`),
переключение `current`, рестарт, проверка `/healthz`; если не ответил — откат на предыдущий релиз.
Деплой включён, только когда в окружении `production` задана переменная `DEPLOY_HOST`.

## Первичная настройка (один раз)
1. Ключ для CI (на своём компьютере): `ssh-keygen -t ed25519 -N "" -C github-actions-ltc -f ci_deploy`
2. На сервере от root: `bash server-setup.sh "$(cat ci_deploy.pub)"`, затем вписать `BOT_TOKEN`, `HH_DOMAIN`, `HH_AUTHKEY`
   в `/opt/ltc-cabinet-node/shared/.env`.
3. GitHub → Settings → Environments → `production`:
   - секрет `DEPLOY_SSH_KEY` — содержимое `ci_deploy` (приватный ключ), затем удалить файл;
   - секрет `DEPLOY_KNOWN_HOSTS` — вывод `ssh-keyscan -t ed25519 45.93.136.191`;
   - переменная `DEPLOY_HOST` = `45.93.136.191`.
4. Actions → CI / Deploy → Run workflow.

## Полезное
```bash
systemctl status ltc-cabinet-node          # статус
journalctl -u ltc-cabinet-node -f          # логи
ls -lt /opt/ltc-cabinet-node/releases      # релизы; откат: ln -sfn <релиз> current && systemctl restart ltc-cabinet-node
```

## Домен
Когда A-запись поддомена будет указывать на сервер — добавить блок из `Caddyfile.snippet` в Caddyfile,
затем в `.env`: `APP_URL=https://<поддомен>`, `BOT_DISABLED=0`. Бот должен быть **своим**:
тот же токен, что у работающего бота, вызовет конфликт `getUpdates`.
