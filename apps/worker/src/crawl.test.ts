import { describe, expect, it, vi } from "vitest";
import { crawl } from "./crawl.js";

/** A fake site. No network involved. */
function site(pages: Record<string, string>) {
  return vi.fn(async (url: string | URL) => {
    const href = typeof url === "string" ? url : url.href;
    const body = pages[href];
    if (body === undefined) return new Response("nope", { status: 404 });
    return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}

const page = (title: string, body: string, links: string[] = []) =>
  `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${body}</p>` +
  links.map((l) => `<a href="${l}">link</a>`).join("") +
  `</main></body></html>`;

const PROSE = "Refunds are processed within fourteen days for customers in the EU. ".repeat(6);

describe("crawl", () => {
  it("follows same-origin links and collects pages", async () => {
    const fetchImpl = site({
      "https://acme.test/": page("Home", PROSE, ["/billing", "/security"]),
      "https://acme.test/billing": page("Billing", PROSE),
      "https://acme.test/security": page("Security", PROSE),
    });
    const pages = await crawl("https://acme.test/", { fetchImpl });
    expect(pages.map((p) => p.title).sort()).toEqual(["Billing", "Home", "Security"]);
    expect(pages[0]!.markdown).toContain("# Home");
  });

  it("never leaves the origin", async () => {
    const fetchImpl = site({
      "https://acme.test/": page("Home", PROSE, ["https://evil.test/steal", "/ok"]),
      "https://acme.test/ok": page("Ok", PROSE),
    });
    const pages = await crawl("https://acme.test/", { fetchImpl });
    expect(pages.every((p) => p.url.startsWith("https://acme.test"))).toBe(true);
  });

  it("respects a path prefix", async () => {
    const fetchImpl = site({
      "https://acme.test/docs/": page("Docs", PROSE, ["/docs/billing", "/blog/post"]),
      "https://acme.test/docs/billing": page("Billing", PROSE),
      "https://acme.test/blog/post": page("Blog", PROSE),
    });
    const pages = await crawl("https://acme.test/docs/", { fetchImpl, pathPrefix: "/docs" });
    expect(pages.map((p) => p.title).sort()).toEqual(["Billing", "Docs"]);
  });

  it("stops at maxPages — a runaway crawl is a bill and a ban", async () => {
    const pages: Record<string, string> = {};
    for (let i = 0; i < 40; i++) {
      pages[`https://acme.test/p${i}`] = page(`P${i}`, PROSE, [`/p${i + 1}`]);
    }
    const crawled = await crawl("https://acme.test/p0", { fetchImpl: site(pages), maxPages: 5 });
    expect(crawled).toHaveLength(5);
  });

  it("visits each URL once even in a link cycle", async () => {
    const fetchImpl = site({
      "https://acme.test/a": page("A", PROSE, ["/b"]),
      "https://acme.test/b": page("B", PROSE, ["/a"]),
    });
    const pages = await crawl("https://acme.test/a", { fetchImpl });
    expect(pages).toHaveLength(2);
  });

  it("skips non-document links without fetching them", async () => {
    const fetchImpl = site({
      "https://acme.test/": page("Home", PROSE, ["/manual.pdf", "/logo.png", "/app.js"]),
    });
    await crawl("https://acme.test/", { fetchImpl });
    const urls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith(".pdf") || u.endsWith(".png") || u.endsWith(".js"))).toBe(false);
  });

  it("skips a response that is not actually HTML", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("%PDF-1.4 binary", { status: 200, headers: { "content-type": "application/pdf" } }),
    ) as unknown as typeof fetch;
    expect(await crawl("https://acme.test/", { fetchImpl })).toEqual([]);
  });

  it("drops navigation shells that reduce to almost nothing", async () => {
    const fetchImpl = site({
      "https://acme.test/": page("Home", PROSE, ["/empty"]),
      "https://acme.test/empty": "<html><head><title>Empty</title></head><body><main><h1>Hi</h1></main></body></html>",
    });
    const pages = await crawl("https://acme.test/", { fetchImpl });
    expect(pages.map((p) => p.title)).toEqual(["Home"]);
  });

  it("keeps going when one page fails", async () => {
    const fetchImpl = site({
      "https://acme.test/": page("Home", PROSE, ["/broken", "/good"]),
      "https://acme.test/good": page("Good", PROSE),
      // /broken is absent → 404
    });
    const pages = await crawl("https://acme.test/", { fetchImpl });
    expect(pages.map((p) => p.title).sort()).toEqual(["Good", "Home"]);
  });
});

describe("option defaults", () => {
  it("uses the default page cap when maxPages is passed as undefined", async () => {
    // The regression guard: `{ ...DEFAULTS, ...opts }` overwrites a default with
    // an explicit undefined, and the crawl loop then never executes.
    const fetchImpl = site({
      "https://acme.test/": page("Home", PROSE, ["/a"]),
      "https://acme.test/a": page("A", PROSE),
    });
    const pages = await crawl("https://acme.test/", { fetchImpl, maxPages: undefined, pathPrefix: undefined });
    expect(pages).toHaveLength(2);
  });
});
