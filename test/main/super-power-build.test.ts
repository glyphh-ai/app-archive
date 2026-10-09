/**
 * The new super power modal's rules (his order, 2026-10-09: "a new button next
 * to super powers that opens a new super power modal"): what Glyphh is told,
 * how its answer is read, and the stage each tool lights.
 */
import { describe, it, expect } from "vitest";
import {
  parseBuiltSuperPower, superPowerBuildPrompt, superPowerToolBeat, SUPER_POWER_ASK_MAX,
} from "../../src/shared/super-power-build";

describe("what Glyphh is told", () => {
  it("builds the WHOLE super power: powers first, then agent_save with them", () => {
    const p = superPowerBuildPrompt("turn my YouTube videos into social posts");
    expect(p).toMatch(/SUPER POWER/);
    expect(p).toMatch(/skill_save/);
    expect(p).toMatch(/agent_save/);
    expect(p).toMatch(/`powers`/);
    expect(p).toMatch(/`connections`/);
    expect(p).toMatch(/Do not make its avatar/);
    expect(p.endsWith("turn my YouTube videos into social posts")).toBe(true);
  });

  it("never sends more of the ask than the cap", () => {
    const p = superPowerBuildPrompt("x".repeat(SUPER_POWER_ASK_MAX + 500));
    expect(p.split("\n").pop()!.length).toBe(SUPER_POWER_ASK_MAX);
  });
});

describe("reading what it made", () => {
  it("takes the LAST JSON line that names an agent", () => {
    const text = 'Planning {"agent":"draft"}\nDone!\n{"agent":"video-marketer","name":"Video Marketer","powers":["clip-finder","Post-Writer"],"connections":["youtube_data_api","linkedin"]}';
    expect(parseBuiltSuperPower(text)).toEqual({
      agent: "video-marketer", name: "Video Marketer", powers: ["clip-finder", "post-writer"], connections: ["youtube_data_api", "linkedin"],
    });
  });

  it("answers null when nothing names one, and drops junk slugs", () => {
    expect(parseBuiltSuperPower("I made it!")).toBeNull();
    expect(parseBuiltSuperPower('{"agent":""}')).toBeNull();
    expect(parseBuiltSuperPower('{"agent":"a","connections":["ok","bad slug!", 7]}')!.connections).toEqual(["ok", "7"]);
  });
});

describe("the stage each tool lights", () => {
  it("maps the build's tools onto the modal's five stages", () => {
    expect(superPowerToolBeat("agent_save").stage).toBe("life");
    expect(superPowerToolBeat("skill_save").stage).toBe("powers");
    expect(superPowerToolBeat("skills_list").stage).toBe("powers");
    expect(superPowerToolBeat("connector_tools").stage).toBe("connect");
    expect(superPowerToolBeat("models_available").stage).toBe("plan");
    expect(superPowerToolBeat("find_tools").stage).toBe("plan");
  });
});
