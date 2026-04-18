/**
 * Real URL Scanner — crawls an actual URL using HTTP fetch + cheerio HTML parsing.
 * No simulation: every result comes from real HTTP responses.
 */
import * as cheerio from "cheerio";

export interface ClickableElement {
  selector: string;
  text: string;
  type: "button" | "link" | "input";
}

export interface FormInfo {
  type: string;
  fields: string[];
  action?: string;
  method?: string;
}

export interface ScanResult {
  url: string;
  pagesScanned: number;
  discoveredPaths: string[];
  totalLinks: number;
  clickableElements: ClickableElement[];
  forms: {
    total: number;
    types: Record<string, number>;
    details: FormInfo[];
  };
  appType: {
    detectedType: string;
    confidence: number;
    framework?: string;
  };
  suggestedBehaviors: { description: string; path?: string }[];
  responseTime: number;
  statusCode: number;
  headers: Record<string, string>;
  error?: string;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; TrafficForge-Scanner/1.0; +https://trafficforge.app)";

async function fetchPage(
  url: string,
  timeoutMs = 15000
): Promise<{ html: string; status: number; headers: Record<string, string>; elapsed: number } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
      },
      redirect: "follow",
    });
    const elapsed = Date.now() - t0;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return { html: "", status: res.status, headers: {}, elapsed };
    }
    const html = await res.text();
    const headers: Record<string, string> = {};
    for (const key of ["server", "content-type", "x-powered-by", "x-frame-options", "cache-control", "strict-transport-security"]) {
      const v = res.headers.get(key);
      if (v) headers[key] = v;
    }
    return { html, status: res.status, headers, elapsed };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizePath(href: string, baseOrigin: string): string | null {
  try {
    const u = new URL(href, baseOrigin);
    if (u.origin !== baseOrigin) return null;
    // Skip static assets
    if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|pdf|zip|xml|json|map)$/i.test(u.pathname)) return null;
    // Skip anchors only
    if (href.startsWith("#")) return null;
    return u.pathname + (u.search ? u.search : "");
  } catch {
    return null;
  }
}

function detectFramework($: cheerio.CheerioAPI, scripts: string[]): string {
  if ($('[id="__NEXT_DATA__"]').length || scripts.some(s => /\/_next\//.test(s))) return "Next.js";
  if (scripts.some(s => /nuxt/.test(s))) return "Nuxt.js";
  if ($("[data-reactroot], [data-react-helmet]").length || scripts.some(s => /react/.test(s))) return "React";
  if ($("[ng-app], [data-ng-app], [ng-controller]").length || scripts.some(s => /angular/.test(s))) return "Angular";
  if ($("[data-v-]").length || scripts.some(s => /vue/.test(s))) return "Vue";
  if (scripts.some(s => /svelte/.test(s))) return "Svelte";
  if (scripts.some(s => /remix/.test(s))) return "Remix";
  if (scripts.some(s => /gatsby/.test(s))) return "Gatsby";
  return "Unknown";
}

function detectAppType(baseUrl: string, $: cheerio.CheerioAPI, allText: string): string {
  const u = new URL(baseUrl);
  const host = u.hostname.toLowerCase();
  const text = allText.toLowerCase();

  if (host.includes("shop") || $("[class*='cart'], [class*='product'], [class*='checkout'], [class*='add-to-cart']").length > 2) return "ecommerce";
  if ($("[class*='dashboard'], [class*='sidebar'], [class*='admin']").length > 2) return "saas";
  if ($("[class*='post'], [class*='article'], [class*='blog'], [class*='author']").length > 2) return "blog";
  if (text.includes("portfolio") || text.includes("projects") || text.includes("work")) return "portfolio";
  if (text.includes("docs") || text.includes("documentation") || text.includes("api reference")) return "docs";
  if (text.includes("news") || text.includes("latest") || text.includes("breaking")) return "news";
  return "web";
}

function classifyForm($form: cheerio.Cheerio<cheerio.Element>, $: cheerio.CheerioAPI): string {
  const text = $form.text().toLowerCase();
  const inputs = $form.find("input[type]").map((_, el) => ($(el).attr("type") ?? "")).get();

  if (inputs.includes("password") && (text.includes("login") || text.includes("sign in") || text.includes("email"))) return "login";
  if (inputs.includes("password") && (text.includes("register") || text.includes("sign up") || text.includes("create account"))) return "signup";
  if (inputs.includes("search") || text.includes("search") || $form.find("input[type='search']").length > 0) return "search";
  if (text.includes("checkout") || text.includes("payment") || text.includes("card number")) return "checkout";
  if (text.includes("subscribe") || (inputs.includes("email") && inputs.length === 1)) return "newsletter";
  if (text.includes("contact") || text.includes("message")) return "contact";
  if (text.includes("upload") || inputs.includes("file")) return "upload";
  return "generic";
}

export async function scanUrl(
  targetUrl: string,
  maxPages = 20
): Promise<ScanResult> {
  let base: URL;
  try {
    base = new URL(targetUrl);
  } catch {
    return {
      url: targetUrl,
      pagesScanned: 0,
      discoveredPaths: [],
      totalLinks: 0,
      clickableElements: [],
      forms: { total: 0, types: {}, details: [] },
      appType: { detectedType: "unknown", confidence: 0 },
      suggestedBehaviors: [],
      responseTime: 0,
      statusCode: 0,
      headers: {},
      error: "Invalid URL format",
    };
  }

  const baseOrigin = base.origin;
  const visited = new Set<string>();
  const queue: string[] = [base.pathname || "/"];

  const discoveredPaths: string[] = [];
  const allButtons: ClickableElement[] = [];
  const allForms: FormInfo[] = [];
  let totalLinks = 0;
  let rootResponseTime = 0;
  let rootStatusCode = 0;
  let rootHeaders: Record<string, string> = {};
  let detectedFramework = "Unknown";
  let detectedAppType = "web";
  let pagesScanned = 0;

  while (queue.length > 0 && pagesScanned < maxPages) {
    const path = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);

    const pageUrl = `${baseOrigin}${path}`;
    const result = await fetchPage(pageUrl);
    if (!result || result.status >= 400) continue;
    if (!result.html) continue;

    if (pagesScanned === 0) {
      rootResponseTime = result.elapsed;
      rootStatusCode = result.status;
      rootHeaders = result.headers;
    }

    const $ = cheerio.load(result.html);

    // Detect framework from script srcs
    const scriptSrcs = $("script[src]").map((_, el) => $(el).attr("src") ?? "").get();
    if (pagesScanned === 0) {
      detectedFramework = detectFramework($, scriptSrcs);
      detectedAppType = detectAppType(targetUrl, $, $.text());
    }

    // Discover internal links
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const normalized = normalizePath(href, baseOrigin);
      if (normalized && !visited.has(normalized) && !queue.includes(normalized)) {
        queue.push(normalized);
        totalLinks++;
      }
    });

    // Extract clickable buttons
    $("button, [role='button'], input[type='submit'], input[type='button'], a.btn, a.button, [class*='btn'], [class*='button']")
      .each((_, el) => {
        const text = ($(el).text().trim() || $(el).attr("value") || $(el).attr("aria-label") || "").trim();
        if (text && text.length > 0 && text.length < 60 && allButtons.length < 30) {
          const tag = ($(el).prop("tagName") as string ?? "button").toLowerCase();
          allButtons.push({
            selector: tag,
            text,
            type: tag === "a" ? "link" : tag === "input" ? "input" : "button",
          });
        }
      });

    // Extract forms
    $("form").each((_, formEl) => {
      const $form = $(formEl);
      const fields: string[] = [];
      $form.find("input, select, textarea").each((_, fieldEl) => {
        const type = $(fieldEl).attr("type") ?? $(fieldEl).prop("tagName")?.toLowerCase() ?? "text";
        const name = $(fieldEl).attr("name") ?? $(fieldEl).attr("id") ?? $(fieldEl).attr("placeholder") ?? type;
        if (name && name.length < 50) fields.push(name);
      });
      allForms.push({
        type: classifyForm($form, $),
        fields,
        action: $form.attr("action") ?? undefined,
        method: ($form.attr("method") ?? "get").toUpperCase(),
      });
    });

    discoveredPaths.push(path);
    pagesScanned++;
  }

  // If the root page was unreachable, return early with a clear error
  if (pagesScanned === 0) {
    return {
      url: targetUrl,
      pagesScanned: 0,
      discoveredPaths: [],
      totalLinks: 0,
      clickableElements: [],
      forms: { total: 0, types: {}, details: [] },
      appType: { detectedType: "unknown", confidence: 0 },
      suggestedBehaviors: [],
      responseTime: 0,
      statusCode: 0,
      headers: {},
      error: "Could not reach the target URL. The site may be down, blocking our scanner, or returning a non-HTML response.",
    };
  }

  // Build form type summary
  const formTypes: Record<string, number> = {};
  for (const f of allForms) {
    formTypes[f.type] = (formTypes[f.type] ?? 0) + 1;
  }

  // Confidence score
  let confidence = 0.5;
  if (detectedFramework !== "Unknown") confidence += 0.2;
  if (pagesScanned > 3) confidence += 0.1;
  if (allForms.length > 0) confidence += 0.1;
  if (totalLinks > 5) confidence += 0.1;

  // Suggested behaviors
  const suggestedBehaviors: { description: string; path?: string }[] = [
    { description: `Load test ${pagesScanned} discovered pages`, path: "/" },
  ];
  if (formTypes["login"]) suggestedBehaviors.push({ description: "Stress test login endpoint" });
  if (formTypes["signup"]) suggestedBehaviors.push({ description: "Hammer registration flow" });
  if (formTypes["search"]) suggestedBehaviors.push({ description: "Flood search with concurrent queries" });
  if (formTypes["checkout"]) suggestedBehaviors.push({ description: "Simulate checkout under load" });
  if (allButtons.length > 5) suggestedBehaviors.push({ description: `Exercise ${allButtons.length} interactive elements` });
  if (discoveredPaths.length > 5) suggestedBehaviors.push({ description: "Navigate all pages with random users" });

  return {
    url: targetUrl,
    pagesScanned,
    discoveredPaths,
    totalLinks,
    clickableElements: allButtons,
    forms: { total: allForms.length, types: formTypes, details: allForms },
    appType: {
      detectedType: detectedAppType,
      confidence: Math.min(1, confidence),
      framework: detectedFramework,
    },
    suggestedBehaviors,
    responseTime: rootResponseTime,
    statusCode: rootStatusCode,
    headers: rootHeaders,
  };
}
