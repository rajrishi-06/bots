import { htmlToMarkdown, htmlTitle } from "./html.js";

/**
 * Website crawl — how a real customer onboards, since almost nobody has their
 * documentation sitting in a folder of files.
 */

export interface CrawlOptions {
  /** Hard ceiling on pages. A crawl that runs away is a bill and a ban. */
  maxPages?: number;
  /** Only follow links under this path prefix. */
  pathPrefix?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface CrawledPage {
  url: string;
  title: string;
  markdown: string;
}

const DEFAULT_MAX_PAGES = 50;
const DEFAULT_TIMEOUT_MS = 15_000;

/** Same-origin only, and never a non-document URL. */
function crawlable(href: string, origin: string, prefix?: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (prefix && !url.pathname.startsWith(prefix)) return false;
  // Skip anything that clearly is not a page. Fetching a 40MB zip to discover
  // it is not HTML costs the customer's bandwidth and our time.
  return !/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|css|js|json|xml|ico|woff2?)$/i.test(url.pathname);
}

export async function crawl(startUrl: string, opts: CrawlOptions = {}): Promise<CrawledPage[]> {
  // `??` per option, NOT `{ ...DEFAULTS, ...opts }`. Spreading an object whose
  // key is explicitly `undefined` overwrites the default WITH undefined — and a
  // caller passing `{ maxPages: job.maxPages }` for an absent field does exactly
  // that. `pages.length < undefined` is false, so the crawl silently visited
  // nothing and reported success.
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  const start = new URL(startUrl);
  const origin = start.origin;

  const seen = new Set<string>([start.href]);
  const queue: string[] = [start.href];
  const pages: CrawledPage[] = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const url = queue.shift()!;
    let html: string;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await doFetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "petbot-crawler/1.0 (+https://petbot.dev/crawler)" },
        redirect: "follow",
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      // Only parse what is actually a document — a mislabelled link should not
      // put a binary blob through the HTML converter.
      if (!(res.headers.get("content-type") ?? "").includes("html")) continue;
      html = await res.text();
    } catch {
      continue; // one bad page must not end the crawl
    }

    const markdown = htmlToMarkdown(html);
    // Pages that reduce to almost nothing are navigation shells. Indexing them
    // adds boilerplate to the corpus and nothing else.
    if (markdown.length > 200) {
      pages.push({ url, title: htmlTitle(html) ?? new URL(url).pathname, markdown });
    }

    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
      let href: string;
      try {
        href = new URL(m[1]!, url).href;
      } catch {
        continue;
      }
      if (seen.has(href) || !crawlable(href, origin, opts.pathPrefix)) continue;
      seen.add(href);
      queue.push(href);
    }
  }

  return pages;
}
