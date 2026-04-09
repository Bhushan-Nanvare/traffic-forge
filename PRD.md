# Product Requirements Document (PRD)
# TrafficForge AI — Load Testing & Traffic Simulation Platform

**Version:** 1.0  
**Date:** April 2026  
**Status:** Active Development

---

## 1. Product Overview

TrafficForge AI is an AI-powered load testing and traffic simulation platform. It allows developers, QA engineers, and DevOps teams to simulate real human behavior on any website by deploying up to 1,000 virtual agents simultaneously. Unlike traditional load testing tools that fire raw HTTP requests with no intelligence, TrafficForge scans the target website first, understands its structure, and then simulates realistic user journeys across discovered pages.

The platform operates in two modes:
- **HTTP Mode** — fires real HTTP requests from virtual user agents concurrently
- **Browser Mode** — launches headless Playwright browsers that simulate actual user interactions (clicks, form fills, navigation)
- **Both Mode** — runs both engines simultaneously for maximum coverage

---

## 2. Problem Statement

Existing load testing tools (JMeter, k6, Locust) require manual scripting, technical configuration, and significant setup time. Teams often skip load testing entirely because the barrier to entry is too high. This results in:

- Production outages when sites hit unexpected traffic spikes
- No visibility into per-page performance degradation
- No simulation of realistic user behavior (random clicking, browsing patterns)
- No automatic detection of which pages are most vulnerable under load

**TrafficForge solves this** by requiring only a URL as input. The rest is automated.

---

## 3. Target Users

| User Type | Pain Point Solved |
|---|---|
| Frontend/Backend Developers | Quickly stress-test a feature before deploy |
| QA Engineers | Automate load test scenarios without scripting |
| DevOps/SRE Teams | Baseline performance metrics for SLOs |
| Startup CTOs | Confirm infrastructure can handle launch traffic |

---

## 4. Core Features

### 4.1 Site Scanner
- Automatically crawls the target URL up to a configurable page limit (max 30)
- Discovers all internal links and page paths
- Detects forms, clickable elements, buttons
- Identifies app type (e-commerce, SaaS, blog, CMS, etc.)
- Measures real response times and HTTP status codes
- Returns suggested load testing behaviors based on discovered content
- Returns a clear error if the target site is unreachable

### 4.2 Test Configuration
- Target URL input
- Virtual user count (HTTP agents: 1–1000, Browser agents: 1–50)
- Test duration in seconds
- Ramp-up period (gradual start to simulate organic traffic growth)
- Test mode: HTTP / Browser / Both
- Persona selector (Power User, Casual Browser, Bot-like)
- Shadow mode (test without affecting analytics)
- Respect rate limits toggle
- Auto-stop threshold (automatically abort if error rate exceeds X%)
- Optional login credentials for authenticated testing

### 4.3 Live Dashboard (Mission Control)
- Real-time display of active virtual agents
- Live requests/second counter
- Live error rate percentage
- Live average response time
- CPU load and heap memory usage of the test server
- In-flight request counter
- Live scrolling response time chart (60-point rolling window)
- Live activity feed showing individual agent actions (page visited, status code, response time)
- Emergency stop button

### 4.4 Agent Monitor
- Per-agent view of what each virtual user is doing
- Real-time action log per agent

### 4.5 Analytics (Post-Run)
- Page traffic heatmap showing which pages received the most hits
- Response time chart (historical)
- Latency percentiles: P50, P95, P99
- Error breakdown by type (timeout, network, HTTP 4xx, HTTP 5xx)
- Summary stats: total completed requests, total failed, error rate, test duration

### 4.6 Reports (History)
- Table of all past test runs
- Per-run: date, duration, user count, error rate, pass/fail status
- Only completed runs are shown (no orphan/pending entries)
- Export to PDF
- Per-run cleanup (delete run and associated config)

---

## 5. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Performance | Support up to 1,000 concurrent virtual HTTP agents |
| Realtime | WebSocket metrics updates every 500ms during a live test |
| Persistence | All test configs and results persisted to PostgreSQL |
| Reliability | Stale "running" runs auto-recovered to "interrupted" on server restart |
| Accuracy | All metrics (response times, error rates, percentiles) calculated from real HTTP responses |
| Scalability | Monorepo structure supports independent scaling of frontend and backend |
| Resilience | WebSocket client reconnects with exponential backoff (max 5 attempts) |

---

## 6. User Flows

### Primary Flow — Run a Load Test
1. User visits Overview page → clicks "Start Testing"
2. User goes to Test Config → enters target URL
3. User clicks "Scan Site" → scanner crawls the site and auto-fills discovered paths
4. User configures virtual user count, duration, mode, and other settings
5. User clicks "Start Test" → backend creates a test config and test run record in DB
6. Frontend redirects to Dashboard (`/dashboard?runId=<id>`)
7. Dashboard connects to WebSocket and streams live metrics every 500ms
8. Test completes (or user clicks Emergency Stop)
9. User navigates to Analytics to review post-run breakdown
10. User navigates to Reports to see historical run history

### Secondary Flow — View History
1. User goes to Reports
2. Sees table of all completed/cancelled/interrupted test runs
3. Clicks on a run to see details
4. Optionally exports to PDF or deletes the run

---

## 7. Pages & Navigation

| Route | Page | Purpose |
|---|---|---|
| `/` | Overview | Landing page, platform intro, quick start |
| `/dashboard` | Mission Control | Live metrics during an active test |
| `/test-config` | Test Config | Configure and launch a test |
| `/agents` | Agent Monitor | Per-agent activity viewer |
| `/analytics` | Analytics | Post-run performance breakdown |
| `/reports` | Reports | Historical test run table |

---

## 8. API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Server health check |
| GET | `/api/active-runs` | List currently running tests |
| POST | `/api/scan` | Scan a target URL |
| POST | `/api/test-configs` | Create a test configuration |
| POST | `/api/test-runs` | Create a test run record |
| GET | `/api/test-runs` | List all test runs (last 50) |
| GET | `/api/test-runs/:id` | Get a specific test run |
| POST | `/api/test-runs/:id/start` | Start a test run |
| POST | `/api/test-runs/:id/stop` | Emergency stop a test run |
| POST | `/api/test-runs/:id/cleanup` | Delete run + config from DB |
| WS | `/ws/live-metrics?runId=<id>` | WebSocket stream for live metrics |

---

## 9. Data Model

### test_configs
Stores the configuration for a test before and after it runs.

| Column | Type | Description |
|---|---|---|
| id | serial (PK) | Auto-incrementing integer |
| url | text | Target URL |
| user_count | integer | Number of HTTP virtual users |
| duration_sec | integer | Test duration in seconds |
| ramp_up_sec | integer | Ramp-up period in seconds |
| app_type | text | Detected app type |
| persona | text | User behavior persona |
| shadow_mode | boolean | Whether to suppress analytics impact |
| respect_rate_limits | boolean | Polite vs aggressive mode |
| auto_stop_error_threshold | integer | % error rate to trigger auto-stop |
| discovered_paths | jsonb | Array of paths found by scanner |
| test_mode | text | "http", "browser", or "both" |
| browser_user_count | integer | Number of browser (Playwright) agents |
| browser_duration_sec | integer | Browser test duration |
| browser_ramp_up_sec | integer | Browser ramp-up period |
| login_username | text | Optional login credential |
| login_password | text | Optional login credential |
| created_at | timestamp | Creation time |

### test_runs
Stores the result of each test execution.

| Column | Type | Description |
|---|---|---|
| id | text (PK) | UUID generated at creation |
| config_id | integer (FK) | References test_configs.id |
| status | text | pending / running / completed / cancelled / interrupted |
| total_requests | integer | Total HTTP requests fired |
| error_rate | real | Overall error percentage |
| avg_response_ms | real | Average response time in ms |
| p50_ms | integer | 50th percentile response time |
| p95_ms | integer | 95th percentile response time |
| p99_ms | integer | 99th percentile response time |
| passed | boolean (nullable) | null=never ran, true=pass, false=fail |
| user_count | integer | Actual number of users used |
| started_at | timestamp | When the test began |
| ended_at | timestamp | When the test finished |
| created_at | timestamp | When the record was created |
| page_metrics | jsonb | Per-page { count, avgMs, errors } |
| error_breakdown | jsonb | Error counts by type |

---

## 10. Metrics Definitions

| Metric | Definition |
|---|---|
| P50 (Median) | 50% of requests completed faster than this value |
| P95 | 95% of requests completed faster than this value — represents the "slow users" |
| P99 | 99% of requests completed faster than this value — represents the worst case |
| Error Rate | (failed requests / total requests) × 100 |
| Requests/sec | Total requests fired / elapsed seconds |
| Ramp-up | Staggered start where each new user begins after an equal interval |

---

## 11. Out of Scope (v1.0)

- User authentication / multi-tenancy
- Distributed load generation (multi-node)
- Scheduled / recurring tests
- Slack / email alerting on test completion
- Custom scripting for user journeys
- Geographic traffic simulation
- CI/CD pipeline integration (GitHub Actions, etc.)

---

## 12. Success Metrics

- A user can go from "entering a URL" to "viewing live load test results" in under 2 minutes
- The platform accurately measures and reports P50/P95/P99 latencies from real HTTP responses
- Zero orphan/stuck runs shown in Reports after server restarts
- Scanner correctly identifies unreachable sites and surfaces a clear error message
- Error rate auto-stop correctly terminates tests before they overwhelm a target

---
