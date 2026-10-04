/**
 * dock-items.test.ts — the dock's item list and the wall's one rule for it
 * (src/renderer/help/dock-items.ts): with the dock on, the wall drops what
 * the dock carries; with the dock off, the dock's tiles lead the wall in the
 * dock's own order, and nothing shows twice (his order, 2026-10-04).
 */
import { describe, it, expect } from "vitest";
import { DOCK_ITEMS, dockItemFor, wallTilesFor } from "../../src/renderer/help/dock-items.js";

type Tile = { key: string | null; name: string };
const t = (key: string | null, name = key ?? "unkeyed"): Tile => ({ key, name });
const keyOf = (x: Tile): string | null => x.key;
const names = (xs: Tile[]): string[] => xs.map((x) => x.name);

describe("DOCK_ITEMS — the dock's shipped slots", () => {
  it("is the five nav slots, openers first, controls last, each key once", () => {
    expect(DOCK_ITEMS.map((d) => d.key)).toEqual(["glyphh", "newtab", "settings", "cc", "closeall"]);
    expect(new Set(DOCK_ITEMS.map((d) => d.key)).size).toBe(DOCK_ITEMS.length);
  });
  it("carries a title and an icon for every slot", () => {
    for (const d of DOCK_ITEMS) {
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.icon).toMatch(/^<(svg|img)\b/);
    }
  });
  it("answers a nav key and nothing else", () => {
    expect(dockItemFor("settings")?.title).toBe("Settings");
    expect(dockItemFor("agent:claude")).toBeNull();
    expect(dockItemFor("dock:settings")).toBeNull();
  });
});

describe("wallTilesFor — what the pages show", () => {
  const dock = [t("dock:glyphh", "New session"), t("dock:newtab", "New tab"), t("agent:claude", "Claude"), t("agent:codex", "Codex"), t("dock:settings", "Settings"), t("dock:cc", "Command center"), t("dock:closeall", "Close all")];
  const wall = [t("agent:cursor", "Cursor"), t("agent:claude", "Claude"), t("agent:gemini", "Gemini"), t("agent:codex", "Codex"), t("app:notes", "Notes"), t(null, "Home")];

  it("with the dock ON, shows the wall minus what the dock carries — unchanged", () => {
    expect(names(wallTilesFor({ dockEnabled: true, dockItems: dock, wallItems: wall, keyOf })))
      .toEqual(["Cursor", "Gemini", "Notes", "Home"]);
  });

  it("with the dock OFF, leads with the dock's tiles in the dock's order, then the wall's, no duplicates", () => {
    expect(names(wallTilesFor({ dockEnabled: false, dockItems: dock, wallItems: wall, keyOf })))
      .toEqual(["New session", "New tab", "Claude", "Codex", "Settings", "Command center", "Close all", "Cursor", "Gemini", "Notes", "Home"]);
  });

  it("keeps the dock's own order, not the wall's, for a CLI both carry", () => {
    const out = wallTilesFor({ dockEnabled: false, dockItems: [t("agent:codex", "Codex"), t("agent:claude", "Claude")], wallItems: wall, keyOf });
    expect(names(out).slice(0, 2)).toEqual(["Codex", "Claude"]);
    expect(names(out).filter((n) => n === "Claude")).toHaveLength(1);
  });

  it("never repeats a key the dock itself lists twice", () => {
    const out = wallTilesFor({ dockEnabled: false, dockItems: [t("dock:settings", "Settings"), t("dock:settings", "Settings again")], wallItems: [], keyOf });
    expect(names(out)).toEqual(["Settings"]);
  });

  it("keeps every unkeyed tile where it sits, on or off", () => {
    const items = [t(null, "A"), t("x"), t(null, "B")];
    expect(names(wallTilesFor({ dockEnabled: true, dockItems: [t("x")], wallItems: items, keyOf }))).toEqual(["A", "B"]);
    expect(names(wallTilesFor({ dockEnabled: false, dockItems: [t("x")], wallItems: items, keyOf }))).toEqual(["x", "A", "B"]);
  });

  it("is the plain wall with no dock items, either way", () => {
    expect(names(wallTilesFor({ dockEnabled: true, dockItems: [], wallItems: wall, keyOf }))).toEqual(names(wall));
    expect(names(wallTilesFor({ dockEnabled: false, dockItems: [], wallItems: wall, keyOf }))).toEqual(names(wall));
  });

  it("does not mutate its inputs", () => {
    const d = [...dock]; const w = [...wall];
    wallTilesFor({ dockEnabled: false, dockItems: dock, wallItems: wall, keyOf });
    expect(dock).toEqual(d); expect(wall).toEqual(w);
  });
});
