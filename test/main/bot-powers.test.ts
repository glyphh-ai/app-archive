/**
 * bot-powers.test.ts — a bot's powers (his order, 2026-10-09: "the list of
 * powers this bot has: folder(s), connections, models"): the row keeps them
 * through partial saves, and a turn reads them (shared/bot-powers.ts).
 */
import { describe, expect, it } from "vitest";
import { buildAgentRow } from "../../src/shared/member-library.js";
import { botPowersNote, botWorkFolder, withinFolder } from "../../src/shared/bot-powers.js";

describe("the agent row keeps its powers", () => {
  it("starts with none, takes a list, and keeps it through a save that leaves it out", () => {
    const base = buildAgentRow({ name: "Scout" }, null, "2026-10-09T00:00:00.000Z");
    expect(base.folders).toEqual([]);
    expect(base.connections).toEqual([]);
    expect(base.models).toEqual([]);
    const withPowers = buildAgentRow({ folders: ["/a", " /a ", "", "/b"], connections: ["gmail"], models: ["m2"] }, base, "2026-10-09T00:00:01.000Z");
    expect(withPowers.folders).toEqual(["/a", "/b"]);
    expect(withPowers.connections).toEqual(["gmail"]);
    expect(withPowers.models).toEqual(["m2"]);
    const renamed = buildAgentRow({ name: "Scout 2" }, withPowers, "2026-10-09T00:00:02.000Z");
    expect(renamed.folders).toEqual(["/a", "/b"]);
    expect(renamed.connections).toEqual(["gmail"]);
    const cleared = buildAgentRow({ connections: [] }, renamed, "2026-10-09T00:00:03.000Z");
    expect(cleared.connections).toEqual([]);
    expect(cleared.folders).toEqual(["/a", "/b"]);
  });
});

describe("a bot's turn reads its powers", () => {
  it("works inside the session's folder only: its own folders can narrow it, never widen it (2026-10-09)", () => {
    expect(botWorkFolder({ folders: ["/a", "/b"] }, ""), "no session folder, nowhere").toBe("");
    expect(botWorkFolder({ folders: ["/elsewhere", "/s/sub"] }, "/s")).toBe("/s/sub");
    expect(botWorkFolder({ folders: ["/a", "/b"] }, "/s"), "its folders are outside: the session's").toBe("/s");
    expect(botWorkFolder({ folders: ["/s2"] }, "/s"), "a sibling with the same prefix is outside").toBe("/s");
    expect(botWorkFolder({ folders: [] }, "/picked")).toBe("/picked");
    expect(botWorkFolder(null, "/picked")).toBe("/picked");
    expect(withinFolder("/s", "/s")).toBe(true);
    expect(withinFolder("/s/", "/s/x")).toBe(true);
    expect(withinFolder("/s", "/s2/x")).toBe(false);
    expect(withinFolder("", "/s")).toBe(false);
  });

  it("names its folders, connections, other models and powers, and nothing when it has none", () => {
    expect(botPowersNote({}, "/w")).toBe("");
    expect(botPowersNote(null, "/w")).toBe("");
    const note = botPowersNote({ model: "m1", folders: ["/a", "/b"], connections: ["gmail", "slack"], models: ["m1", "m2"], skills: ["pdf"] }, "/a");
    expect(note).toBe([
      "Your powers:",
      "- Folder: you work in /a, and nowhere else.",
      "- Connections: gmail, slack. Use these accounts for this work.",
      "- Models: you run on m1; you may also use m2.",
      "- Powers you may load: pdf.",
    ].join("\n"));
  });
});

import { botEffort, botPersonalityNote } from "../../src/shared/bot-powers.js";
import { buildAgentRow as buildRow } from "../../src/shared/member-library.js";

describe("the sliders and the voice", () => {
  it("keeps personality 1..5, an effort from the dial, and a voice with a model and an id", () => {
    const base = buildRow({ name: "Scout" }, null, "2026-10-09T00:00:00.000Z");
    expect(base.personality).toBeUndefined();
    expect(base.effort).toBeUndefined();
    expect(base.voice).toBeNull();
    const set = buildRow({ personality: 5, effort: "xhigh", voice: { model: "openai/tts", voiceId: "alloy", name: "Alloy" } }, base, "2026-10-09T00:00:01.000Z");
    expect(set.personality).toBe(5);
    expect(set.effort).toBe("xhigh");
    expect(set.voice).toEqual({ model: "openai/tts", voiceId: "alloy", name: "Alloy" });
    const kept = buildRow({ name: "Scout 2" }, set, "2026-10-09T00:00:02.000Z");
    expect(kept.personality).toBe(5);
    expect(kept.voice?.voiceId).toBe("alloy");
    const bad = buildRow({ personality: 9, effort: "turbo", voice: { model: "", voiceId: "x" } }, set, "2026-10-09T00:00:03.000Z");
    expect(bad.personality).toBeUndefined();
    expect(bad.effort).toBeUndefined();
    expect(bad.voice).toBeNull();
    expect(buildRow({ voice: null }, set, "2026-10-09T00:00:04.000Z").voice).toBeNull();
  });
  it("adds a personality line except in the middle, and leads with its own effort", () => {
    expect(botPersonalityNote({ personality: 3 })).toBe("");
    expect(botPersonalityNote({})).toBe("");
    expect(botPersonalityNote({ personality: 1 })).toMatch(/professional/);
    expect(botPersonalityNote({ personality: 5 })).toMatch(/playful/);
    expect(botEffort({ effort: "max" }, "low")).toBe("max");
    expect(botEffort({}, "low")).toBe("low");
    expect(botEffort(null, undefined)).toBeUndefined();
  });
});
