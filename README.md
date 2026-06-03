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

### Docker

```bash
docker compose -f docker/docker-compose.yml up --build
```

The SPA is served with Nginx; API requests are proxied to the Python service.

## Repository

[github.com/chen890/Liquid.io](https://github.com/chen890/Liquid.io)
