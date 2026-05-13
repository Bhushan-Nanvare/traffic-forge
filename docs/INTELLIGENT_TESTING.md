# Intelligent Testing — Overview

TrafficForge does more than just blast traffic at a server. It uses AI agents to
**actually test what the application does**.

## How It Works

```
Scanner -> Planner -> Executor -> Detector -> Reporter
```

1. **Scanner** crawls the URL and detects app type (chat, e-commerce, blog, SaaS)
2. **Planner** uses Claude to generate scenarios specific to that app type
3. **Executor** runs multiple agents concurrently, executing those scenarios
4. **Detector** analyzes agent events to find race conditions, sync issues, etc.
5. **Reporter** uses Claude to explain root causes and suggest fixes

## What Makes It Different

- **App-aware**: scenarios are tailored to the app type, not generic load patterns
- **Concurrent agents**: real bugs only appear with multiple users acting at once
- **Pattern matching**: domain-specific bug patterns for each app type
- **AI analysis**: Claude provides root cause and fix suggestions

## Quick Start

1. Configure target URL on /test-config
2. Click "Start Test"
3. Watch agents in real time on /dashboard
4. Review findings on /test-results
