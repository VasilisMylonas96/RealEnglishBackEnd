#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Real English Backend — one-command (re)deploy
#
# Use this after a fresh boot, a disk reset, or a new instance. It assumes
# Node.js 20 + nginx + certbot + pm2 are installed (see DEPLOY.md step 1).
#
#   bash deploy/redeploy.sh
#
# What it does:
#   1. Clones (or updates) the repo to ~/english-academy/RealEnglishBackEnd
#   2. npm install --omit=dev
#   3. npx prisma migrate deploy + generate
#   4. Installs Playwright chromium (Instagram sync)
#   5. Installs the Nginx config (HTTP step) + reloads
#   6. Issues/renews the Let's Encrypt certificate (certbot)
#   7. Starts/restarts the app under PM2
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="$HOME/english-academy/RealEnglishBackEnd"
REPO="https://github.com/VasilisMylonas96/RealEnglishBackEnd.git"
DOMAIN="realenglishacademy.duckdns.org"

echo "── 1. Clone / update repo ──"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull
else
  mkdir -p "$(dirname "$APP_DIR")"
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

echo "── 2. Install dependencies ──"
npm install --omit=dev

echo "── 3. Prisma (migrate + generate) ──"
npx prisma migrate deploy
npx prisma generate

echo "── 4. Playwright chromium (Instagram sync) ──"
npx playwright install chromium || echo "  (playwright install skipped/failed — Instagram sync will not work)"

echo "── 5. Nginx (HTTP step) ──"
sudo cp deploy/nginx-step1-http.conf /etc/nginx/sites-available/realenglish
sudo ln -sf /etc/nginx/sites-available/realenglish /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo mkdir -p /var/www/letsencrypt
sudo nginx -t && sudo systemctl reload nginx

echo "── 6. Let's Encrypt certificate ──"
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  sudo certbot renew --quiet || echo "  (renewal failed — run: sudo certbot --nginx -d $DOMAIN)"
else
  sudo certbot --nginx -d "$DOMAIN"
fi
sudo nginx -t && sudo systemctl reload nginx

echo "── 7. PM2 ──"
pm2 delete realenglish-backend 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u "$(whoami)" --hp "$HOME" || true

echo ""
echo "✅ Deploy complete."
echo "   Health:  curl https://$DOMAIN/api/health"
echo "   Logs:    pm2 logs realenglish-backend"
