import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { markdown } from "./markdown.js";

/** The renderer is deliberately tiny; these are the shapes answers actually take. */

let host: HTMLElement;
const draw = (text: string): string => {
  host = document.createElement("div");
  document.body.appendChild(host);
  render(markdown(text) as never, host);
  return host.innerHTML;
};
afterEach(() => host?.remove());

describe("markdown", () => {
  it("renders a table rather than showing the pipes", () => {
    // The knowledge base is full of tables and the model reproduces them, so
    // raw pipes meant showing visitors the markup instead of the answer.
    const html = draw(
      "| Plan | Seats |\n| --- | --- |\n| Starter | 3 |\n| Team | 25 |",
    );
    expect(html).toContain("<table");
    expect(html).toContain("<th>Plan</th>");
    expect(html).toContain("<td>Starter</td>");
    expect(html).not.toContain("| --- |");
  });

  it("pads a short row so cells stay in their column", () => {
    const html = draw("| A | B |\n| --- | --- |\n| 1 |");
    const tds = html.match(/<td>/g) ?? [];
    expect(tds).toHaveLength(2);
  });

  it("renders headings, bold, code and lists", () => {
    const html = draw("## Refunds\n\n**EU** customers use `refund()`\n\n- one\n- two");
    expect(html).toContain('class="h2"');
    expect(html).toContain("<strong>EU</strong>");
    expect(html).toContain("<code>refund()</code>");
    expect(html).toContain("<li>one</li>");
  });

  it("renders a citation as a superscript marker, not inline noise", () => {
    const html = draw("Refunds take 14 days [c1].");
    expect(html).toContain('<sup class="cite">c1</sup>');
    expect(html).not.toContain("[c1]");
  });

  it("never emits raw HTML from model output", () => {
    // No dangerouslySetInnerHTML anywhere near a model response. The words still
    // appear — as escaped TEXT, which is the point; what must never appear is a
    // real element or a live attribute.
    const html = draw("<script>alert(1)</script> and <img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toMatch(/<script[\s>]/);
    expect(html).not.toMatch(/<img[\s>]/);
  });

  it("handles an empty string", () => {
    expect(draw("")).toBe("");
  });
});
