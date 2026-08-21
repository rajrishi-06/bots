import { h, type ComponentChild } from "preact";

/**
 * A deliberately tiny Markdown renderer — headings, bold, inline code, lists,
 * paragraphs, and nothing else.
 *
 * Ported from the portfolio for the same two reasons it was written there: it
 * builds VNodes directly so there is no `dangerouslySetInnerHTML` anywhere near
 * model output, and it adds no dependency to a bundle with a 30KB ceiling. A
 * full CommonMark parser is both larger than the rest of the widget and a
 * bigger attack surface than the feature is worth.
 *
 * Citations `[c1]` are rendered as superscript markers rather than left inline,
 * so a grounded answer reads as prose instead of as a bibliography.
 */

const CITATION = /\[(c\d{1,3})\]/g;

// ComponentChild, not VNode: Preact types VNode invariantly in its props, so a
// keyed node is not assignable to VNode<{}> and an array of mixed children
// cannot be typed as VNode[] at all.
function inline(text: string, key: string): ComponentChild[] {
  const out: ComponentChild[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[c\d{1,3}\])/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**")) {
      out.push(h("strong", { key: `${key}-b${i}` }, part.slice(2, -2)));
    } else if (part.startsWith("`") && part.endsWith("`")) {
      out.push(h("code", { key: `${key}-c${i}` }, part.slice(1, -1)));
    } else if (CITATION.test(part)) {
      CITATION.lastIndex = 0;
      out.push(h("sup", { key: `${key}-s${i}`, class: "cite" }, part.slice(2, -1)));
    } else {
      out.push(part);
    }
  });
  return out;
}

export function markdown(text: string): ComponentChild[] {
  const blocks: ComponentChild[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => h("li", { key: i }, inline(it, `li${key}-${i}`)));
    blocks.push(h(list.ordered ? "ol" : "ul", { key: key++ }, items));
    list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push(
        h("p", { key: key++, class: heading[1]!.length <= 2 ? "h2" : "h3" }, inline(heading[2]!, `h${key}`)),
      );
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!list || list.ordered) {
        flush();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]!);
      continue;
    }

    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      if (!list || !list.ordered) {
        flush();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1]!);
      continue;
    }

    flush();
    blocks.push(h("p", { key: key++ }, inline(line, `p${key}`)));
  }
  flush();
  return blocks;
}
