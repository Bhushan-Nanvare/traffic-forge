# System Architecture

## High Level

```
+--------+    +-----------+    +-----------+    +----------+    +----------+
| Scanner| -> | Planner   | -> | Executor  | -> | Detector | -> | Reporter |
+--------+    +-----------+    +-----------+    +----------+    +----------+
   HTTP         Claude          Playwright       Heuristics      Claude
   Cheerio                      BrowserPool      + Patterns
```

## Component Responsibilities

### Scanner (engine/scanner.ts)

- BFS crawl of URL
- HTML parsing with Cheerio
- App type detection
- Form classification

### Planner (engine/planner.ts)

- Reads scanner output
- Calls Claude for scenario generation
- Falls back to templates if no API key

### Executor (engine/agentExecutor.ts)

- Manages Agent class
- Executes actions via Playwright
- Logs all events with timestamps

### Bug Detector (engine/bugDetector.ts)

- Detects race conditions, persistence, sync issues
- Pluggable pattern system
- Confidence scoring

### Reporter (engine/reporter.ts)

- Calls Claude for root cause analysis
- Generates structured report
- Provides fix suggestions

## Data Flow

State flows through the orchestrator as `OrchestratorState`:

1. `{ url, status: 'pending' }` -> Planner
2. `{ ..., scenarios }` -> Executor
3. `{ ..., events }` -> Detector
4. `{ ..., bugs }` -> Reporter
5. `{ ..., report, status: 'complete' }`
