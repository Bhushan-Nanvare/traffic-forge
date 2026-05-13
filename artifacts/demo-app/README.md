# Demo Chat App — Intentional Test Target

This is a **deliberately buggy** chat application used as a test target for TrafficForge.

## Intentional Bugs

This app contains four intentional bugs for the intelligent testing system to discover:

1. **Message Ordering Race Condition** — Messages sent close together can appear out of order
2. **Persistence Failure** — Messages sent within 500ms of refresh may be lost
3. **Real-time Sync Delay** — Cross-user message visibility takes 3 seconds
4. **Emoji Reaction Persistence** — Reactions may not persist across page reload

## Running Locally

```bash
pnpm install
pnpm run dev
```

The app runs on http://localhost:5173

## How TrafficForge Tests It

1. Scanner crawls the app and detects "chat" type
2. Planner generates concurrent chat scenarios
3. Multiple agents send messages simultaneously
4. Bug detector finds the four intentional bugs
5. Reporter analyzes them with Claude
