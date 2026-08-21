import { describe, expect, it } from "vitest";
import { isTransient } from "./gemini.js";

/**
 * Which upstream failures are worth retrying.
 *
 * The messages below are the real shapes the API returns — a 429 means two
 * different things and only one of them backs off successfully.
 */

const err = (message: string) => new Error(message);

describe("isTransient", () => {
  it("retries an overloaded model", () => {
    expect(isTransient(err('{"error":{"code":503,"message":"The service is currently unavailable."}}'))).toBe(true);
    expect(isTransient(err('{"error":{"code":503,"message":"This model is currently experiencing high demand."}}'))).toBe(true);
  });

  it("retries a per-minute rate limit", () => {
    expect(isTransient(err('{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota)."}}'))).toBe(true);
  });

  it("does NOT retry a hard quota exhaustion", () => {
    // Backing off cannot clear a quota window, so four attempts only add ~20s
    // to an error the caller receives regardless — and it reads as a hang.
    expect(
      isTransient(err('{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details."}}')),
    ).toBe(false);
  });

  it("does NOT retry a bad request or a missing model — those are bugs", () => {
    expect(isTransient(err('{"error":{"code":404,"message":"models/gemini-3.1-flash is not found"}}'))).toBe(false);
    expect(isTransient(err('{"error":{"code":400,"message":"Invalid JSON payload"}}'))).toBe(false);
  });

  it("does not retry an arbitrary programming error", () => {
    expect(isTransient(err("Cannot read properties of undefined"))).toBe(false);
  });

  it("retries 5xx server errors", () => {
    for (const code of [500, 502, 504]) {
      expect(isTransient(err(`{"error":{"code":${code}}}`)), String(code)).toBe(true);
    }
  });
});
