# TMPT Cookie Generator MVP

Playwright + Chromium service (Node.js) that generates Ticketmaster **TMPT** anti-bot cookies and monitors events for **Advanced Release Notice** (early ticket inventory loading).

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
│   ├── monitor/             # Advanced Release Notice
│   │   ├── index.js         # Monitor orchestrator + TMPT trigger
│   │   ├── browser-monitor.js
│   │   ├── detector.js
│   │   ├── validator.js
│   │   └── state.js
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
| POST | `/api/v1/monitor/start` | Start event monitor (ARN) |
| GET | `/api/v1/monitor/{id}` | Poll monitor status |
| POST | `/api/v1/monitor/stop/{id}` | Stop monitor |
| GET | `/api/v1/monitor/active` | List active monitors |

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
| `maxWorkers` | `3` | Max parallel browsers |

## Accounts

Place one JSON file per account in `accounts/` (see `accounts/default.json`).

## Advanced Release Notice

Flow: **Event URL → monitor → early inventory detected → validate → notice → TMPT generation**

```http
POST /api/v1/monitor/start
Content-Type: application/json

{
  "accountId": "default",
  "eventUrl": "https://www.ticketmaster.com/event/...",
  "autoGenerate": true
}
```

The monitor watches network responses on the event page for inventory/offers/sections loading. When validated, it automatically queues TMPT generation. Optional `expectedDropAt` can be passed via API for scheduled monitoring.
