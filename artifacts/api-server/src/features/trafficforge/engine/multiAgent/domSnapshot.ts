/**
 * DOM Snapshot — navigates to a URL headlessly and extracts every interactive
 * element with its actual ARIA role + accessible name + CSS selector.
 *
 * Passed to the Planner so it generates locators that match the real page
 * instead of guessing from training data.
 */

import { chromium } from 'playwright';
import { logger } from '../../../../shared/lib/logger.js';

export interface DomElement {
  role: string;
  name: string;
  selector: string;
  tag: string;
}

export async function captureDomSnapshot(
  url: string,
  timeoutMs = 18_000,
): Promise<DomElement[]> {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Let JS hydrate
    await page.waitForTimeout(1500);

    const elements: DomElement[] = await page.evaluate(() => {
      const results: Array<{ role: string; name: string; selector: string; tag: string }> = [];

      function getAccessibleName(el: Element): string {
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel?.trim()) return ariaLabel.trim();

        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
          const ref = document.getElementById(labelledBy);
          if (ref?.textContent?.trim()) return ref.textContent.trim();
        }

        const id = el.getAttribute('id');
        if (id) {
          const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (label?.textContent?.trim()) return label.textContent.trim();
        }

        const placeholder = el.getAttribute('placeholder');
        if (placeholder?.trim()) return placeholder.trim();

        const title = el.getAttribute('title');
        if (title?.trim()) return title.trim();

        const text = (el as HTMLElement).innerText?.trim();
        if (text && text.length < 80) return text;

        return '';
      }

      function getSelector(el: Element): string {
        const id = el.getAttribute('id');
        if (id) return `#${id}`;
        const tag = el.tagName.toLowerCase();
        const cls = Array.from(el.classList)
          .filter((c) => !/^(active|disabled|selected|open|show|hide|is-)/.test(c))
          .slice(0, 2)
          .join('.');
        return cls ? `${tag}.${cls}` : tag;
      }

      // ── Inputs ──────────────────────────────────────────────────────────────
      document
        .querySelectorAll<HTMLInputElement>(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"])',
        )
        .forEach((el) => {
          const type = el.getAttribute('type') ?? 'text';
          const role = type === 'search' ? 'searchbox' : 'textbox';
          const name = getAccessibleName(el);
          results.push({ role, name: name || type, selector: getSelector(el), tag: 'input' });
        });

      // ── Buttons ──────────────────────────────────────────────────────────────
      document.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"], input[type="reset"]').forEach((el) => {
        const name = getAccessibleName(el);
        if (name) results.push({ role: 'button', name, selector: getSelector(el), tag: 'button' });
      });

      // ── Links (capped at 25) ─────────────────────────────────────────────────
      Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
        .slice(0, 25)
        .forEach((el) => {
          const name = getAccessibleName(el);
          if (name && name.length < 60) {
            results.push({ role: 'link', name, selector: getSelector(el), tag: 'a' });
          }
        });

      // ── Selects ───────────────────────────────────────────────────────────────
      document.querySelectorAll<HTMLSelectElement>('select').forEach((el) => {
        const name = getAccessibleName(el);
        results.push({ role: 'combobox', name: name || 'select', selector: getSelector(el), tag: 'select' });
      });

      // ── Textareas ─────────────────────────────────────────────────────────────
      document.querySelectorAll<HTMLTextAreaElement>('textarea').forEach((el) => {
        const name = getAccessibleName(el);
        results.push({ role: 'textbox', name: name || 'textarea', selector: getSelector(el), tag: 'textarea' });
      });

      // Deduplicate by selector
      const seen = new Set<string>();
      return results.filter((r) => {
        if (seen.has(r.selector)) return false;
        seen.add(r.selector);
        return true;
      }).slice(0, 60);
    });

    logger.info({ url, count: elements.length }, 'DOM snapshot captured');
    return elements;
  } catch (err) {
    logger.warn({ err, url }, 'DOM snapshot failed — planner will work without it');
    return [];
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** Format snapshot as a compact string for the LLM prompt. */
export function formatSnapshotForPrompt(elements: DomElement[]): string {
  if (elements.length === 0) return '';
  const lines = elements.map(
    (e) => `  ${e.role} "${e.name}" → ${e.selector}`,
  );
  return `\nInteractive elements found on the page (use these exact role + name values):\n${lines.join('\n')}\n`;
}
