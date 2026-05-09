/**
 * Unit tests for the Planner's markdown parser.
 *
 * The parser is pure (no LLM, no I/O) — perfect for fast deterministic tests.
 * We don't test the LLM call here; that's covered by integration tests
 * (which require a live API key and are gated behind env flags).
 */

import { describe, it, expect } from 'vitest';
import { parsePlanMarkdown } from '../multiAgent/plannerAgent.js';

describe('parsePlanMarkdown', () => {
  it('parses a navigate step', () => {
    const md = `
## Goal
Open homepage

## Steps
1. **Open the site** — \`action: navigate\` \`url: https://example.com\`
   Expected: Homepage loads
`;
    const steps = parsePlanMarkdown(md);
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toEqual({ type: 'navigate', url: 'https://example.com' });
    expect(steps[0].description).toBe('Open the site');
    expect(steps[0].expected).toBe('Homepage loads');
    expect(steps[0].index).toBe(0);
  });

  it('parses a click step with role and name', () => {
    const md = `
## Steps
1. **Click login** — \`action: click\` \`role: button\` \`name: Sign in\`
   Expected: Login modal opens
`;
    const steps = parsePlanMarkdown(md);
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toEqual({ type: 'click', role: 'button', name: 'Sign in' });
  });

  it('parses a fill step', () => {
    const md = `
## Steps
1. **Enter email** — \`action: fill\` \`role: textbox\` \`name: Email\` \`value: test@example.com\`
   Expected: Email accepted
`;
    const steps = parsePlanMarkdown(md);
    expect(steps[0].action).toEqual({
      type: 'fill',
      role: 'textbox',
      name: 'Email',
      value: 'test@example.com',
    });
  });

  it('parses an expect_text step', () => {
    const md = `
## Steps
1. **Verify welcome** — \`action: expect_text\` \`text: Welcome back\`
   Expected: User is logged in
`;
    const steps = parsePlanMarkdown(md);
    expect(steps[0].action).toEqual({ type: 'expect_text', text: 'Welcome back' });
  });

  it('parses an expect_url step', () => {
    const md = `
## Steps
1. **Verify URL** — \`action: expect_url\` \`pattern: /dashboard/\`
   Expected: Navigated to dashboard
`;
    const steps = parsePlanMarkdown(md);
    expect(steps[0].action).toEqual({ type: 'expect_url', pattern: '/dashboard/' });
  });

  it('parses a wait_ms step with integer arg', () => {
    const md = `
## Steps
1. **Pause** — \`action: wait_ms\` \`ms: 500\`
   Expected: Wait completes
`;
    const steps = parsePlanMarkdown(md);
    expect(steps[0].action).toEqual({ type: 'wait_ms', ms: 500 });
  });

  it('parses multiple steps in order with correct indices', () => {
    const md = `
## Steps
1. **Open** — \`action: navigate\` \`url: https://shop.example.com\`
   Expected: Home loads
2. **Click product** — \`action: click\` \`role: link\` \`name: View product\`
   Expected: Product page
3. **Add to cart** — \`action: click\` \`role: button\` \`name: Add to cart\`
   Expected: Cart updates
`;
    const steps = parsePlanMarkdown(md);
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(steps[1].action.type).toBe('click');
    expect(steps[2].action.type).toBe('click');
  });

  it('skips malformed steps without throwing', () => {
    const md = `
## Steps
1. **Valid** — \`action: navigate\` \`url: https://x.com\`
   Expected: ok
2. **Missing required arg** — \`action: click\` \`role: button\`
   Expected: this step has no name
3. **Unknown action type** — \`action: teleport\` \`coords: 1,2\`
   Expected: bad
4. **Another valid** — \`action: navigate\` \`url: https://y.com\`
   Expected: ok
`;
    const steps = parsePlanMarkdown(md);
    // Steps 2 and 3 should be dropped; 1 and 4 retained
    expect(steps).toHaveLength(2);
    expect(steps[0].action).toEqual({ type: 'navigate', url: 'https://x.com' });
    expect(steps[1].action).toEqual({ type: 'navigate', url: 'https://y.com' });
  });

  it('returns empty array when there is no Steps section', () => {
    const md = `
## Goal
Some goal

## Data Requirements
- Account credentials
`;
    expect(parsePlanMarkdown(md)).toEqual([]);
  });

  it('handles values containing colons (e.g. URLs)', () => {
    const md = `
## Steps
1. **Open** — \`action: navigate\` \`url: https://example.com:8080/path\`
   Expected: ok
`;
    const steps = parsePlanMarkdown(md);
    expect(steps[0].action).toEqual({
      type: 'navigate',
      url: 'https://example.com:8080/path',
    });
  });

  it('is case-insensitive for the Expected: line', () => {
    const md = `
## Steps
1. **Step** — \`action: navigate\` \`url: https://x.com\`
   expected: lowercase works
`;
    const steps = parsePlanMarkdown(md);
    expect(steps[0].expected).toBe('lowercase works');
  });
});
