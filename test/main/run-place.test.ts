/**
 * run-place.test.ts — where a CLI opened from the Echo runs (his order,
 * 2026-10-07): the desktops first, then Default and the member's environments,
 * the composer's current place checked.
 */
import { describe, expect, it } from "vitest";
import { folderRows, runPlaceRows } from "../../src/renderer/help/run-place.js";

describe("runPlaceRows", () => {
  it("web: the attached desktops, then Default and the member's environments; the current place is checked", () => {
    const rows = runPlaceRows({
      surface: "web",
      machines: [{ id: "m1", name: "Studio" }, { id: "m2", name: "Laptop" }],
      environments: [{ id: "e1", name: "Staging", subline: "Full network · 3 vars" }],
      current: { kind: "cloud", environmentId: "e1" },
    });
    expect(rows.map((r) => [r.section, r.label, r.selected])).toEqual([
      ["desktop", "Studio", false], ["desktop", "Laptop", false],
      ["cloud", "Default", false], ["cloud", "Staging", true],
    ]);
    expect(rows[3]!.sub).toBe("Full network · 3 vars");
    expect(rows[0]!.place).toEqual({ kind: "desktop", machine: { id: "m1", name: "Studio" } });
  });
  it("web with no desktop attached: a disabled note, never a desktop row", () => {
    const rows = runPlaceRows({ surface: "web", machines: [], environments: [], current: null });
    expect(rows[0]).toMatchObject({ section: "desktop", place: null, label: "No desktop attached" });
    expect(rows.slice(1).map((r) => r.label)).toEqual(["Default"]);
  });
  it("desktop: the machine is itself; a desktop pick with no machine id is the checked one", () => {
    const rows = runPlaceRows({ surface: "desktop", machines: [], environments: [], current: { kind: "desktop", machine: { name: "x" } } });
    expect(rows[0]).toMatchObject({ section: "desktop", label: "This desktop", selected: true, place: { kind: "desktop", machine: { name: "This desktop" } } });
  });
  it("a member environment named default never doubles the Default row", () => {
    const rows = runPlaceRows({ surface: "desktop", machines: [], environments: [{ id: "default", name: "Default" }], current: null });
    expect(rows.filter((r) => r.section === "cloud")).toHaveLength(1);
  });
});

describe("folderRows — the folder step after a desktop pick (his order, 2026-10-07)", () => {
  it("the granted folders lead, then recent folders inside a grant, each once", () => {
    const rows = folderRows({ folders: ["/Users/chris/code", "/Users/chris/docs"] }, ["/Users/chris/code/app", "/Users/chris/secret", "/Users/chris/code", "/Users/chris/code/app"]);
    expect(rows.map((r) => r.path)).toEqual(["/Users/chris/code", "/Users/chris/docs", "/Users/chris/code/app"]);
    expect(rows[0]).toEqual({ path: "/Users/chris/code", label: "code", sub: "/Users/chris/code" });
  });
  it("on the desktop itself (no grants) the recents stand alone; nothing → no rows", () => {
    expect(folderRows({}, ["/w/a", "/w/b", "/w/a"]).map((r) => r.path)).toEqual(["/w/a", "/w/b"]);
    expect(folderRows({ folders: [] }, [])).toEqual([]);
  });
});
