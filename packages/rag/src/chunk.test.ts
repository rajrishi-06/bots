import { describe, expect, it } from "vitest";
import { chunkMarkdown, embeddableText, estimateTokens, parseBlocks } from "./chunk.js";

const DOC = `# Handbook

Welcome to the handbook.

## Billing

Billing runs monthly.

### Refunds

Refunds depend on where you are.

#### EU

EU customers may request a refund within 14 days.

#### US

US customers may request a refund within 30 days.

## Security

| Feature | Plan |
| --- | --- |
| SSO | Enterprise |
| Audit log | Enterprise |

\`\`\`bash
bots login --sso
\`\`\`
`;

describe("parseBlocks", () => {
  it("keeps a fenced code block whole, including blank lines inside it", () => {
    const blocks = parseBlocks("text\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nmore");
    const code = blocks.find((b) => b.kind === "code")!;
    expect(code.text).toContain("const a = 1;");
    expect(code.text).toContain("const b = 2;");
    expect(code.atomic).toBe(true);
  });

  it("does not treat a heading inside a code fence as a heading", () => {
    const blocks = parseBlocks("```md\n# Not a heading\n```");
    expect(blocks.filter((b) => b.kind === "heading")).toHaveLength(0);
  });

  it("keeps a pipe table whole, header row included", () => {
    const table = parseBlocks(DOC).find((b) => b.kind === "table")!;
    expect(table.text).toContain("| Feature | Plan |");
    expect(table.text).toContain("| SSO | Enterprise |");
    expect(table.atomic).toBe(true);
  });

  it("records heading levels", () => {
    const levels = parseBlocks(DOC).filter((b) => b.kind === "heading").map((b) => b.level);
    expect(levels).toEqual([1, 2, 3, 4, 4, 2]);
  });
});

describe("chunkMarkdown heading paths", () => {
  const chunks = chunkMarkdown(DOC, { minTokens: 1 });

  it("builds the full ancestor path, not just the nearest heading", () => {
    const eu = chunks.find((c) => c.content.includes("14 days"))!;
    expect(eu.headingPath).toBe("Handbook › Billing › Refunds › EU");
  });

  it("pops the stack when a heading level goes back up", () => {
    const sec = chunks.find((c) => c.content.includes("SSO"))!;
    // Security is h2, so Refunds/EU must be gone from the path.
    expect(sec.headingPath).toBe("Handbook › Security");
  });

  it("separates sibling sections into different chunks", () => {
    const eu = chunks.find((c) => c.content.includes("14 days"))!;
    const us = chunks.find((c) => c.content.includes("30 days"))!;
    expect(eu).not.toBe(us);
    expect(eu.headingPath).toContain("EU");
    expect(us.headingPath).toContain("US");
  });

  it("numbers chunks contiguously from zero", () => {
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });
});

describe("chunkMarkdown sizing", () => {
  const long = (n: number) => Array.from({ length: n }, (_, i) => `Sentence number ${i} about refunds.`).join(" ");

  it("splits long prose into multiple chunks near the target", () => {
    const chunks = chunkMarkdown(`# Doc\n\n${long(400)}`, { targetTokens: 200, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    // A chunk may overshoot by at most the last block it accepted.
    for (const c of chunks) expect(estimateTokens(c.content)).toBeLessThan(600);
  });

  it("splits a SINGLE oversized block — the shape extracted PDF text arrives in", () => {
    // One block, no blank lines anywhere. Before this was handled, the whole
    // thing sailed through the accumulator and became one enormous chunk.
    const wall = long(600);
    expect(wall.split("\n\n")).toHaveLength(1);
    const chunks = chunkMarkdown(wall, { targetTokens: 150, overlap: 0, minTokens: 1 });
    expect(chunks.length).toBeGreaterThan(4);
    for (const c of chunks) expect(estimateTokens(c.content)).toBeLessThanOrEqual(200);
  });

  it("splits on word boundaries when there is no sentence punctuation to use", () => {
    const wall = Array.from({ length: 800 }, (_, i) => `token${i}`).join(" ");
    const chunks = chunkMarkdown(wall, { targetTokens: 100, overlap: 0, minTokens: 1 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(estimateTokens(c.content)).toBeLessThanOrEqual(150);
  });

  it("carries overlap from the previous chunk so a split sentence keeps context", () => {
    const paras = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${long(12)}`).join("\n\n");
    const withOverlap = chunkMarkdown(`# Doc\n\n${paras}`, { targetTokens: 120, overlap: 0.3 });
    const without = chunkMarkdown(`# Doc\n\n${paras}`, { targetTokens: 120, overlap: 0 });
    expect(withOverlap.length).toBeGreaterThanOrEqual(without.length);
    // Some text from chunk N must reappear at the head of chunk N+1.
    const overlapped = withOverlap.some((c, i) => {
      if (i === 0) return false;
      const head = c.content.slice(0, 40);
      return withOverlap[i - 1]!.content.includes(head.split(".")[0]!.trim());
    });
    expect(overlapped).toBe(true);
  });

  it("never splits a table, even one larger than the target", () => {
    const rows = Array.from({ length: 200 }, (_, i) => `| Feature ${i} | Enterprise |`).join("\n");
    const doc = `# Plans\n\n| Feature | Plan |\n| --- | --- |\n${rows}\n`;
    const chunks = chunkMarkdown(doc, { targetTokens: 100 });
    const holding = chunks.filter((c) => c.content.includes("| Feature | Plan |"));
    expect(holding).toHaveLength(1);
    // The header and the last row must live in the same chunk.
    expect(holding[0]!.content).toContain("| Feature 199 | Enterprise |");
  });

  it("never splits a code fence larger than the target", () => {
    const body = Array.from({ length: 300 }, (_, i) => `  const line${i} = ${i};`).join("\n");
    const chunks = chunkMarkdown(`# Code\n\n\`\`\`ts\n${body}\n\`\`\`\n`, { targetTokens: 100 });
    const holding = chunks.filter((c) => c.content.includes("```ts"));
    expect(holding).toHaveLength(1);
    expect(holding[0]!.content).toContain("const line299 = 299;");
  });

  it("folds a too-small trailing section into its neighbour instead of emitting a thin vector", () => {
    const chunks = chunkMarkdown("# A\n\nplenty of words here to make a real chunk worth keeping around\n\nok\n", {
      targetTokens: 500,
      minTokens: 200,
    });
    expect(chunks).toHaveLength(1);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("   \n\n  ")).toEqual([]);
  });

  it("handles a document with no headings at all", () => {
    const chunks = chunkMarkdown("Just some prose with no structure whatsoever.", { minTokens: 1 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toBe("");
  });
});

describe("embeddableText", () => {
  it("puts the heading path and context in front of the content", () => {
    const text = embeddableText(
      { ordinal: 0, headingPath: "Billing › Refunds", content: "14 days." },
      "This section of the handbook covers refund windows by region.",
    );
    expect(text.indexOf("Billing › Refunds")).toBeLessThan(text.indexOf("This section"));
    expect(text.indexOf("This section")).toBeLessThan(text.indexOf("14 days."));
  });

  it("omits an absent context rather than leaving a blank line", () => {
    const text = embeddableText({ ordinal: 0, headingPath: "A", content: "B" }, null);
    expect(text).toBe("A\nB");
  });
});
