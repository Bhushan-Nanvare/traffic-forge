/**
 * Unit tests for agentExecutor.ts — Agent class and EventLogger class.
 *
 * Strategy:
 *  - Create a plain mock Page object for each test instead of mocking the
 *    playwright module. Agent.execute() accepts a Page directly so no
 *    module-level mock is needed.
 *  - Assert on the returned AgentEvent shape: result, duration, errorMessage,
 *    screenshot (base64), and the cumulative events array.
 *  - The unknown-action path exercises the default branch via a type cast.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { Agent, EventLogger } from '../agentExecutor.js';
import type { AgentAction } from '../agentExecutor.js';

// ─── Mock Page Factory ────────────────────────────────────────────────────────

function makeMockPage(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): Page {
  const screenshotBuffer = Buffer.from('fake-png-data');

  return {
    goto: vi.fn().mockResolvedValue(null),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(null),
    screenshot: vi.fn().mockResolvedValue(screenshotBuffer),
    close: vi.fn().mockResolvedValue(undefined),
    context: vi.fn(),
    ...overrides,
  } as unknown as Page;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Agent', () => {
  describe('construction', () => {
    it('initialises with empty events and correct identity', () => {
      const agent = new Agent('agent-1', 'chatter');
      expect(agent.id).toBe('agent-1');
      expect(agent.role).toBe('chatter');
      expect(agent.events).toHaveLength(0);
      expect(agent.hasFailures()).toBe(false);
    });
  });

  describe('execute — navigate action', () => {
    it('calls page.goto with the correct URL and marks result as success', async () => {
      const page = makeMockPage();
      const agent = new Agent('a1', 'monitor');

      const action: AgentAction = { type: 'navigate', url: 'https://example.com' };
      const events = await agent.execute(page, [action]);

      expect(page.goto).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({ waitUntil: 'networkidle' }),
      );
      expect(events).toHaveLength(1);
      expect(events[0].result).toBe('success');
      expect(events[0].action).toBe(action);
    });

    it('updates agent state currentUrl after navigation', async () => {
      const page = makeMockPage();
      const agent = new Agent('a1', 'monitor');

      await agent.execute(page, [{ type: 'navigate', url: 'https://target.io' }]);
      expect(agent.state.currentUrl).toBe('https://target.io');
    });
  });

  describe('execute — click action', () => {
    it('calls page.click with the correct selector', async () => {
      const page = makeMockPage();
      const agent = new Agent('a2', 'chatter');

      const events = await agent.execute(page, [
        { type: 'click', selector: 'button.submit', timeout: 3000 },
      ]);

      expect(page.click).toHaveBeenCalledWith('button.submit', { timeout: 3000 });
      expect(events[0].result).toBe('success');
    });

    it('uses default timeout 5000 when action.timeout is not set', async () => {
      const page = makeMockPage();
      const agent = new Agent('a2', 'chatter');

      await agent.execute(page, [{ type: 'click', selector: '#btn' }]);
      expect(page.click).toHaveBeenCalledWith('#btn', { timeout: 5000 });
    });
  });

  describe('execute — fill action', () => {
    it('calls page.fill with selector and text', async () => {
      const page = makeMockPage();
      const agent = new Agent('a3', 'commenter');

      await agent.execute(page, [
        { type: 'fill', selector: 'input[name=email]', text: 'user@example.com' },
      ]);

      expect(page.fill).toHaveBeenCalledWith('input[name=email]', 'user@example.com', {
        timeout: 5000,
      });
    });

    it('fills empty string when action.text is not provided', async () => {
      const page = makeMockPage();
      const agent = new Agent('a3', 'commenter');

      await agent.execute(page, [{ type: 'fill', selector: 'input' }]);
      expect(page.fill).toHaveBeenCalledWith('input', '', { timeout: 5000 });
    });
  });

  describe('execute — wait action', () => {
    it('calls page.waitForTimeout with the given delay', async () => {
      const page = makeMockPage();
      const agent = new Agent('a4', 'monitor');

      const events = await agent.execute(page, [{ type: 'wait', timeout: 2000 }]);

      expect(page.waitForTimeout).toHaveBeenCalledWith(2000);
      expect(events[0].result).toBe('success');
    });

    it('defaults to 1000ms when timeout is not provided', async () => {
      const page = makeMockPage();
      const agent = new Agent('a4', 'monitor');

      await agent.execute(page, [{ type: 'wait' }]);
      expect(page.waitForTimeout).toHaveBeenCalledWith(1000);
    });
  });

  describe('execute — verify action', () => {
    it('calls page.waitForSelector with the assertion selector', async () => {
      const page = makeMockPage();
      const agent = new Agent('a5', 'chatter');

      const events = await agent.execute(page, [
        { type: 'verify', assertion: '.success-banner', timeout: 4000 },
      ]);

      expect(page.waitForSelector).toHaveBeenCalledWith('.success-banner', { timeout: 4000 });
      expect(events[0].result).toBe('success');
    });
  });

  describe('execute — screenshot action', () => {
    it('captures a screenshot and stores it as base64 in the event', async () => {
      const fakeBuffer = Buffer.from('png-bytes');
      const page = makeMockPage({
        screenshot: vi.fn().mockResolvedValue(fakeBuffer),
      });
      const agent = new Agent('a6', 'monitor');

      const events = await agent.execute(page, [{ type: 'screenshot' }]);

      expect(page.screenshot).toHaveBeenCalled();
      expect(events[0].screenshot).toBe(fakeBuffer.toString('base64'));
      expect(events[0].result).toBe('success');
    });
  });

  describe('execute — error handling', () => {
    it('records result as timeout and stores errorMessage when action times out', async () => {
      const page = makeMockPage({
        goto: vi.fn().mockRejectedValue(new Error('Navigation timeout')),
      });
      // Disable retries so the test sees the first failure directly
      const agent = new Agent('a7', 'monitor', { options: { maxRetriesPerAction: 0 } });

      const events = await agent.execute(page, [{ type: 'navigate', url: 'https://slow.site' }]);

      // New executor distinguishes timeout from generic failure
      expect(events[0].result).toBe('timeout');
      expect(events[0].errorMessage).toMatch(/Navigation timeout/);
      expect(events[0].errorCode).toBe('TIMEOUT');
    });

    it('attempts a fallback screenshot on failure', async () => {
      const page = makeMockPage({
        click: vi.fn().mockRejectedValue(new Error('Element not found')),
      });
      const agent = new Agent('a7', 'monitor');

      const events = await agent.execute(page, [{ type: 'click', selector: '#gone' }]);

      expect(events[0].result).toBe('failed');
      // screenshot is called for the failure capture
      expect(page.screenshot).toHaveBeenCalled();
    });

    it('continues executing remaining actions after a failure', async () => {
      const page = makeMockPage({
        goto: vi.fn().mockRejectedValue(new Error('fail')),
      });
      const agent = new Agent('a8', 'chatter');

      const events = await agent.execute(page, [
        { type: 'navigate', url: 'https://fail.io' },
        { type: 'wait', timeout: 100 },
      ]);

      expect(events).toHaveLength(2);
      expect(events[0].result).toBe('failed');
      expect(events[1].result).toBe('success');
    });

    it('records an unknown action type as failed with an error message', async () => {
      const page = makeMockPage();
      const agent = new Agent('a9', 'monitor');

      // Cast to bypass TypeScript — exercises the `default` branch.
      const action = { type: 'fly' } as unknown as AgentAction;
      const events = await agent.execute(page, [action]);

      expect(events[0].result).toBe('failed');
      expect(events[0].errorMessage).toMatch(/fly/i);
    });
  });

  describe('event accumulation', () => {
    it('accumulates events across multiple execute calls', async () => {
      const page = makeMockPage();
      const agent = new Agent('a10', 'chatter');

      await agent.execute(page, [{ type: 'wait', timeout: 0 }]);
      await agent.execute(page, [{ type: 'wait', timeout: 0 }]);

      expect(agent.getAllEvents()).toHaveLength(2);
    });

    it('each event records a non-negative duration', async () => {
      const page = makeMockPage();
      const agent = new Agent('a11', 'monitor');

      const events = await agent.execute(page, [
        { type: 'navigate', url: 'https://x.com' },
        { type: 'click', selector: '#btn' },
      ]);

      for (const e of events) {
        expect(e.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it('each event has a timestamp close to Date.now()', async () => {
      const before = Date.now();
      const page = makeMockPage();
      const agent = new Agent('a12', 'monitor');

      const events = await agent.execute(page, [{ type: 'wait', timeout: 0 }]);
      const after = Date.now();

      expect(events[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(events[0].timestamp).toBeLessThanOrEqual(after + 50);
    });
  });

  describe('helpers', () => {
    it('getLastEvent returns the most recently executed event', async () => {
      const page = makeMockPage();
      const agent = new Agent('a13', 'monitor');

      await agent.execute(page, [{ type: 'wait', timeout: 0 }, { type: 'screenshot' }]);

      expect(agent.getLastEvent()?.action.type).toBe('screenshot');
    });

    it('hasFailures returns false when all actions succeed', async () => {
      const page = makeMockPage();
      const agent = new Agent('a14', 'chatter');

      await agent.execute(page, [{ type: 'wait', timeout: 0 }]);
      expect(agent.hasFailures()).toBe(false);
    });

    it('hasFailures returns true when at least one action fails', async () => {
      const page = makeMockPage({
        goto: vi.fn().mockRejectedValue(new Error('boom')),
      });
      const agent = new Agent('a15', 'chatter');

      await agent.execute(page, [{ type: 'navigate', url: 'https://fail.io' }]);
      expect(agent.hasFailures()).toBe(true);
    });

    it('clearEvents empties the events array', async () => {
      const page = makeMockPage();
      const agent = new Agent('a16', 'monitor');

      await agent.execute(page, [{ type: 'wait', timeout: 0 }]);
      agent.clearEvents();

      expect(agent.getAllEvents()).toHaveLength(0);
      expect(agent.getLastEvent()).toBeUndefined();
    });
  });
});

// ─── EventLogger ──────────────────────────────────────────────────────────────

describe('EventLogger', () => {
  it('starts with an empty event list', () => {
    const logger = new EventLogger();
    expect(logger.getAllEvents()).toHaveLength(0);
  });

  it('logEvent appends a single event', () => {
    const logger = new EventLogger();
    const event = {
      timestamp: Date.now(),
      action: { type: 'wait' as const },
      result: 'success' as const,
      duration: 10,
    };
    logger.logEvent(event);
    expect(logger.getAllEvents()).toHaveLength(1);
    expect(logger.getAllEvents()[0]).toBe(event);
  });

  it('logEvents appends multiple events at once', () => {
    const logger = new EventLogger();
    const events = [
      { timestamp: 1, action: { type: 'wait' as const }, result: 'success' as const, duration: 1 },
      { timestamp: 2, action: { type: 'click' as const }, result: 'failed' as const, duration: 2 },
    ];
    logger.logEvents(events);
    expect(logger.getAllEvents()).toHaveLength(2);
  });

  it('clear empties all stored events', () => {
    const logger = new EventLogger();
    logger.logEvent({
      timestamp: Date.now(),
      action: { type: 'wait' as const },
      result: 'success' as const,
      duration: 5,
    });
    logger.clear();
    expect(logger.getAllEvents()).toHaveLength(0);
  });

  it('accumulated events from multiple logEvent calls are all returned', () => {
    const logger = new EventLogger();
    for (let i = 0; i < 5; i++) {
      logger.logEvent({
        timestamp: i,
        action: { type: 'wait' as const },
        result: 'success' as const,
        duration: i,
      });
    }
    expect(logger.getAllEvents()).toHaveLength(5);
  });
});
