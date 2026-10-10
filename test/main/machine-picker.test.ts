/**
 * The picker's machines (his order, 2026-10-09): LOCAL is this desktop and
 * only on the desktop; REMOTE is every other attached desktop, inside its
 * grants, then the Glyphh machine. A born session is bound to its machine.
 */
import { describe, expect, it } from "vitest";
import { machineOfSource, machinePicker, namedFolderId, namedFolderOf, onOtherDesktop } from "../../src/renderer/help/session-locus";

const desktops = [
  { id: "sock-self", name: "chris-mbp", folders: ["/Users/chris/code"] },
  { id: "sock-b", name: "laptop-b", folders: ["/home/b/work", "/home/b/notes"] },
  { id: "sock-c", name: "studio", folders: [] },
];
const glyphh = [{ id: "m2", name: "spare" }, { id: "m1", name: "fly-machine-a", default: true }];

describe("the machines", () => {
  it("on the desktop: Local is this desktop, and Remote never lists it again", () => {
    const p = machinePicker({ surface: "desktop", desktops, selfId: "sock-self", glyphh, born: null });
    expect(p.local?.kind).toBe("local");
    expect(p.remote.map((r) => r.name)).toEqual(["laptop-b", "studio", "fly-machine-a"]);
    expect(p.remote[0]!.folders).toEqual(["/home/b/work", "/home/b/notes"]);
    expect(p.remote[1]!.empty).toMatch(/No folder is granted/);
  });

  it("on the web: no Local, every attached desktop is remote", () => {
    const p = machinePicker({ surface: "web", desktops, selfId: null, glyphh: [], born: null });
    expect(p.local).toBeNull();
    expect(p.remote.map((r) => r.name)).toEqual(["chris-mbp", "laptop-b", "studio", "Glyphh machine"]);
  });

  it("a born session is bound to its machine: every other one is locked", () => {
    const p = machinePicker({ surface: "desktop", desktops, selfId: "sock-self", glyphh, born: { kind: "local", machineId: "sock-b", machine: "laptop-b" } });
    expect(p.remote.find((r) => r.name === "laptop-b")!.locked).toBeUndefined();
    expect(p.local!.locked).toMatch(/runs on laptop-b/);
    expect(p.remote.find((r) => r.kind === "glyphh")!.locked).toMatch(/runs on laptop-b/);
  });

  it("a desktop's id changes per reconnect: its name still finds it", () => {
    const p = machinePicker({ surface: "desktop", desktops, selfId: "sock-self", glyphh, born: null });
    expect(machineOfSource(p, { kind: "local", machineId: "stale", machine: "laptop-b" })?.id).toBe("sock-b");
    expect(machineOfSource(p, { kind: "local" })?.kind).toBe("local");
    expect(machineOfSource(p, { kind: "cloud-new" })?.kind).toBe("glyphh");
  });

  it("only a local source naming another machine leaves this desktop", () => {
    expect(onOtherDesktop({ kind: "local" })).toBe(false);
    expect(onOtherDesktop({ kind: "local", machineId: "local" })).toBe(false);
    expect(onOtherDesktop({ kind: "local", machineId: "sock-b" })).toBe(true);
    expect(onOtherDesktop({ kind: "cloud-new", machineId: "sock-b" })).toBe(false);
  });
});

describe("a named folder on the Glyphh machine", () => {
  it("is a workspace of its own, keyed by its name within a run's thread-id rules", () => {
    expect(namedFolderId("Acme Site")).toBe("f-acme-site");
    expect(namedFolderId("  ")).toBe("");
    expect(namedFolderId("x".repeat(100))).toMatch(/^f-x{60}$/);
    expect(namedFolderId("Q3 report!")).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(namedFolderOf("f-acme-site")).toBe("acme-site");
    expect(namedFolderOf("c1k2j3")).toBe("");
  });
});

describe("a chip drop stays its height (his order, 2026-10-09)", () => {
  it("shows one page of rows and clamps the page into range", async () => {
    const { pageSlice, DROP_PAGE } = await import("../../src/renderer/help/drop-page");
    const many = Array.from({ length: 20 }, (_, i) => i);
    expect(pageSlice(many, 0).items).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pageSlice(many, 0).pages).toBe(Math.ceil(20 / DROP_PAGE));
    expect(pageSlice(many, 9)).toMatchObject({ page: 3, items: [18, 19] });
    expect(pageSlice(many, -2).page).toBe(0);
    expect(pageSlice([], 0)).toEqual({ items: [], page: 0, pages: 1 });
  });
});
