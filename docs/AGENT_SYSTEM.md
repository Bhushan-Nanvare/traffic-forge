# Agent System

Agents are autonomous virtual users that execute test scenarios.

## Agent Roles

- **chatter**: actively interacts (sends messages, fills forms)
- **commenter**: responds to others' actions
- **monitor**: observes without interacting

## Action Types

- `navigate` - go to a URL
- `click` - click a selector
- `fill` - fill an input
- `wait` - delay
- `verify` - check assertion
- `screenshot` - capture screen

## Event Logging

Every action produces an `AgentEvent` with timestamp, duration, and result.
The `EventLogger` aggregates events for downstream analysis.

## Browser Pool

Agents share a `BrowserPool` to amortize Playwright launch costs.
Each pool can host up to 50 browsers, each with multiple contexts.
