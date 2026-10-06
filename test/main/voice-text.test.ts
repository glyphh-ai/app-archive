import { describe, expect, it } from "vitest";
import { PARTIAL_EVERY_MS, PARTIAL_MIN_MS, dictationText, partialDue } from "../../src/renderer/help/voice-text.js";

describe("the live transcript in the box (his order, 2026-10-07)", () => {
  it("rides after the text that was there, one space between, and replaces its own earlier partial", () => {
    expect(dictationText("", "hello there")).toBe("hello there");
    expect(dictationText("Fix the", "sync bug")).toBe("Fix the sync bug");
    expect(dictationText("Fix the ", "sync bug")).toBe("Fix the sync bug");
    expect(dictationText("Fix the", "  ")).toBe("Fix the");
    const base = "Draft:";
    const first = dictationText(base, "hel");
    expect(dictationText(base, "hello world")).not.toBe(first);
    expect(dictationText(base, "hello world")).toBe("Draft: hello world");
  });
  it("a partial is due every interval once the take is long enough and none is in flight", () => {
    const t0 = 10_000;
    expect(partialDue(t0 + 1_000, t0, 0, false)).toBe(false);
    expect(partialDue(t0 + PARTIAL_MIN_MS, t0, 0, false)).toBe(true);
    expect(partialDue(t0 + PARTIAL_MIN_MS, t0, 0, true)).toBe(false);
    const last = t0 + 3_000;
    expect(partialDue(last + PARTIAL_EVERY_MS - 1, t0, last, false)).toBe(false);
    expect(partialDue(last + PARTIAL_EVERY_MS, t0, last, false)).toBe(true);
  });
});
