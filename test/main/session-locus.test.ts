/**
 * session-locus.test.ts — where a session runs, as pure rules (his orders,
 * 2026-10-04): the ONE recents filter the rail and the dropdown share (loop +
 * place + type + search), the folder picker's two sections and its default
 * per surface, the lock on a desktop session whose folder the attached
 * desktop has not granted, and "cloud stays cloud".
 */
import { describe, expect, it } from "vitest";
import {
  defaultLocus, filterRecents, folderGranted, locusFilterOf, pickerSections, recentsFilterActive, recentsKeeps,
  sessionLocked, sourceLocus, LOCUS_LOCKED_HINT, type RecentsRowLike,
} from "../../src/renderer/help/session-locus";

const row = (p: Partial<RecentsRowLike> & { title: string }): RecentsRowLike =>
  ({ cwd: "", mode: "code", loopKey: "glyphh", locus: "local", ...p });

const rows: RecentsRowLike[] = [
  row({ title: "fix the sync bug", cwd: "/Users/me/code/app", loopKey: "glyphh", locus: "local" }),
  row({ title: "blog post", loopKey: "glyphh", locus: "cloud" }),
  row({ title: "claude refactor", cwd: "/Users/me/code/app", loopKey: "claude", locus: "local" }),
  row({ title: "triage mail", mode: "work", loopKey: "glyphh", locus: "local" }),
];

describe("the one recents filter", () => {
  it("keeps everything with nothing picked", () => {
    expect(filterRecents(rows, { loops: [], locus: "" })).toHaveLength(4);
    expect(recentsFilterActive({ loops: [], locus: "" })).toBe(false);
  });

  it("narrows by place — This desktop / Cloud — on top of the loop filter", () => {
    expect(filterRecents(rows, { loops: [], locus: "cloud" }).map((r) => r.title)).toEqual(["blog post"]);
    expect(filterRecents(rows, { loops: [], locus: "local" })).toHaveLength(3);
    expect(filterRecents(rows, { loops: ["claude"], locus: "local" }).map((r) => r.title)).toEqual(["claude refactor"]);
    expect(filterRecents(rows, { loops: ["claude"], locus: "cloud" })).toHaveLength(0);
    expect(recentsFilterActive({ loops: [], locus: "cloud" })).toBe(true);
  });

  it("applies the type tab and the search exactly as the rail does", () => {
    expect(filterRecents(rows, { tab: "work", loops: [], locus: "" }).map((r) => r.title)).toEqual(["triage mail"]);
    expect(filterRecents(rows, { tab: "code", loops: [], locus: "", query: "APP" }).map((r) => r.title)).toEqual(["fix the sync bug", "claude refactor"]);
  });

  it("a loop filter naming none of the loops a list can hold is no filter there (the CLI window)", () => {
    const cliOnly = new Set(["claude", "codex"]);
    expect(recentsKeeps(rows[2]!, { loops: ["glyphh"], among: cliOnly, locus: "" })).toBe(true);
    expect(recentsKeeps(rows[2]!, { loops: ["codex"], among: cliOnly, locus: "" })).toBe(false);
    expect(recentsFilterActive({ loops: ["glyphh"], among: cliOnly, locus: "" })).toBe(false);
  });

  it("a row with no locus stamp is the desktop's", () => {
    expect(recentsKeeps(row({ title: "old", locus: undefined }), { loops: [], locus: "local" })).toBe(true);
    expect(recentsKeeps(row({ title: "old", locus: undefined }), { loops: [], locus: "cloud" })).toBe(false);
  });

  it("coerces the stored pref", () => {
    expect(locusFilterOf("cloud")).toBe("cloud");
    expect(locusFilterOf("local")).toBe("local");
    expect(locusFilterOf("everywhere")).toBe("");
    expect(locusFilterOf(null)).toBe("");
  });
});

describe("the grant", () => {
  const grants = ["/Users/me/code", "C:\\work\\shoes"];
  it("is a whole-segment prefix, on either separator", () => {
    expect(folderGranted("/Users/me/code", grants)).toBe(true);
    expect(folderGranted("/Users/me/code/app/", grants)).toBe(true);
    expect(folderGranted("/Users/me/codex", grants)).toBe(false);
    expect(folderGranted("C:\\work\\shoes\\web", grants)).toBe(true);
    expect(folderGranted("C:/work/shoes/web", grants)).toBe(true);
    expect(folderGranted("", grants)).toBe(false);
  });

  it("locks a desktop session on the web only when its folder is outside every attached desktop's grants", () => {
    const machines = [{ id: "m1", name: "mbp", folders: ["/Users/me/code"] }];
    expect(sessionLocked({ locus: "local", cwd: "/Users/me/code/app" }, "web", machines)).toBe(false);
    expect(sessionLocked({ locus: "local", cwd: "/Users/me/secret" }, "web", machines)).toBe(true);
    expect(sessionLocked({ locus: "local", cwd: "/Users/me/secret" }, "web", [])).toBe(true);
    // A folderless (Work) thread and a cloud thread are never locked.
    expect(sessionLocked({ locus: "local", cwd: "" }, "web", machines)).toBe(false);
    expect(sessionLocked({ locus: "cloud", cwd: "/x" }, "web", [])).toBe(false);
    // On the desktop itself nothing is locked: the machine is this process.
    expect(sessionLocked({ locus: "local", cwd: "/Users/me/secret" }, "desktop", [])).toBe(false);
  });
});

describe("the picker", () => {
  const spaces = [{ id: "t1", updatedAt: 1, top: ["src"] }];

  it("defaults to the desktop where there is one, else the cloud", () => {
    expect(defaultLocus("desktop", false)).toBe("local");
    expect(defaultLocus("web", true)).toBe("local");
    expect(defaultLocus("web", false)).toBe("cloud");
  });

  it("on the desktop: 'On this desktop' then 'In the cloud'", () => {
    const m = pickerSections({ surface: "desktop", machines: [], spaces, bornLocus: null });
    expect(m.sections.map((s) => s.label)).toEqual(["On this desktop", "In the cloud"]);
    expect(m.sections[0].empty).toBeUndefined();
    expect(m.sections[1].spaces).toEqual(spaces);
    expect(m.defaultLocus).toBe("local");
  });

  it("on the web: 'On <machine>' lists that desktop's granted folders; none attached says so and defaults to the cloud", () => {
    const attached = pickerSections({ surface: "web", machines: [{ id: "m1", name: "chris-mbp", folders: ["/Users/me/code"] }], spaces, bornLocus: null });
    expect(attached.sections[0]).toMatchObject({ label: "On chris-mbp", folders: ["/Users/me/code"] });
    expect(attached.defaultLocus).toBe("local");
    const noGrant = pickerSections({ surface: "web", machines: [{ id: "m1", name: "chris-mbp", folders: [] }], spaces, bornLocus: null });
    expect(noGrant.sections[0].empty).toMatch(/No folder is granted/);
    const none = pickerSections({ surface: "web", machines: [], spaces, bornLocus: null });
    expect(none.sections[0].empty).toMatch(/No desktop is attached/);
    expect(none.defaultLocus).toBe("cloud");
  });

  it("cloud stays cloud: a born session locks the other section", () => {
    const cloudBorn = pickerSections({ surface: "desktop", machines: [], spaces, bornLocus: "cloud" });
    expect(cloudBorn.sections[0].locked).toBe(LOCUS_LOCKED_HINT.cloud);
    expect(cloudBorn.sections[1].locked).toBeUndefined();
    const localBorn = pickerSections({ surface: "desktop", machines: [], spaces, bornLocus: "local" });
    expect(localBorn.sections[0].locked).toBeUndefined();
    expect(localBorn.sections[1].locked).toBe(LOCUS_LOCKED_HINT.local);
  });

  it("reads a source's locus", () => {
    expect(sourceLocus({ kind: "local" })).toBe("local");
    expect(sourceLocus({ kind: "cloud-new" })).toBe("cloud");
    expect(sourceLocus({ kind: "cloud-space" })).toBe("cloud");
    expect(sourceLocus(null)).toBe("cloud");
  });
});
