# Liquid.io

Local-first **document intelligence and RSU / equity dashboard**: upload grant statements (PDF, Office, CSV, and more), extract structured data with AI, and track vesting, tax scenarios, live prices, and reminders in the browser.

## Quick start

### Frontend

```bash
npm install
npm run dev
```

### API server (extract + market data)

From `server/`:

```bash
uv sync
uv run uvicorn main:app --reload --port 3712
```

Copy `.env.example` to `.env` and fill in credentials for your environment. **Never commit `.env`.**

### User accounts & vault

The Python server stores users in **SQLite** (`data/users.db` by default), hashes passwords with **bcrypt**, issues **JWT** sessions in an **httpOnly** cookie (`ep_session`), and encrypts vault secrets and file blobs at rest with **Fernet** (symmetric key from `APP_ENCRYPTION_KEY` or auto-generated `data/.fernet_key` — **back up this key**; losing it means vault data cannot be decrypted).

For local dev, keys are created automatically under `data/` on first run. In production, set `JWT_SECRET` and `APP_ENCRYPTION_KEY` explicitly, restrict `CORS_ORIGINS` to your real SPA origin(s), and serve the app over **HTTPS** so `Secure` cookies apply.

The React app requires a signed-in user before loading the dashboard. Use **Secure vault** in the sidebar for API keys and encrypted file uploads.

### Docker

```bash
docker compose -f docker/docker-compose.yml up --build
```

The SPA is served with Nginx; API requests are proxied to the Python service.

## Repository

[github.com/chen890/Liquid.io](https://github.com/chen890/Liquid.io)
