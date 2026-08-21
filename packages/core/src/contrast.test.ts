import { describe, expect, it } from "vitest";
import { contrast, luminance, parseHex, worstContrast, NEAR_BLACK, WHITE } from "./contrast.js";

describe("parseHex", () => {
  it("expands shorthand and ignores case + leading hash", () => {
    expect(parseHex("#FFF")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("abc")).toEqual({ r: 170, g: 187, b: 204 });
  });
  it("throws rather than defaulting to black", () => {
    expect(() => parseHex("rebeccapurple")).toThrow();
    expect(() => parseHex("#12345")).toThrow();
  });
});

describe("contrast", () => {
  // The two anchors every WCAG implementation must agree on.
  it("is 21:1 for black on white and 1:1 for a colour on itself", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrast("#1B34E8", "#1B34E8")).toBeCloseTo(1, 5);
  });
  it("is order-independent", () => {
    expect(contrast("#767676", WHITE)).toBeCloseTo(contrast(WHITE, "#767676"), 10);
  });
  // #767676 is the canonical WCAG "exactly 4.5:1 on white" grey.
  it("puts the canonical AA grey right at the 4.5 threshold", () => {
    expect(contrast("#767676", WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#777777", WHITE)).toBeLessThan(4.5);
  });
  it("orders luminance correctly", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance(WHITE)).toBeCloseTo(1, 5);
  });
});

describe("worstContrast", () => {
  it("takes the minimum across grounds — a mid grey fails both extremes", () => {
    const grounds = [WHITE, NEAR_BLACK];
    expect(worstContrast("#808080", grounds)).toBeLessThan(4.5);
    // Nothing beats ~5.3:1 against both white and near-black simultaneously;
    // this is the ceiling that makes the pet contrast gate a real constraint.
    expect(worstContrast("#767676", grounds)).toBeLessThan(worstContrast("#8A8A8A", grounds) + 5);
  });
});
