import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, actionsSchema, appearanceSchema, safeActionUrl, usableActions } from "./config.js";

describe("appearance", () => {
  it("fills in every default from an empty object", () => {
    expect(DEFAULT_APPEARANCE.accent).toBe("pet");
    expect(DEFAULT_APPEARANCE.corner).toBe("soft");
    expect(DEFAULT_APPEARANCE.launcherSize).toBe(64);
  });
  it("accepts a partial override without losing the rest", () => {
    const a = appearanceSchema.parse({ corner: "square", density: "compact" });
    expect(a.corner).toBe("square");
    expect(a.bubbles).toBe("bordered");
  });
  it("rejects a launcher too small to hit or big enough to obstruct", () => {
    expect(() => appearanceSchema.parse({ launcherSize: 20 })).toThrow();
    expect(() => appearanceSchema.parse({ launcherSize: 200 })).toThrow();
  });
  it("rejects a non-hex accent", () => {
    expect(() => appearanceSchema.parse({ accent: "red" })).toThrow();
    expect(appearanceSchema.parse({ accent: "#1B34E8" }).accent).toBe("#1B34E8");
  });
});

describe("actions", () => {
  it("caps how many can be offered", () => {
    const one = { id: "a", label: "Go", kind: "link" as const, value: "https://x.test" };
    expect(() => actionsSchema.parse([one, one, one, one, one])).toThrow();
  });

  it("allows only https links", () => {
    expect(safeActionUrl("https://acme.test/demo")).toBe("https://acme.test/demo");
    expect(safeActionUrl("http://acme.test")).toBeNull();
    expect(safeActionUrl("not a url")).toBeNull();
  });

  it("rejects javascript: and data: URLs — the whole point of the allowlist", () => {
    // The widget renders owner-supplied strings into a page it does not own, so
    // these would be script execution on the customer's origin.
    expect(safeActionUrl("javascript:alert(1)")).toBeNull();
    expect(safeActionUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeActionUrl("JavaScript:alert(1)")).toBeNull();
  });

  it("drops an unusable action instead of failing the whole widget", () => {
    const actions = [
      { id: "ok", label: "Docs", kind: "link" as const, value: "https://acme.test" },
      { id: "bad", label: "Hack", kind: "link" as const, value: "javascript:alert(1)" },
      { id: "ask", label: "Pricing?", kind: "prompt" as const, value: "What does it cost?" },
    ];
    expect(usableActions(actions).map((a) => a.id)).toEqual(["ok", "ask"]);
  });
});
