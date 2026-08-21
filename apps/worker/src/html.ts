/**
 * HTML → Markdown.
 *
 * Written rather than pulled from a library, because the chunker downstream
 * keys on heading hierarchy, tables and code fences — and a generic converter
 * either flattens those or drags in a full DOM implementation to preserve them.
 * What is needed here is narrow and the failure mode of getting it wrong is
 * specific: lose the headings and every chunk loses its `headingPath`, which is
 * the cheapest retrieval signal in the pipeline.
 *
 * Deliberately not a general HTML parser. It handles the tags that carry
 * document structure and discards the rest.
 */

/** Elements whose CONTENT is never prose. Dropped whole, including children. */
const DROP = /<(script|style|noscript|svg|iframe|template|form|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi;

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", middot: "·", bull: "•",
};

function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

const strip = (html: string): string => decode(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/**
 * Narrow the document to its main content before converting.
 *
 * A crawled page is mostly navigation, cookie banners and footers. Indexing
 * those makes every chunk in a corpus share the same boilerplate vocabulary,
 * which is a direct hit to retrieval precision — every query matches the nav.
 */
function mainContent(html: string): string {
  for (const re of [
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<div\b[^>]*\brole=["']main["'][^>]*>([\s\S]*?)<\/div>/i,
    /<body\b[^>]*>([\s\S]*?)<\/body>/i,
  ]) {
    const m = re.exec(html);
    if (m?.[1] && m[1].length > 200) return m[1];
  }
  return html;
}

export function htmlTitle(html: string): string | null {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m?.[1] ? strip(m[1]) : null;
}

export function htmlToMarkdown(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, "");
  s = mainContent(s);
  s = s.replace(DROP, "");

  // Tables first: their cell markup would otherwise be eaten by the generic
  // tag strip, and a table without its header row is worse than no table.
  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, body: string) => {
    const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
      [...r[1]!.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => strip(c[1]!)),
    );
    if (rows.length === 0) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
    const lines = [
      `| ${pad(rows[0]!).join(" | ")} |`,
      `| ${Array(width).fill("---").join(" | ")} |`,
      ...rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`),
    ];
    return `\n\n${lines.join("\n")}\n\n`;
  });

  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => `\n\n\`\`\`\n${decode(code.replace(/<[^>]+>/g, "")).trim()}\n\`\`\`\n\n`);
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, c: string) => `\`${strip(c)}\``);

  for (let level = 1; level <= 6; level++) {
    s = s.replace(
      new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, "gi"),
      (_, t: string) => (strip(t) ? `\n\n${"#".repeat(level)} ${strip(t)}\n\n` : ""),
    );
  }

  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, t: string) => (strip(t) ? `\n- ${strip(t)}` : ""));
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t: string) => (strip(t) ? `**${strip(t)}**` : ""));
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|section|ul|ol|tr|h[1-6])>/gi, "\n\n");

  return decode(s.replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
