/**
 * Integration tests for scanner.ts.
 *
 * These tests stub `global.fetch` with controlled HTML fixtures so we can
 * exercise the full BFS + Cheerio parsing pipeline without making real
 * network requests. Every public behavior of `scanUrl` is asserted, including
 * error paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanUrl } from '../scanner.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

interface FixtureResponse {
  html: string;
  status?: number;
  contentType?: string;
}

function htmlResponse(body: string, init: Partial<FixtureResponse> = {}): Response {
  const status = init.status ?? 200;
  const contentType = init.contentType ?? 'text/html; charset=utf-8';
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      server: 'nginx/1.21.0',
      'x-powered-by': 'Express',
    },
  });
}

type FetchInput = URL | string | { toString(): string };

function buildFetchMock(routes: Record<string, FixtureResponse | (() => never)>) {
  return vi.fn(async (input: FetchInput) => {
    const urlString = typeof input === 'string' ? input : input.toString();
    const url = new URL(urlString);
    const key = url.pathname;
    const route = routes[key] ?? routes['*'];
    if (!route) {
      throw new TypeError(`No fetch fixture for ${key}`);
    }
    if (typeof route === 'function') {
      route();
      // Unreachable: route() is typed as `() => never`. This satisfies the compiler.
      throw new Error('unreachable');
    }
    return htmlResponse(route.html, route);
  });
}

// ─── Test Fixtures ────────────────────────────────────────────────────────

const ROOT_HTML_NEXT_ECOMMERCE = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <title>Acme Shop</title>
    <script src="/_next/static/chunks/main.js"></script>
    <meta name="generator" content="Next.js" />
  </head>
  <body>
    <div id="__NEXT_DATA__">{}</div>
    <nav>
      <a href="/products">Products</a>
      <a href="/cart">Cart</a>
      <a href="https://external.example.com/away">External</a>
      <a href="/styles.css">Styles asset (should be skipped)</a>
      <a href="#anchor">Anchor only</a>
    </nav>
    <main class="product-grid">
      <button class="add-to-cart">Add to cart</button>
      <button class="checkout">Checkout</button>
    </main>
    <form action="/login" method="post">
      <input type="email" name="email" />
      <input type="password" name="password" />
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>
`;

const PRODUCTS_PAGE = `
<!DOCTYPE html>
<html><body>
  <h1>Products</h1>
  <a href="/products/widget">Widget</a>
  <form>
    <input type="search" name="q" placeholder="Search products" />
  </form>
</body></html>
`;

const CART_PAGE = `
<!DOCTYPE html>
<html><body>
  <h1>Cart</h1>
  <form action="/checkout">
    <input type="text" name="cardNumber" placeholder="Card number" />
    <button>Checkout</button>
  </form>
</body></html>
`;

// ─── Test Setup ───────────────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe('scanUrl', () => {
  describe('happy paths', () => {
    it('returns a ScanResult with discovered paths after BFS crawl', async () => {
      const mock = buildFetchMock({
        '/': { html: ROOT_HTML_NEXT_ECOMMERCE },
        '/products': { html: PRODUCTS_PAGE },
        '/cart': { html: CART_PAGE },
        '/products/widget': { html: '<html><body>Widget</body></html>' },
      });
      globalThis.fetch = mock as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://shop.example.com', 10);

      expect(result.error).toBeUndefined();
      expect(result.url).toBe('https://shop.example.com');
      expect(result.pagesScanned).toBeGreaterThanOrEqual(3);
      expect(result.discoveredPaths).toEqual(expect.arrayContaining(['/', '/products', '/cart']));
      expect(result.statusCode).toBe(200);
    });

    it('detects Next.js framework from script srcs and __NEXT_DATA__', async () => {
      const mock = buildFetchMock({
        '/': { html: ROOT_HTML_NEXT_ECOMMERCE },
        '*': { html: '<html><body>noop</body></html>' },
      });
      globalThis.fetch = mock as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://shop.example.com', 1);

      expect(result.appType.framework).toBe('Next.js');
    });

    it('detects e-commerce app type from cart/product class signatures', async () => {
      const mock = buildFetchMock({
        '/': { html: ROOT_HTML_NEXT_ECOMMERCE },
        '*': { html: '<html><body>noop</body></html>' },
      });
      globalThis.fetch = mock as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://shop.example.com', 1);

      expect(result.appType.detectedType).toBe('ecommerce');
      expect(result.appType.confidence).toBeGreaterThan(0.5);
    });

    it('classifies login form by password input + sign-in text', async () => {
      const mock = buildFetchMock({
        '/': { html: ROOT_HTML_NEXT_ECOMMERCE },
        '*': { html: '<html><body>noop</body></html>' },
      });
      globalThis.fetch = mock as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://shop.example.com', 1);

      expect(result.forms.types).toMatchObject({ login: 1 });
      expect(result.forms.details[0]?.method).toBe('POST');
    });

    it('classifies search form by input[type=search]', async () => {
      const mock = buildFetchMock({
        '/': {
          html: '<html><body><a href="/p">P</a></body></html>',
        },
        '/p': { html: PRODUCTS_PAGE },
      });
      globalThis.fetch = mock as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://shop.example.com', 5);

      expect(result.forms.types.search).toBe(1);
    });

    it('extracts clickable buttons up to the configured cap', async () => {
      const mock = buildFetchMock({
        '/': { html: ROOT_HTML_NEXT_ECOMMERCE },
        '*': { html: '<html><body>noop</body></html>' },
      });
      globalThis.fetch = mock as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://shop.example.com', 1);

      expect(result.clickableElements.length).toBeGreaterThan(0);
      expect(result.clickableElements.length).toBeLessThanOrEqual(30);
      expect(result.clickableElements.some((b) => /add to cart/i.test(b.text))).toBe(true);
    });

    it('respects maxPages cap during BFS', async () => {
      // root links to many internal paths; we should stop at maxPages.
      const links = Array.from({ length: 20 }, (_, i) => `<a href="/p${i}">${i}</a>`).join('');
      const root = `<html><body>${links}</body></html>`;
      const routes: Record<string, FixtureResponse> = { '/': { html: root } };
      for (let i = 0; i < 20; i++) {
        routes[`/p${i}`] = { html: '<html><body>page</body></html>' };
      }
      globalThis.fetch = buildFetchMock(routes) as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://shop.example.com', 5);

      expect(result.pagesScanned).toBe(5);
    });

    it('skips static assets and external links during link discovery', async () => {
      globalThis.fetch = buildFetchMock({
        '/': { html: ROOT_HTML_NEXT_ECOMMERCE },
        '/products': { html: PRODUCTS_PAGE },
        '/cart': { html: CART_PAGE },
        '*': { html: '<html><body>noop</body></html>' },
      }) as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://shop.example.com', 10);

      expect(result.discoveredPaths).not.toContain('/styles.css');
      expect(result.discoveredPaths.every((p) => !p.startsWith('http'))).toBe(true);
    });

    it('captures meaningful response headers from the root response', async () => {
      globalThis.fetch = buildFetchMock({
        '/': { html: ROOT_HTML_NEXT_ECOMMERCE },
        '*': { html: '<html><body>noop</body></html>' },
      }) as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://shop.example.com', 1);

      expect(result.headers).toMatchObject({
        server: 'nginx/1.21.0',
        'x-powered-by': 'Express',
      });
    });
  });

  describe('error paths', () => {
    it('returns a structured error for an invalid URL', async () => {
      const result = await scanUrl('not-a-valid-url');

      expect(result.error).toBe('Invalid URL format');
      expect(result.pagesScanned).toBe(0);
      expect(result.statusCode).toBe(0);
    });

    it('returns a structured error when the root page is unreachable', async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new TypeError('Network error');
      }) as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://broken.example.com');

      expect(result.error).toMatch(/could not reach/i);
      expect(result.pagesScanned).toBe(0);
    });

    it('returns a structured error when the root response is not HTML', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response('not html', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ) as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://api.example.com');

      expect(result.error).toBeDefined();
      expect(result.pagesScanned).toBe(0);
    });

    it('returns a structured error when the root returns 4xx/5xx', async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response('not found', {
            status: 404,
            headers: { 'content-type': 'text/html' },
          }),
      ) as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://missing.example.com');

      expect(result.error).toBeDefined();
      expect(result.pagesScanned).toBe(0);
    });
  });

  describe('suggestedBehaviors', () => {
    it('always includes a baseline "load test" behavior', async () => {
      globalThis.fetch = buildFetchMock({
        '/': { html: ROOT_HTML_NEXT_ECOMMERCE },
        '*': { html: '<html><body>noop</body></html>' },
      }) as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://shop.example.com', 1);

      expect(result.suggestedBehaviors[0]?.description).toMatch(/load test/i);
    });

    it('includes a login-stress suggestion when a login form is found', async () => {
      globalThis.fetch = buildFetchMock({
        '/': { html: ROOT_HTML_NEXT_ECOMMERCE },
        '*': { html: '<html><body>noop</body></html>' },
      }) as unknown as typeof globalThis.fetch;

      const result = await scanUrl('https://shop.example.com', 1);

      expect(result.suggestedBehaviors.some((b) => /login/i.test(b.description))).toBe(true);
    });
  });
});
