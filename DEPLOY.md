# Deploying Trading Desk to your own domain

This puts the whole stack on one Linux server you control:

```
Internet ──► Caddy (HTTPS, auto certificates) ──► web: Next.js dashboard + alert watcher ──► scanner: AI scanner API (private)
```

Cost: about **$5–12/month** for the server plus about **$12/year** for the domain.

---

## 1. Buy the domain (GoDaddy)

Buy the domain only (for example `tradingdesk.dev`). **Skip GoDaddy's "Web Hosting" / cPanel plans.** Shared hosting can't run a long-lived Node.js server, live streaming, or background alert checks.

## 2. Get a small server (VPS)

Any provider works. Pick **Ubuntu 24.04** with **at least 2 GB RAM**, because building the app needs it.

| Provider | Plan | ~Price |
|---|---|---|
| Hetzner Cloud | CX22 (2 vCPU, 4 GB) | ~$5/mo |
| DigitalOcean | Basic Droplet 2 GB | ~$12/mo |
| AWS Lightsail | 2 GB | ~$12/mo |
| GoDaddy | VPS (if you want one bill) | varies |

Note the server's **public IPv4 address**.

## 3. Point the domain at the server

In GoDaddy go to **My Products → your domain → DNS → Manage DNS** and set:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `@` | *your server IP* | 600 |
| CNAME | `www` | `@` | 1 hour |

Delete any other `A` record for `@`, such as GoDaddy's "Parked" one. DNS usually updates within minutes. Check it with `ping yourdomain.com`.

## 4. Collect your keys

| What | Where | Needed for |
|---|---|---|
| **Finnhub API key** | https://finnhub.io/register (free) | **News**, real-time quotes, symbol search |
| Twelve Data API key | https://twelvedata.com (free) | Charts. A **second free key** for the scanner avoids hitting the 8/min limit |
| Anthropic API key | https://console.anthropic.com | Claude explanations in AI Insights |
| Web Push keys | run `cd frontend && npm run vapid` | Phone/desktop notifications |
| `OWNER_KEY` | make one up: `openssl rand -base64 24` | Marks *your* browser as the owner |
| `SCANNER_API_KEY` | make one up: `openssl rand -base64 32` | Connects the dashboard to the scanner |
| Gmail App Password *(optional)* | Google Account → Security → 2-Step Verification → App passwords | Email notifications to you |
| Telegram bot *(optional)* | Message **@BotFather** → `/newbot` for the token. Then message your bot once, and message **@userinfobot** for your chat id | Telegram notifications to you |

## 5. Install Docker on the server

```bash
ssh root@YOUR_SERVER_IP
curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 6. Copy the project to the server

From your Mac, in the folder that contains `frontend/`, `backend/` and `docker-compose.yml`, run:

```bash
rsync -az --exclude node_modules --exclude .next --exclude '.env*' --exclude .data ./ root@YOUR_SERVER_IP:/opt/trading-desk/
```

This also copies `backend/data/cache`, so the first scan starts from cached prices. A private GitHub repo plus `git clone` works too.

## 7. Configure

On the server:

```bash
cd /opt/trading-desk
echo "DOMAIN=yourdomain.com" > .env
cp deploy/web.env.example deploy/web.env
cp deploy/scanner.env.example deploy/scanner.env
nano deploy/web.env        # fill in keys; PUBLIC_BASE_URL=https://yourdomain.com
nano deploy/scanner.env    # SCANNER_API_KEY must equal AI_SCANNER_API_KEY in web.env
chmod 600 deploy/*.env
```

## 8. Launch

```bash
docker compose up -d --build
docker compose logs -f web      # look for "[watcher] started"
```

The first build takes a few minutes. Then open **https://yourdomain.com**. Caddy gets the HTTPS certificate automatically on the first visit.

## 9. Turn on your notifications

1. Open the site and press **N** (or click the bell).
2. **Owner**: enter your `OWNER_KEY`, then click **Unlock**. Your alerts and new scanner signals now also go to email/Telegram.
3. **Push to this device**: click **Enable** and allow notifications.
   On **iPhone**, first tap **Share → Add to Home Screen**, open Trading Desk from that icon, and then enable push. iOS requires this.
4. Click **Send test**. You should get a message on every channel you set up.

Do step 3 on each device you want pinged, such as your laptop and your phone.

---

## Day-to-day

| Task | Command (in `/opt/trading-desk`) |
|---|---|
| Deploy an update | `rsync` again from your Mac, then `docker compose up -d --build` |
| Logs | `docker compose logs -f web` / `docker compose logs -f scanner` |
| Restart | `docker compose restart` |
| Back up alerts & subscriptions | `docker compose cp web:/data/trading-desk.json ./backup.json` |

**How alerts work:** alerts are stored on the server and checked every 30 seconds from 4am to 8pm ET on weekdays. A browser with the page open also checks every live tick. When an alert fires, the server sends push to that browser's devices, and email/Telegram too if you're the owner. The scanner re-runs every 30 minutes, and new BUY/WATCH setups notify you once each.

**Troubleshooting**
- *Certificate errors*: DNS isn't pointing at the server yet, or ports 80/443 are blocked.
- *News says "not configured"*: `FINNHUB_API_KEY` is missing from `deploy/web.env`. Fix it, then run `docker compose up -d`.
- *Charts show "rate limit reached"*: the dashboard and scanner share one Twelve Data key. Give the scanner its own key, or lower `TWELVE_DATA_RPM`.
- *Email test fails*: for Gmail you must use an App Password, not your normal password.
- *Push "subscription expired"*: open the bell menu, then turn push off and on again.
