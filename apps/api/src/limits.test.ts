import { describe, expect, it } from "vitest";
import { originAllowed } from "./limits.js";

describe("originAllowed", () => {
  it("permits everything when the allowlist is empty — a new bot works immediately", () => {
    expect(originAllowed("https://anything.com", [])).toBe(true);
    expect(originAllowed(undefined, [])).toBe(true);
  });

  it("matches an exact host", () => {
    expect(originAllowed("https://acme.com", ["acme.com"])).toBe(true);
    expect(originAllowed("https://evil.com", ["acme.com"])).toBe(false);
  });

  it("ignores scheme and port differences in the pattern's favour", () => {
    expect(originAllowed("http://acme.com", ["acme.com"])).toBe(true);
    expect(originAllowed("https://acme.com:8443", ["acme.com:8443"])).toBe(true);
  });

  it("matches subdomains under a wildcard", () => {
    expect(originAllowed("https://app.acme.com", ["*.acme.com"])).toBe(true);
    expect(originAllowed("https://deep.app.acme.com", ["*.acme.com"])).toBe(true);
  });

  it("does not let a wildcard match a lookalike suffix", () => {
    // The bug worth guarding: endsWith("acme.com") would admit notacme.com.
    expect(originAllowed("https://notacme.com", ["*.acme.com"])).toBe(false);
    expect(originAllowed("https://evil-acme.com", ["*.acme.com"])).toBe(false);
  });

  it("refuses a request with no Origin once an allowlist is configured", () => {
    expect(originAllowed(undefined, ["acme.com"])).toBe(false);
  });

  it("refuses a malformed origin", () => {
    expect(originAllowed("not a url", ["acme.com"])).toBe(false);
  });

  it("accepts any entry in a multi-entry list", () => {
    const list = ["acme.com", "*.acme.dev", "staging.example.org"];
    expect(originAllowed("https://acme.com", list)).toBe(true);
    expect(originAllowed("https://x.acme.dev", list)).toBe(true);
    expect(originAllowed("https://staging.example.org", list)).toBe(true);
    expect(originAllowed("https://example.org", list)).toBe(false);
  });
});
