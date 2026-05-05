# TrafficForge AI — Complete Technical Documentation

# From Basics to Advanced

---

## Table of Contents

1. What Is TrafficForge?
2. Technologies Used
3. Project Architecture
4. Monorepo Structure
5. Database — How Data Is Stored and Retrieved
6. Backend — How the Server Works
7. The Engines — How Load Testing Actually Works
8. The Scanner — How Site Discovery Works
9. WebSocket — How Live Metrics Stream to the Browser
10. Frontend — How the UI Works
11. State Management
12. The useLiveData Hook — How the Dashboard Gets Live Data
13. Complete Request Flow — From Click to Result
14. Middleware Explained
15. Error Handling Strategy
16. Key Design Decisions

---

## 1. What Is TrafficForge?

TrafficForge is a web application that lets you **stress test any website** by sending a large number of simulated users to it at the same time. Think of it like this: before you launch your app and 10,000 people visit it on day one, you want to know — will it hold up? Will it slow down? Will it crash? TrafficForge answers those questions.

You give it a URL. It scans the site automatically. Then it fires dozens or hundreds of fake user requests at it simultaneously, measures how fast the server responds, how many requests fail, and gives you a full breakdown.

The key difference from other tools: TrafficForge fires **real HTTP requests** to the real website. All numbers it reports are measured from actual responses, not simulated.

---

## 2. Technologies Used

### Frontend

| Technology                         | Version | What It Does                                                                                     |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| **React**                          | 18      | UI component library. Every page and button is a React component                                 |
| **Vite**                           | 5       | Build tool and dev server. Compiles TypeScript/JSX, serves the frontend on port 5000             |
| **TypeScript**                     | 5       | Adds type safety to JavaScript so bugs are caught at compile time, not runtime                   |
| **React Router v6**                | 6       | Handles client-side navigation between pages without full page reloads                           |
| **TanStack Query (React Query)**   | 5       | Fetches data from the API, caches it, and automatically re-fetches when stale                    |
| **Tailwind CSS**                   | 3       | Utility-first CSS framework. Instead of writing `.card { padding: 16px }` you write `p-4` in JSX |
| **shadcn/ui**                      | latest  | Pre-built accessible UI components (buttons, cards, tables, charts) built on top of Radix UI     |
| **Recharts**                       | 2       | Chart library used for the response time line chart and bar charts                               |
| **WebSocket (native browser API)** | —       | Receives live streaming metrics from the backend during active tests                             |

### Backend

| Technology     | Version | What It Does                                                                                             |
| -------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| **Node.js**    | 20      | JavaScript runtime — runs the server code                                                                |
| **TypeScript** | 5       | Same as frontend — type safety for server code                                                           |
| **Express**    | 4       | Web framework that handles HTTP routing (which URL maps to which function)                               |
| **ws**         | 8       | WebSocket library for Node.js — handles the real-time bidirectional connection                           |
| **Pino**       | 8       | Very fast structured JSON logger — every request is logged with method, URL, status code                 |
| **pino-http**  | 9       | Middleware that automatically logs every HTTP request through Express                                    |
| **Cheerio**    | 1       | HTML parser — like jQuery but for Node.js. Used by the scanner to extract links and forms from page HTML |
| **Playwright** | 1       | Headless browser automation — launches real Chrome instances that browse the target site                 |
| **tsx**        | 4       | TypeScript executor for Node.js — runs `.ts` files directly without compiling first                      |
| **cors**       | 2       | Express middleware that allows the frontend (port 5000) to call the backend (port 8080)                  |

### Database

| Technology      | Version | What It Does                                                                                        |
| --------------- | ------- | --------------------------------------------------------------------------------------------------- |
| **PostgreSQL**  | 16      | Relational database. Stores all test configurations and test run results permanently                |
| **Drizzle ORM** | 0.30    | TypeScript-first ORM. Write database queries in TypeScript with full type safety instead of raw SQL |
| **drizzle-kit** | 0.21    | CLI tool for managing database schema migrations                                                    |
| **drizzle-zod** | 0.5     | Auto-generates Zod validation schemas from the Drizzle table definitions                            |

### Tooling

| Technology          | What It Does                                                                        |
| ------------------- | ----------------------------------------------------------------------------------- |
| **pnpm**            | Fast package manager with workspace support — manages multiple packages in one repo |
| **pnpm workspaces** | Allows multiple `package.json` files in one repo, each as an independent package    |

---

## 3. Project Architecture

TrafficForge is a **full-stack web application** with two separate servers:

```
Browser (User)
     │
     ├── HTTP requests to port 5000 ──► Vite Dev Server (React frontend)
     │                                        │
     │                                        │ proxy /api/* → port 8080
     │                                        │ proxy /ws/* → port 8080
     │
     ├── API calls to /api/* ─────────────────► Express Server (port 8080)
     │                                               │
     └── WebSocket to /ws/* ──────────────────────── │
                                                      │
                                               PostgreSQL DB
```

**Why two servers?**

- The frontend (Vite) serves only static files: HTML, CSS, JavaScript bundles
- The backend (Express) handles all business logic: scanning, running tests, storing results
- This is the standard "frontend + backend API" pattern used by most modern web apps
- Vite proxies all `/api/*` and `/ws/*` calls to the backend so the browser only ever talks to one origin

---

## 4. Monorepo Structure

A monorepo means multiple separate packages live in a single Git repository, all managed together.

```
root/
├── pnpm-workspace.yaml          ← Tells pnpm where all packages are
├── package.json                 ← Root-level scripts and shared dev tools
│
├── artifacts/
│   ├── api-server/              ← Backend package (@workspace/api-server)
│   └── traffic-forge/           ← Frontend package (@workspace/traffic-forge)
│
└── lib/
    └── db/                      ← Shared database package (@workspace/db)
```

**How packages reference each other:**
The backend imports the database package like this:

```typescript
import { db } from '@workspace/db';
```

`@workspace/db` is the `name` field inside `lib/db/package.json`. pnpm's workspace feature resolves this to the local folder — no need to publish to npm.

**Why this structure?**

- The database schema is defined once in `lib/db/` and shared by both apps
- If you change the schema, both frontend types and backend queries update together
- Each package has its own `tsconfig.json`, dependencies, and build process

---

## 5. Database — How Data Is Stored and Retrieved

### The ORM (Drizzle)

An ORM (Object-Relational Mapper) is a layer that lets you write database queries in your programming language instead of raw SQL. Drizzle ORM is TypeScript-first, meaning the queries are fully type-safe.

**Schema definition** (`lib/db/src/schema/trafficforge.ts`):

```typescript
export const testConfigsTable = pgTable('test_configs', {
  id: serial('id').primaryKey(), // auto-incrementing integer
  url: text('url').notNull(), // required field
  user_count: integer('user_count').default(10),
  duration_sec: integer('duration_sec').default(60),
  shadow_mode: boolean('shadow_mode').default(false),
  discovered_paths: jsonb('discovered_paths').$type<string[]>(), // stores JSON array
  created_at: timestamp('created_at').defaultNow(),
  // ... more fields
});
```

This TypeScript code **is** the database schema. Running `drizzle-kit push` takes this code and creates or updates the actual PostgreSQL tables.

### The Two Tables

**test_configs** — stores what a test was configured to do:

- Target URL, user count, duration, test mode, discovered paths, etc.
- Has an auto-incrementing integer `id` as primary key
- Created before the test runs

**test_runs** — stores what actually happened:

- A UUID (randomly generated, like `8aca0f10-8da4-...`) as primary key
- References `test_configs.id` via `config_id`
- `status` column: `pending → running → completed / cancelled / interrupted`
- `passed` column is **nullable boolean**: `null` = test never ran, `true` = passed, `false` = failed
- Stores per-page metrics and error breakdown as JSONB (flexible JSON inside PostgreSQL)

### How Data Is Retrieved

**Inserting** a test config:

```typescript
const [row] = await db
  .insert(testConfigsTable)
  .values({ url, user_count, duration_sec, ... })
  .returning();   // returns the full inserted row including auto-generated id
```

**Querying** all test runs, newest first:

```typescript
const runs = await db
  .select()
  .from(testRunsTable)
  .orderBy(desc(testRunsTable.created_at))
  .limit(50);
```

**Updating** a run's status when it starts:

```typescript
await db
  .update(testRunsTable)
  .set({ status: 'running', started_at: new Date() })
  .where(eq(testRunsTable.id, runId));
```

**Deleting** a run and its config:

```typescript
await db.delete(testRunsTable).where(eq(testRunsTable.id, id));
await db.delete(testConfigsTable).where(eq(testConfigsTable.id, configId));
```

### JSONB columns

`page_metrics` and `error_breakdown` are stored as PostgreSQL JSONB. This means they store arbitrary structured data inside a single database column:

```json
// page_metrics column value
{
  "/": { "count": 299, "avgMs": 32, "errors": 0 },
  "/login": { "count": 301, "avgMs": 145, "errors": 12 }
}

// error_breakdown column value
{
  "http_5xx": 6,
  "timeout": 2
}
```

JSONB is queried and returned as a regular JavaScript/TypeScript object.

---

## 6. Backend — How the Server Works

### Entry Point (`src/index.ts`)

When the backend starts, it does four things in order:

1. **Validates the PORT** environment variable — crashes immediately if missing
2. **Creates an HTTP server** (not Express directly — a raw `http.createServer(app)`)
3. **Sets up the WebSocket server** on the same HTTP server (both share port 8080)
4. **Sweeps stale runs** — any run stuck in `"running"` state from a previous server crash gets marked as `"interrupted"` in the database
5. **Starts listening** on the configured port

```typescript
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// WebSocket upgrade handler — upgrades HTTP to WS for /ws/live-metrics
server.on('upgrade', (req, socket, head) => {
  if (url.pathname === '/ws/live-metrics') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy(); // reject all other upgrade attempts
  }
});
```

The raw `http.Server` is used instead of `express.listen()` because Express alone cannot handle WebSocket protocol upgrades. Both HTTP (API requests) and WS (live metrics) share the same port.

### Express App (`src/app.ts`)

This is where the middleware stack is defined. Middleware in Express is a chain of functions that process every request in order before it reaches your route handler.

**Middleware chain (in order):**

```
Request arrives at port 8080
        │
        ▼
[1] pino-http      — logs the request (method, URL, status code)
        │
        ▼
[2] cors()         — adds CORS headers so browser on port 5000 can call port 8080
        │
        ▼
[3] express.json() — parses JSON request bodies (req.body becomes an object)
        │
        ▼
[4] express.urlencoded() — parses form-encoded request bodies
        │
        ▼
[5] router at /api — routes the request to the correct handler
        │
        ▼
Response sent
```

**What each middleware does:**

- **pino-http**: Before your route handler runs, it captures the start time. After your handler responds, it logs the request method, URL (without query string for privacy), status code, and response time in milliseconds. All logs are structured JSON — useful for log aggregation.

- **cors()**: Without this, the browser would block requests from `localhost:5000` to `localhost:8080` because they have different ports. CORS (Cross-Origin Resource Sharing) adds response headers like `Access-Control-Allow-Origin: *` that tell the browser it's allowed.

- **express.json()**: If a POST request arrives with body `{"url": "https://example.com"}` as raw bytes, this middleware parses it and makes `req.body.url` available in your handler.

### Router (`src/features/trafficforge/router.ts`)

All business logic lives here. This file:

- Defines all API endpoints
- Manages in-memory state for active test runs
- Contains the WebSocket broadcast system
- Orchestrates the load testing engines

**In-memory state (two Maps):**

```typescript
// Tracks currently running tests: runId → { abortController, startedAt, config }
const activeRuns = new Map<string, {...}>();

// Tracks which WebSocket clients are watching which run
const runClients = new Map<string, Set<WebSocket>>();
```

Why in-memory instead of database? Active run state needs to be checked and updated thousands of times per second during a test. Database reads/writes are too slow for this. The database is only used for persistent data that needs to survive server restarts.

---

## 7. The Engines — How Load Testing Actually Works

### HTTP Engine (`engine/loadEngine.ts`)

This is the core of the platform. It simulates multiple concurrent users firing HTTP requests at the target URL.

**Step 1 — Ramp-up calculation:**

```typescript
const rampInterval = userCount > 1 ? rampUpMs / (userCount - 1) : 0;
```

If you have 20 users and a 10-second ramp-up, each new user starts 526ms after the previous one. This simulates organic traffic growth instead of slamming 20 users all at once.

**Step 2 — Each user is an async function:**

```typescript
for (let i = 0; i < userCount; i++) {
  const delay = Math.round(i * rampInterval);

  userPromises.push(
    (async () => {
      await sleep(delay); // wait for ramp-up slot
      activeUsers++;

      while (!signal.aborted && Date.now() - startTime < durationMs) {
        const path = safePaths[pathIdx % safePaths.length];
        pathIdx++;

        const result = await makeRequest(url, path, timeoutMs, userId);
        allResults.push(result);

        // think time between requests
        const thinkTime = respectRateLimits
          ? 800 + Math.random() * 1200 // 0.8–2s polite
          : 50 + Math.random() * 200; // 50–250ms aggressive

        await sleep(thinkTime);
      }
      activeUsers--;
    })(),
  );
}

await Promise.allSettled(userPromises);
```

Each user is an independent async loop that runs concurrently with all other users. `Promise.allSettled` waits for all users to finish. The `AbortController.signal` lets us cleanly stop all users when the test is cancelled or auto-stopped.

**Step 3 — Making the actual HTTP request:**

```typescript
async function makeRequest(baseUrl, path, timeoutMs, userId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs); // 15s timeout
  const t0 = performance.now();

  const res = await fetch(fullUrl, {
    signal: controller.signal,
    headers: { "User-Agent": "TrafficForge-LoadTest/1.0", ... }
  });
  await res.text(); // drain body to measure full time, not just TTFB

  const responseMs = Math.round(performance.now() - t0);

  if (res.status >= 500) return { ..., success: false, errorType: "http_5xx" };
  if (res.status >= 400) return { ..., success: false, errorType: "http_4xx" };
  return { ..., success: true };
}
```

`performance.now()` is used (not `Date.now()`) because it has sub-millisecond precision and is monotonically increasing — not affected by system clock changes.

**Why drain the body?** `await res.text()` reads the entire response body before stopping the timer. Without this, you'd only measure TTFB (Time To First Byte), which is just when the server starts responding, not when it finishes. Full-body time is more representative of real user experience.

**Step 4 — Metrics calculation:**

Every 500ms, a metrics broadcast loop fires:

```typescript
const metricsLoop = setInterval(() => {
  const batch = recentBatch.splice(0); // drain the recent results
  const metrics = buildMetrics(allResults, activeUsers, startTime, batch, inFlightCount);
  onMetrics(metrics); // this calls broadcastToRun() → sends to WebSocket clients
}, 500);
```

**Percentile calculation** (P50, P95, P99):

```typescript
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}
```

Sort all successful response times numerically. P50 is the value at index 50% through the array. P95 is at 95%. This is the standard statistical method for latency percentiles.

**Auto-stop mechanism:**

```typescript
if (allResults.length >= 20) {
  // wait for at least 20 data points
  const failCount = allResults.filter((r) => !r.success).length;
  const errPct = (failCount / allResults.length) * 100;
  if (errPct > autoStopErrorThreshold) {
    abortController.abort(); // signals all user loops to stop
  }
}
```

### Browser Engine (`engine/browserEngine.ts`)

When `test_mode` is `"browser"` or `"both"`, this engine launches real headless Chromium browsers using Playwright. Each browser agent:

1. Opens a new browser context (isolated from other agents)
2. Navigates to the target URL
3. Simulates user behavior: clicking random links, filling forms, scrolling
4. Records page load times and errors
5. Closes when the test duration expires

Browser agents produce different metrics than HTTP agents — they measure full page render time including JavaScript execution, not just server response time.

### Running Both Engines Concurrently

When `test_mode === "both"`:

```typescript
await Promise.allSettled([runHttp(), runBrowser()]);
```

Both engines run in parallel. Results are merged at the end: page metrics are combined, error breakdowns are summed, and the final error rate is recalculated from total requests across both engines.

---

## 8. The Scanner — How Site Discovery Works

**File:** `engine/scanner.ts`

The scanner uses `fetch` + `cheerio` (HTML parser) to crawl the target site like a search engine spider would.

**Step 1 — Fetch the root page:**

```typescript
const res = await fetch(url, { headers: { 'User-Agent': 'TrafficForge-Scanner/1.0' } });
const html = await res.text();
```

**Step 2 — Parse HTML with Cheerio:**

```typescript
const $ = cheerio.load(html);

// Extract all internal links
$("a[href]").each((_, el) => {
  const href = $(el).attr("href");
  // filter to same-origin, relative paths only
});

// Extract all forms
$("form").each((_, el) => {
  const fields = $("input, select, textarea", el).map(...).get();
  allForms.push({ type, fields, action, method });
});

// Extract buttons
$("button, [role=button]").each(...);
```

**Step 3 — BFS crawl (Breadth-First Search):**

```typescript
const queue = ['/'];
const visited = new Set([rootPath]);

while (queue.length > 0 && pagesScanned < maxPages) {
  const path = queue.shift();
  const page = await fetchPage(baseUrl + path);

  // extract links from this page, add unvisited ones to queue
  for (const link of extractLinks(page.html)) {
    if (!visited.has(link)) {
      visited.add(link);
      queue.push(link);
    }
  }
  pagesScanned++;
}
```

**Step 4 — App type detection:**

The scanner looks for framework-specific signatures in the HTML:

- Vue.js: `id="app"` or `data-v-` attributes
- React: `id="root"` or `__NEXT_DATA__` script
- Angular: `ng-version` attributes
- E-commerce: cart buttons, product grids
- SaaS: pricing tables, feature lists

**Step 5 — Error handling:**

If `pagesScanned === 0` after the while loop (site was unreachable), the scanner returns:

```typescript
{
  error: 'Could not reach the target URL. The site may be down, blocking our scanner, or returning a non-HTML response.';
}
```

The router then returns HTTP 502 to the frontend, which shows the error message to the user.

---

## 9. WebSocket — How Live Metrics Stream to the Browser

WebSocket is a persistent bidirectional connection between browser and server. Unlike regular HTTP (request → response → connection closes), WebSocket keeps the connection open so the server can push data to the browser at any time.

### How the Connection Is Established

The browser (inside `useLiveData.ts`) connects:

```typescript
const ws = new WebSocket('ws://localhost:5000/ws/live-metrics?runId=<id>');
```

Vite proxies this to the backend:

```
ws://localhost:5000/ws/live-metrics → ws://localhost:8080/ws/live-metrics
```

The backend receives an HTTP `Upgrade` request, upgrades it to WebSocket protocol, and registers the client:

```typescript
server.on('upgrade', (req, socket, head) => {
  if (url.pathname === '/ws/live-metrics') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
});
```

### How Clients Are Organized

```typescript
// runId → Set of all WebSocket clients watching that run
const runClients = new Map<string, Set<WebSocket>>();
```

When a client connects with `?runId=abc123`, it's added to `runClients.get("abc123")`. When the load engine produces metrics, it broadcasts to all clients in that set:

```typescript
function broadcastToRun(runId: string, payload: unknown) {
  const clients = runClients.get(runId);
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}
```

### Message Format

Every 500ms during a test, the backend sends:

```json
{
  "type": "metrics",
  "runId": "8aca0f10-...",
  "stats": {
    "activeAgents": 18,
    "requestsPerSec": 42.3,
    "errorRate": 0.2,
    "avgResponseTime": 34
  },
  "resourceStats": {
    "cpu": 23,
    "ram": 187,
    "dbConnections": 8
  },
  "chartPoint": { "time": "7:25", "value": 34 },
  "activity": [
    {
      "id": 1247,
      "name": "User-3",
      "action": "/login → 200 (28ms)",
      "type": "success",
      "time": "7:25:03 PM"
    }
  ],
  "enriched": {
    "completed": 1523,
    "failed": 3,
    "p50Ms": 30,
    "p95Ms": 42,
    "pageMetrics": { "/": { "count": 152, "avgMs": 32, "errors": 0 } }
  }
}
```

---

## 10. Frontend — How the UI Works

### React and Component Model

React builds the UI as a **tree of components**. A component is a function that receives data (props) and returns what to render (JSX — HTML-like syntax in JavaScript). When data changes, React automatically re-renders only the components that depend on that data.

### Routing (`App.tsx`)

```typescript
<BrowserRouter>
  <Routes>
    <Route path="/"            element={<Overview />} />
    <Route path="/dashboard"   element={<Dashboard />} />
    <Route path="/test-config" element={<TestConfig />} />
    <Route path="/agents"      element={<AgentMonitor />} />
    <Route path="/analytics"   element={<Analytics />} />
    <Route path="/reports"     element={<Reports />} />
  </Routes>
</BrowserRouter>
```

React Router intercepts browser navigation. When you click a sidebar link, instead of fetching a new HTML page from the server, React Router swaps out the current component for the new one instantly. The URL changes in the browser bar, but no full page reload happens. This is called a Single Page Application (SPA).

### Data Fetching with TanStack Query

TanStack Query (formerly React Query) handles all data fetching:

```typescript
const { data: runs } = useQuery({
  queryKey: ['test-runs'], // cache key
  queryFn: () => fetch('/api/test-runs').then((r) => r.json()),
  refetchInterval: 5000, // re-fetch every 5 seconds
});
```

**What it does behind the scenes:**

1. On first render, fires the fetch, shows loading state
2. Caches the result under the key `['test-runs']`
3. Returns cached data instantly on subsequent renders
4. Re-fetches in the background every 5 seconds and updates if data changed
5. If you call `queryClient.invalidateQueries({ queryKey: ['test-runs'] })`, it immediately re-fetches

This is used on the Reports page so the history table refreshes after a run is deleted.

### Vite Proxy

In `vite.config.ts`:

```typescript
server: {
  proxy: {
    '/api': 'http://localhost:8080',
    '/ws': { target: 'ws://localhost:8080', ws: true }
  }
}
```

This means:

- When the frontend calls `/api/test-runs`, Vite forwards it to `http://localhost:8080/api/test-runs`
- When the frontend opens a WebSocket to `/ws/live-metrics`, Vite upgrades and forwards it to `ws://localhost:8080/ws/live-metrics`
- The browser only ever sees one origin (port 5000), avoiding CORS issues entirely

---

## 11. State Management

TrafficForge uses three levels of state:

### Level 1 — Server State (TanStack Query)

Data that lives in the database and is fetched over the network. Examples: list of test runs, test configs. TanStack Query owns all server state — it handles caching, refetching, and invalidation.

### Level 2 — Real-time State (WebSocket + React useState)

Data that streams from the backend every 500ms during a live test. The `useLiveData` hook owns this state. It uses `useState` internally and updates state on every WebSocket message.

### Level 3 — Local UI State (React useState)

Form inputs, toggle states, error messages that only exist in the UI. Examples: the URL field in TestConfig, whether the scan results panel is visible.

---

## 12. The useLiveData Hook — How the Dashboard Gets Live Data

This is the most complex piece of frontend code. It manages a persistent WebSocket connection with automatic reconnection.

```typescript
export function useLiveData(runId?: string | null) {
  const [stats, setStats] = useState({ activeAgents: 0, requestsPerSec: 0, ... });
  const [chartData, setChartData] = useState(/* 60 blank data points */);
  const [enriched, setEnriched] = useState(null);

  useEffect(() => {
    let ws: WebSocket;
    let reconnectAttempts = 0;

    const connect = () => {
      const url = `/ws/live-metrics${runId ? `?runId=${runId}` : ""}`;
      ws = new WebSocket(url);

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type !== "metrics") return;

        setStats(prev => ({ ...prev, ...msg.stats }));
        setChartData(prev => [...prev.slice(1), msg.chartPoint]); // rolling window
        setEnriched(msg.enriched);
        setActivities(prev => [...newItems, ...prev].slice(0, 40));
      };

      ws.onclose = () => {
        // Exponential backoff: 1s, 2s, 4s, 8s, 10s (max)
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
        setTimeout(connect, delay);
        reconnectAttempts++;
      };
    };

    connect();
    return () => ws.close(); // cleanup when component unmounts
  }, [runId]); // re-run effect when runId changes

  return { stats, chartData, enriched, activities };
}
```

**The rolling chart window:**
`setChartData(prev => [...prev.slice(1), msg.chartPoint])` — the chart always shows exactly 60 data points. Each new point shifts the array one position left, dropping the oldest point. This creates the scrolling live chart effect.

**Reconnect logic:**
If the WebSocket closes (network hiccup, server restart), the hook waits 1 second and tries again. If that fails, it waits 2 seconds, then 4, then 8, then 10 (capped). After 5 total attempts it stops trying. This prevents hammering a server that's down.

---

## 13. Complete Request Flow — From Click to Result

Here is the complete journey of a test run from start to finish:

### Stage 1 — Scan (2-5 seconds)

```
User enters URL → clicks "Scan Site"
    │
    ▼
POST /api/scan { url: "https://example.com", maxPages: 20 }
    │
    ▼
Backend: scanner.ts crawls the site page by page
    │  - BFS crawl with cheerio HTML parsing
    │  - Extracts paths, forms, clickable elements
    │  - Detects app type
    │
    ▼
Returns { pagesScanned: 10, discoveredPaths: [...], forms: {...}, ... }
    │
    ▼
Frontend: TestConfig renders scan results panel
    │  - Shows page count, discovered paths, form count
    │  - Fills in "Discovered Paths" field for the test engine
```

### Stage 2 — Create Config & Run (instant)

```
User configures settings → clicks "Start Test"
    │
    ▼
POST /api/test-configs { url, user_count, duration_sec, discovered_paths, ... }
    │  → INSERT into test_configs → returns { id: 3 }
    │
    ▼
POST /api/test-runs { config_id: 3 }
    │  → INSERT into test_runs with status="pending" → returns { id: "uuid" }
    │
    ▼
POST /api/test-runs/<uuid>/start
    │  → UPDATE test_runs SET status="running", started_at=now()
    │  → Adds to activeRuns Map
    │  → Spawns runRealLoadTestSession() as a background async task
    │  → Responds immediately with { status: "running" }
    │
    ▼
Frontend: redirects to /dashboard?runId=<uuid>
```

### Stage 3 — Live Test (duration seconds)

```
Dashboard component mounts
    │
    ▼
useLiveData("uuid") opens WebSocket to /ws/live-metrics?runId=uuid
    │
    ├── Backend: client registered in runClients Map
    │
    ▼ (every 500ms from backend)
loadEngine fires N concurrent HTTP requests per user loop
    │  - makeRequest() sends real HTTP fetch to target
    │  - Measures response time with performance.now()
    │  - Classifies errors: timeout, network, 4xx, 5xx
    │
    ▼
metricsLoop interval fires every 500ms
    │  - buildMetrics() calculates: error rate, avg response, percentiles, per-page stats
    │  - onMetrics() → broadcastToRun() → ws.send(JSON) to all connected clients
    │
    ▼
Frontend receives WebSocket message
    │  - setStats() → Dashboard re-renders live stat cards
    │  - setChartData() → Rolling chart updates
    │  - setActivities() → Activity feed shows new requests
```

### Stage 4 — Completion

```
All user loops finish (duration elapsed or aborted)
    │
    ▼
runRealLoadTestSession() finalizes:
    │  - Calculates final error rate, passed/failed status
    │  - UPDATE test_runs SET status="completed", total_requests, error_rate, p50_ms, ...
    │  - broadcastToRun() → sends final metrics snapshot with status="completed"
    │  - Removes run from activeRuns Map
    │
    ▼
Frontend receives final WebSocket message with status="completed"
    │  - Dashboard shows final numbers
    │  - User navigates to Analytics or Reports
```

### Stage 5 — Review

```
User navigates to /analytics
    │
    ▼
useQuery fetches GET /api/test-runs (last 50 runs)
    │  → SELECT * FROM test_runs ORDER BY created_at DESC LIMIT 50
    │
    ▼
Analytics picks the most recent completed run
    │  - Renders page traffic heatmap from page_metrics JSONB column
    │  - Renders error breakdown bar chart from error_breakdown JSONB column
    │  - Shows P50/P95/P99 from p50_ms, p95_ms, p99_ms columns
```

---

## 14. Middleware Explained

Middleware is any function that sits between the incoming request and the final route handler. Express middleware follows this signature:

```typescript
function myMiddleware(req, res, next) {
  // do something before the handler
  next(); // pass control to next middleware / handler
}
```

### pino-http (Logging Middleware)

Automatically attached to every request before your handlers run:

```
Request arrives: POST /api/scan
pino-http starts timer, attaches req.log
    → your handler runs, returns response
pino-http logs: { method: "POST", url: "/api/scan", statusCode: 200, responseTime: 342 }
```

Every route handler gets a `req.log` object (a child logger with the request ID) that you can use:

```typescript
req.log.error({ err }, 'Scanner error');
```

### cors() (CORS Middleware)

Without this, the browser blocks cross-origin API calls. The middleware adds response headers:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: Content-Type
```

### express.json() (Body Parser Middleware)

Reads the raw bytes of the request body, parses them as JSON, and puts the result on `req.body`. Without this, `req.body` would be `undefined`.

---

## 15. Error Handling Strategy

### Network Errors in the Load Engine

Every `makeRequest()` call is wrapped in try/catch. Network failures, DNS failures, and connection refused errors are caught and categorized as `errorType: "network"`. Timeouts are caught when the AbortController fires and categorized as `"timeout"`.

### Scanner Failure

If the scanner cannot reach the root page (`pagesScanned === 0`), it returns an `error` field. The router checks for this and responds with HTTP 502, which the frontend displays as a toast error to the user.

### Database Errors

All database operations are inside try/catch. If a DB call fails, the handler responds with HTTP 500 and logs the error with full details via `req.log.error`.

### Stale Runs on Restart

On startup, the server queries for all runs with `status = "running"` and marks them as `"interrupted"`. This prevents the UI from showing runs as permanently active after a server restart or crash.

### Nullable `passed` Column

The `passed` column in `test_runs` is a nullable boolean:

- `null` — the run was created but never started (no test happened)
- `true` — error rate was below the threshold (pass)
- `false` — error rate exceeded the threshold (fail)

The Reports component uses strict equality (`=== true`, `=== false`) to distinguish these three states and render "Pass", "Fail", or "N/A" accordingly.

### WebSocket Reconnection

The frontend's `useLiveData` hook reconnects automatically with exponential backoff if the WebSocket closes unexpectedly. Up to 5 attempts: 1s, 2s, 4s, 8s, 10s intervals.

---

## 16. Key Design Decisions

### Why UUIDs for test_runs but serial integers for test_configs?

`test_runs` uses UUID because the run ID is exposed in the URL (`/dashboard?runId=abc123`) and in WebSocket connections. UUIDs are unguessable — you can't enumerate other users' runs by incrementing a number. `test_configs` IDs are never exposed in URLs, so sequential integers are fine and simpler to work with.

### Why in-memory Maps for active runs instead of the database?

Active run state (abort controller, WebSocket clients) cannot be stored in a database — these are live Node.js objects. The database stores the persistent outcome. The Map stores the live machinery. They complement each other.

### Why a single WebSocket per run instead of one global WebSocket?

The `runClients` Map isolates clients by `runId`. If two users are watching two different test runs at the same time, each only receives updates for their own run. A single global WebSocket would mean broadcasting all runs' metrics to all connected clients.

### Why Drizzle ORM instead of Prisma or raw SQL?

Drizzle is schema-first in TypeScript — the schema definition and the TypeScript types are the same file. This means if you add a column to the schema, the TypeScript types update automatically. No code generation step needed. It's also significantly lighter than Prisma with less runtime overhead.

### Why Vite as the dev server instead of Create React App?

Vite is significantly faster at startup and hot module replacement. It uses native ES modules during development (no bundling required), making startup near-instant. It also has first-class proxy support for forwarding API and WebSocket calls to the backend.

### Why pnpm workspaces instead of separate repositories?

Having the database schema, backend, and frontend in one repository means:

- Schema changes immediately propagate to both apps
- One command (`pnpm install`) installs everything
- TypeScript types flow from DB schema → backend → shared packages → frontend
- No versioning coordination between repos

---
