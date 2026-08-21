import { describe, expect, it } from "vitest";
import { contrast, luminance, NEAR_BLACK, WHITE } from "../contrast.js";
import { validatePetPalette } from "./palette.js";
import { REFERENCE_PET, petSpecSchema, type PetPalette } from "./spec.js";

describe("the impossibility that sets the threshold", () => {
  // Guards the reasoning in palette.ts. If someone "tightens" the gate to 4.5
  // on both grounds, this test explains why every pet would then be rejected.
  it("no colour can clear 4.5:1 against both white and near-black", () => {
    let best = 0;
    for (let i = 0; i <= 255; i++) {
      const hex = `#${i.toString(16).padStart(2, "0").repeat(3)}`;
      best = Math.max(best, Math.min(contrast(hex, WHITE), contrast(hex, NEAR_BLACK)));
    }
    expect(best).toBeLessThan(4.5);
    expect(best).toBeGreaterThan(4.3); // ceiling is ~4.435 at L≈0.187
  });
});

describe("validatePetPalette", () => {
  it("passes the reference robot — the one design proven on both grounds", () => {
    expect(validatePetPalette(REFERENCE_PET.palette)).toEqual({ ok: true, issues: [] });
  });

  it("rejects a washed-out palette that would vanish on a white page", () => {
    const pale: PetPalette = {
      shellHi: "#FDFDFF", shellLo: "#F0F2FF", plateHi: "#F6F7FF", plateLo: "#EDEFFB",
      visorHi: "#E8EAF6", visorLo: "#E2E5F2", lit: "#FFFFFF",
    };
    const v = validatePetPalette(pale);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.rule.includes("white page"))).toBe(true);
  });

  it("rejects an all-dark palette that would vanish on a dark page", () => {
    const murk: PetPalette = {
      shellHi: "#14161C", shellLo: "#0C0E13", plateHi: "#101219", plateLo: "#090A0F",
      visorHi: "#070810", visorLo: "#050609", lit: "#12141B",
    };
    const v = validatePetPalette(murk);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.rule.includes("dark page"))).toBe(true);
  });

  it("rejects eyes that disappear into the visor", () => {
    const blind: PetPalette = { ...REFERENCE_PET.palette, lit: "#232B4B" };
    const v = validatePetPalette(blind);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.rule.includes("eyes are the face"))).toBe(true);
  });

  it("reports every failure at once so a re-roll can fix them in one pass", () => {
    const bad: PetPalette = {
      shellHi: "#7E8290", shellLo: "#7A7E8C", plateHi: "#80848F", plateLo: "#787C88",
      visorHi: "#7B7F8B", visorLo: "#797D89", lit: "#7D8189",
    };
    expect(validatePetPalette(bad).issues.length).toBeGreaterThan(1);
  });

  it("keeps the reference silhouette stops inside the straddle band", () => {
    const lums = Object.values(REFERENCE_PET.palette).map(luminance);
    expect(Math.min(...lums)).toBeLessThan(0.3); // something dark enough for white
    expect(Math.max(...lums)).toBeGreaterThan(0.11); // something light enough for black
  });
});

describe("petSpecSchema", () => {
  it("accepts the reference pet", () => {
    expect(petSpecSchema.parse(REFERENCE_PET)).toMatchObject({ name: "Terminal" });
  });
  it("normalises hex case and shorthand so stored specs compare equal", () => {
    const spec = petSpecSchema.parse({
      ...REFERENCE_PET,
      palette: { ...REFERENCE_PET.palette, lit: "#7fc0ff", shellHi: "c3f" },
    });
    expect(spec.palette.lit).toBe("#7FC0FF");
    expect(spec.palette.shellHi).toBe("#CC33FF");
  });
  it("rejects invented parts — the library is closed", () => {
    expect(() =>
      petSpecSchema.parse({ ...REFERENCE_PET, parts: { ...REFERENCE_PET.parts, head: "dragon" } }),
    ).toThrow();
  });
  it("rejects raw SVG smuggled into a colour field", () => {
    expect(() =>
      petSpecSchema.parse({
        ...REFERENCE_PET,
        palette: { ...REFERENCE_PET.palette, lit: "url(#x)\"><script>alert(1)</script>" },
      }),
    ).toThrow();
  });
});
