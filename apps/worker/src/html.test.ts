import { describe, expect, it } from "vitest";
import { htmlToMarkdown, htmlTitle } from "./html.js";

describe("htmlToMarkdown", () => {
  it("preserves heading levels — the chunker's headingPath depends on them", () => {
    const md = htmlToMarkdown("<body><h1>Handbook</h1><h2>Billing</h2><h3>Refunds</h3><p>14 days.</p></body>");
    expect(md).toContain("# Handbook");
    expect(md).toContain("## Billing");
    expect(md).toContain("### Refunds");
  });

  it("keeps a table with its header row", () => {
    const md = htmlToMarkdown(
      "<body><table><tr><th>Plan</th><th>Seats</th></tr><tr><td>Team</td><td>25</td></tr></table></body>",
    );
    expect(md).toContain("| Plan | Seats |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| Team | 25 |");
  });

  it("pads a ragged row so every row has the header's cell count", () => {
    const md = htmlToMarkdown("<body><table><tr><th>A</th><th>B</th></tr><tr><td>1</td></tr></table></body>");
    // A row with fewer cells than the header shifts every value one column left
    // once parsed, so the padding matters more than how it is spelled.
    const cells = (line: string) => line.split("|").slice(1, -1).length;
    const lines = md.split("\n").filter((l) => l.startsWith("|"));
    expect(lines).toHaveLength(3);
    expect(cells(lines[2]!)).toBe(cells(lines[0]!));
  });

  it("fences code blocks", () => {
    const md = htmlToMarkdown("<body><pre><code>npm install\nnpm run dev</code></pre></body>");
    expect(md).toContain("```");
    expect(md).toContain("npm install");
  });

  it("drops navigation, scripts and styles rather than indexing boilerplate", () => {
    const md = htmlToMarkdown(`<body>
      <nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav>
      <script>window.analytics=1</script>
      <style>.x{color:red}</style>
      <main><h1>Refunds</h1><p>EU customers get 14 days.</p></main>
      <footer>© 2026 Acme</footer>
    </body>`);
    expect(md).toContain("14 days");
    // Boilerplate in every chunk means every query matches the nav.
    expect(md).not.toContain("Pricing");
    expect(md).not.toContain("analytics");
    expect(md).not.toContain("color:red");
    expect(md).not.toContain("© 2026");
  });

  it("prefers <main> over the whole body", () => {
    const body = `<body><div>${"chrome ".repeat(50)}</div><main>${"the real content ".repeat(20)}</main></body>`;
    const md = htmlToMarkdown(body);
    expect(md).toContain("the real content");
    expect(md).not.toContain("chrome");
  });

  it("falls back to the body when the main region is too small to be content", () => {
    const md = htmlToMarkdown(`<body><main>Hi</main><p>${"actual prose ".repeat(40)}</p></body>`);
    expect(md).toContain("actual prose");
  });

  it("decodes entities, including numeric and hex", () => {
    const md = htmlToMarkdown("<body><p>Tom &amp; Jerry &#8212; &#x201C;quoted&#x201D; &nbsp;done</p></body>");
    expect(md).toContain("Tom & Jerry");
    expect(md).toContain("—");
    expect(md).toContain("“quoted”");
  });

  it("turns list items into markdown bullets", () => {
    const md = htmlToMarkdown("<body><ul><li>First</li><li>Second</li></ul></body>");
    expect(md).toContain("- First");
    expect(md).toContain("- Second");
  });

  it("collapses runaway whitespace without welding paragraphs together", () => {
    const md = htmlToMarkdown("<body><p>One</p>\n\n\n\n<p>Two</p></body>");
    expect(md).toBe("One\n\nTwo");
  });

  it("returns empty for a document with no content", () => {
    expect(htmlToMarkdown("<body><script>x</script></body>")).toBe("");
  });
});

describe("htmlTitle", () => {
  it("reads the document title", () => {
    expect(htmlTitle("<html><head><title>Acme Docs</title></head></html>")).toBe("Acme Docs");
  });
  it("returns null when there is none", () => {
    expect(htmlTitle("<html></html>")).toBeNull();
  });
});
