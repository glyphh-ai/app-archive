/**
 * dock-keep.test.ts — the dock keeps its contents across restarts (his report,
 * 2026-10-07): a key leaves only when its family's list came back without it;
 * a failed or empty read prunes nothing.
 */
import { describe, expect, it } from "vitest";
import { keepDockKeys } from "../../src/renderer/help/dock-items.js";

const KEYS = ["glyphh", "app:gmail", "app:crm", "layout:research", "agent:claude", "agent:codex", "folder:1", "settings", "cc", "closeall"];

describe("keepDockKeys", () => {
  it("a family's list prunes the keys it lacks and nothing else", () => {
    expect(keepDockKeys(KEYS, { apps: ["app:gmail"] })).toEqual(KEYS.filter((k) => k !== "app:crm"));
    expect(keepDockKeys(KEYS, { layouts: ["layout:other"] })).toEqual(KEYS.filter((k) => k !== "layout:research"));
    expect(keepDockKeys(KEYS, { agents: ["agent:claude"] })).toEqual(KEYS.filter((k) => k !== "agent:codex"));
  });
  it("a failed read (null) or an empty answer prunes nothing — an empty answer is not a deletion", () => {
    expect(keepDockKeys(KEYS, { apps: null, layouts: null, agents: null })).toEqual(KEYS);
    expect(keepDockKeys(KEYS, { apps: [], layouts: [], agents: [] })).toEqual(KEYS);
    expect(keepDockKeys(KEYS, {})).toEqual(KEYS);
  });
  it("nav slots, folders and the controls are never pruned, whatever the lists say", () => {
    expect(keepDockKeys(KEYS, { apps: ["app:x"], layouts: ["layout:x"], agents: ["agent:x"] })).toEqual(["glyphh", "folder:1", "settings", "cc", "closeall"]);
  });
});
