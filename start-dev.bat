@echo off
start "server" cmd /k "cd /d %~dp0 && npm start"
start "tunnel" cmd /k ""C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000"
