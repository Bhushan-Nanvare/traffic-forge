# TrafficForge AI

An AI-powered load testing and traffic simulation platform. Deploy up to 1,000 virtual agents to simulate real human behavior on any website. Scan a site, configure virtual users, and watch live metrics stream in real time.

## Features

- **Site Scanner** — crawls any URL, discovers pages, forms, and detects app type automatically
- **HTTP Load Engine** — fires real concurrent HTTP requests from virtual user agents
- **Browser Engine** — launches headless Playwright browsers that simulate real user interactions
- **Live Dashboard** — WebSocket-powered real-time metrics (requests/sec, error rate, response times, agent activity)
- **Analytics** — post-run breakdown with P50/P95/P99 latency percentiles and per-page traffic heatmap
- **Reports** — historical test run table with pass/fail status and PDF export

## Tech Stack

- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, React Router
- **Backend**: Node.js, Express, TypeScript, WebSocket (ws), Pino logger, Cheerio, Playwright
- **Database**: PostgreSQL, Drizzle ORM
- **Monorepo**: pnpm workspaces

## Project Structure

```
├── artifacts/
│   ├── api-server/       # Express backend (port 8080)
│   └── traffic-forge/    # React/Vite frontend (port 5000 dev)
└── lib/
    ├── db/               # Shared PostgreSQL schema (Drizzle ORM)
    ├── api-spec/         # OpenAPI specification
    └── api-zod/          # Auto-generated Zod validators
```

## Local Development

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL database

### Setup

```bash
# Install dependencies
pnpm install

# Set environment variables
cp .env.example .env
# Edit .env and set DATABASE_URL

# Push database schema
pnpm --filter @workspace/db run db:push

# Start backend (port 8080)
PORT=8080 pnpm --filter @workspace/api-server run dev

# Start frontend (port 5000, separate terminal)
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/traffic-forge run dev
```

Open `http://localhost:5000` in your browser.

## Production Build

```bash
# Build everything (frontend + backend)
pnpm run build

# Start the production server (serves frontend + API on one port)
NODE_ENV=production PORT=8080 pnpm --filter @workspace/api-server run start
```

In production, the Express server serves the compiled React frontend as static files. No separate frontend server is needed.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/dbname`) |
| `PORT` | Yes | Port for the backend server |
| `NODE_ENV` | No | Set to `production` to enable static frontend serving |
| `BASE_PATH` | Dev only | Base path for the Vite dev server (use `/`) |

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/active-runs` | List running tests |
| POST | `/api/scan` | Scan a target URL |
| POST | `/api/test-configs` | Create a test configuration |
| POST | `/api/test-runs` | Create a test run |
| GET | `/api/test-runs` | List all test runs |
| POST | `/api/test-runs/:id/start` | Start a test run |
| POST | `/api/test-runs/:id/stop` | Stop a running test |
| POST | `/api/test-runs/:id/cleanup` | Delete run and config |
| WS | `/ws/live-metrics?runId=` | Live metrics WebSocket stream |

## Database Schema

Two tables: `test_configs` (stores test settings) and `test_runs` (stores test results).

Run migrations with:
```bash
pnpm --filter @workspace/db run db:push
```
