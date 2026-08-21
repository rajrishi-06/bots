import { htmlToMarkdown, htmlTitle } from "./html.js";

/**
 * Bytes → markdown.
 *
 * Everything downstream speaks markdown, because the chunker splits on document
 * structure and markdown is the cheapest way to carry that structure between a
 * parser and a chunker.
 */

export interface Parsed {
  markdown: string;
  /** Recovered from the document itself where it has one. */
  title?: string;
  /** Pages, sheets, or whatever the format counts. Surfaced in the dashboard. */
  units?: number;
}

export class UnsupportedType extends Error {}

const TEXT_LIKE = /^text\/(plain|markdown|x-markdown)$|^application\/(json|xml)$/;

export async function parse(
  bytes: Buffer,
  contentType: string,
  filename?: string,
): Promise<Parsed> {
  const type = contentType.split(";")[0]!.trim().toLowerCase();

  if (type === "application/pdf" || filename?.toLowerCase().endsWith(".pdf")) {
    // Imported lazily: pdf-parse pulls a large dependency tree, and most
    // ingests are HTML or text and should not pay for it.
    const { default: pdfParse } = await import("pdf-parse");
    const result = await pdfParse(bytes);
    const text = result.text.trim();
    if (!text) {
      // A PDF that yields no text is a scan. Textract is the documented answer;
      // failing loudly beats indexing an empty document that looks successful.
      throw new UnsupportedType(
        "This PDF has no extractable text — it is probably a scan. OCR (Textract) is not wired up yet.",
      );
    }
    return { markdown: normalisePdfText(text), units: result.numpages };
  }

  if (type === "text/html" || type === "application/xhtml+xml") {
    const html = bytes.toString("utf8");
    return { markdown: htmlToMarkdown(html), title: htmlTitle(html) ?? undefined };
  }

  if (TEXT_LIKE.test(type) || !type) {
    return { markdown: bytes.toString("utf8") };
  }

  throw new UnsupportedType(`Cannot read ${type}. Supported: PDF, HTML, plain text, Markdown.`);
}

/**
 * PDF text extraction returns hard-wrapped lines with no paragraph structure.
 *
 * Left alone this is exactly the input that used to defeat the chunker — one
 * enormous block with no blank lines. Rejoining wrapped lines and promoting
 * plausible headings gives the chunker something to split on.
 */
function normalisePdfText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) out.push(paragraph.join(" "));
    paragraph = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    // A short line in Title Case or ALL CAPS, with no terminal punctuation, is
    // a heading far more often than it is a one-word sentence.
    const looksLikeHeading =
      line.length < 80 && !/[.,;:]$/.test(line) && /^[A-Z0-9]/.test(line) &&
      (line === line.toUpperCase() || /^(\d+[.)]\s+)?[A-Z][^.!?]*$/.test(line));
    if (looksLikeHeading && paragraph.length === 0) {
      out.push(`## ${line}`);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
