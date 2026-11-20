# Deployment Guide — Real English Backend (Oracle Cloud)

Target: `https://realenglishacademy.duckdns.org` → `http://127.0.0.1:4000`
(DuckDNS A record → Oracle public IP `92.5.191.159`)

## 1. Server prerequisites (Oracle, Ubuntu)

```bash
# Node.js 20 (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2
sudo npm install -g pm2

# Nginx + Certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Native build tools (needed by sharp / @napi-rs/canvas / better-sqlite3)
sudo apt install -y build-essential python3
```

## 2. Get the code

```bash
cd /var/www
sudo git clone https://github.com/VasilisMylonas96/RealEnglishBackEnd.git realenglish
cd realenglish
npm install --omit=dev
```

## 3. Create the `.env` (with your secrets)

Copy the template and fill in the real values:

```bash
cp .env.example .env
nano .env
```

Required values (see `.env.example` for the full list):

| Variable | Value |
|----------|-------|
| `PORT` | `4000` |
| `CORS_ORIGIN` | `https://realenglishacademy.netlify.app` |
| `JWT_SECRET` | long random string (`node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`) |
| `DATABASE_URL` | your Neon pooled connection string |
| `PUBLIC_BASE_URL` | `https://realenglishacademy.duckdns.org` |
| `APP_BASE_URL` | `https://realenglishacademy.netlify.app` |
| `FRONTEND_URL` | `https://realenglishacademy.netlify.app` |
| `UPLOADS_DIR` | `/var/www/realenglish/uploads` |
| `GEMINI_API_KEY` | your Gemini key |
| `GOOGLE_PLACES_API_KEY` / `GOOGLE_PLACE_ID` | your Google Places values |
| `MAIL_USER` / `MAIL_PASS` | Gmail + App Password |
| `NODE_ENV` | `production` |

> ⚠️ Never commit `.env`. It is already in `.gitignore`.

## 4. Uploads folder

```bash
sudo mkdir -p /var/www/realenglish/uploads
sudo chown -R $USER:$USER /var/www/realenglish/uploads
```

Copy the existing media files from your old machine into this folder
(e.g. via WinSCP/scp from `server/uploads/`). The files are referenced by
filename in the database, so the folder contents must match.

> **Oracle note:** the boot volume is ephemeral — on a reboot the instance
> reboots from the image and `/var/www` changes are lost. Either (a) bake the
> app + uploads into a custom image, or (b) attach a Block Volume and mount
> it at `/var/www`.

## 5. Database (Neon)

The schema migration is already applied to Neon. If you ever need to re-apply
pending migrations:

```bash
npx prisma migrate deploy
npx prisma generate
```

## 6. Nginx + HTTPS

```bash
sudo cp deploy/nginx-realenglish.conf /etc/nginx/sites-available/realenglish
sudo ln -s /etc/nginx/sites-available/realenglish /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo mkdir -p /var/www/letsencrypt
sudo nginx -t && sudo systemctl reload nginx

# Issue the certificate (duckdns.org resolves to the Oracle IP, so this works)
sudo certbot --nginx -d realenglishacademy.duckdns.org
```

Certbot rewrites the config to add the certificate and the HTTP→HTTPS
redirect. Renewal is automatic (systemd timer).

## 7. Start with PM2

```bash
cd /var/www/realenglish
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # run the printed command so PM2 survives reboots
pm2 logs realenglish-backend   # watch the logs
```

## 8. Verify

```bash
curl https://realenglishacademy.duckdns.org/api/health
# → {"ok":true,"service":"realenglish-backend",...}
```

Then open the frontend and log in.

## 9. Frontend (Netlify)

In the Netlify site settings → Environment variables, set:

```
REACT_APP_API_URL=https://realenglishacademy.duckdns.org
```

Then rebuild the site. The frontend will call the API on the same HTTPS
origin, and all media URLs (built from `PUBLIC_BASE_URL`) will be HTTPS —
no mixed content.

## Updating the app later

```bash
cd /var/www/realenglish
git pull
npm install --omit=dev
npx prisma migrate deploy   # only if new migrations exist
pm2 restart realenglish-backend
```
