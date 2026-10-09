/**
 * power-build.test.ts — + Add on Your powers (his order, 2026-10-09): what
 * Glyphh is told, and how its reply is read back.
 */
import { describe, expect, it } from "vitest";
import { parseBuiltPower, powerBuildPrompt, POWER_ASK_MAX } from "../../src/shared/power-build.js";

describe("building a power with Glyphh", () => {
  it("tells it to build one with skill_save, declare connections, and say what it made", () => {
    const p = powerBuildPrompt("brief me every morning from gmail and my calendar");
    expect(p).toContain("skill_save");
    expect(p).toContain("connections");
    expect(p).toContain("brief me every morning");
    expect(powerBuildPrompt("x".repeat(5000)).length).toBeLessThan(5000 + 1000);
    expect(POWER_ASK_MAX).toBe(2000);
  });
  it("reads the last JSON line back", () => {
    const reply = 'I built it.\n{"slug":"old","type":"skill","name":"Old"}\nThen fixed it.\n{"slug":"morning-brief","type":"task","name":"Morning brief","connections":["gmail","Google_Calendar","bad slug!"]}';
    expect(parseBuiltPower(reply)).toEqual({ slug: "morning-brief", type: "task", name: "Morning brief", connections: ["gmail", "google_calendar"] });
    expect(parseBuiltPower('{"slug":"x"}')).toEqual({ slug: "x", type: "skill", name: "x", connections: [] });
    expect(parseBuiltPower("no json here")).toBeNull();
    expect(parseBuiltPower('{"name":"no slug"}')).toBeNull();
  });
});
