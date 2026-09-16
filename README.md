# TMPT Cookie Generator MVP

Playwright + Chromium service (Node.js) that generates Ticketmaster **TMPT** anti-bot cookies.

## Quick start

```bash
npm install
npx playwright install chromium
npm start
```

Open http://localhost:3847/

## Project structure

```
TMPT/
├── index.js                 # Entry point
├── src/
│   ├── config.js            # App settings (edit here)
│   ├── server.js            # HTTP server + API routes
│   ├── accounts.js          # Load account cookie files
│   ├── queue.js             # Job queue + multi-worker batch
│   ├── metrics.js           # Stats tracking
│   ├── worker.js            # Live worker step state
│   └── generator/
│       ├── index.js         # Main TMPT generation flow
│       ├── browser.js       # Playwright browser pass
│       └── cookies.js       # Cookie parse, merge, quality score
├── public/                  # Dashboard HTML
└── accounts/                # Account cookie JSON files
```

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/generate/batch` | Multi-worker TMPT generation |
| POST | `/api/v1/generate` | Single sync generation |
| GET | `/api/v1/batch/{batchId}` | Poll batch + worker progress |
| GET | `/api/v1/stats` | Dashboard stats |
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/accounts` | List accounts |

```http
POST /api/v1/generate/batch
Content-Type: application/json

{
  "accountId": "default",
  "eventUrl": "https://www.ticketmaster.com/event/...",
  "workerCount": 2
}
```

## Configuration

Edit `src/config.js`:

| Setting | Default | Description |
|---------|---------|-------------|
| `port` | `3847` | HTTP port |
| `headless` | `true` | Chromium headless mode (no visible window) |
| `proxy` | configured | Proxy server + auth |
| `defaultEventUrl` | sample event link | Dashboard default URL |
| `maxWorkers` | `3` | Max parallel browsers |

## Accounts

Place one JSON file per account in `accounts/` (see `accounts/default.json`).
