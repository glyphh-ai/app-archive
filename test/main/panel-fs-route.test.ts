/**
 * panel-fs-route.test.ts — where the Files / Diff / Editor panels read (his
 * report, 2026-10-04: "the workpanels like files, diff etc. are not adjusting
 * to the cloud directories"): the SESSION's locus decides on both surfaces —
 * a cloud session's panels read its worker workspace, scoped the way the run
 * threads (a re-entered space's id, else the thread's); a local session's
 * read the machine (this disk on the desktop, the attached desktop over the
 * relay on the web); a web session with no source is the relay, exactly as
 * the web's selector routed before.
 */
import { describe, expect, it } from "vitest";
import { CLOUD_FS_NOT_YET, CLOUD_FS_NO_MKDIR, CLOUD_FS_UNSERVED, panelFsRoute } from "../../src/renderer/help/panel-fs-route";
import { routeKey } from "../../src/renderer/help/wb-cloud";

const born = { kind: "cloud-new" };
const space = { kind: "cloud-space", space: "th-space", dir: "packages/web" };
const repo = { kind: "cloud-repo", repo: "glyphh-ai/app" };
const local = { kind: "local", path: "/Users/me/code/app" };

describe("a cloud session's panels read its worker workspace", () => {
  it("on the desktop, scoped to the thread", () => {
    expect(panelFsRoute({ surface: "desktop", source: born, chatId: "th-1" })).toEqual({ route: "cloud", scope: "th-1" });
    expect(panelFsRoute({ surface: "desktop", source: repo, chatId: "th-2" })).toEqual({ route: "cloud", scope: "th-2" });
  });
  it("on the web, the same way", () => {
    expect(panelFsRoute({ surface: "web", source: born, chatId: "th-1" })).toEqual({ route: "cloud", scope: "th-1" });
  });
  it("an UNBORN cloud session (no thread yet) is cloud with no scope — an empty panel, never this disk", () => {
    expect(panelFsRoute({ surface: "desktop", source: born, chatId: null })).toEqual({ route: "cloud", scope: "" });
  });
  it("a re-entered space is scoped to the SPACE's id (remote-run runThreadId)", () => {
    expect(panelFsRoute({ surface: "desktop", source: space, chatId: "th-9" })).toEqual({ route: "cloud", scope: "th-space" });
    expect(panelFsRoute({ surface: "web", source: space, chatId: "th-9" })).toEqual({ route: "cloud", scope: "th-space" });
  });
});

describe("a local session's panels read the machine", () => {
  it("the desktop's own disk", () => {
    expect(panelFsRoute({ surface: "desktop", source: local, chatId: "th-1" })).toEqual({ route: "local" });
  });
  it("no source on the desktop is this machine too", () => {
    expect(panelFsRoute({ surface: "desktop", source: null, chatId: "th-1" })).toEqual({ route: "local" });
    expect(panelFsRoute({ surface: "desktop" })).toEqual({ route: "local" });
  });
  it("on the web, the attached desktop over the relay", () => {
    expect(panelFsRoute({ surface: "web", source: local, chatId: "th-1" })).toEqual({ route: "relay-desktop" });
  });
  it("on the web with no source, the relay (the selector's 'everything else')", () => {
    expect(panelFsRoute({ surface: "web", source: null, chatId: "" })).toEqual({ route: "relay-desktop" });
  });
  it("an empty kind is no source", () => {
    expect(panelFsRoute({ surface: "desktop", source: { kind: "" }, chatId: "th-1" })).toEqual({ route: "local" });
  });
});

describe("the route key a session switch compares", () => {
  it("names the cloud SCOPE, so two cloud sessions differ", () => {
    expect(routeKey({ route: "cloud", scope: "a" })).toBe("cloud:a");
    expect(routeKey({ route: "cloud", scope: "b" })).not.toBe(routeKey({ route: "cloud", scope: "a" }));
    expect(routeKey({ route: "local" })).toBe("local");
    expect(routeKey({ route: "relay-desktop" })).toBe("relay-desktop");
  });
});

describe("what the pod does not serve is said in one line", () => {
  it("names the verbs", () => {
    expect([...CLOUD_FS_UNSERVED]).toEqual(["mkdir", "delete", "rename", "stat", "git status", "git log"]);
    expect(CLOUD_FS_NOT_YET).toMatch(/not available for cloud sessions yet/i);
    expect(CLOUD_FS_NO_MKDIR).toMatch(/not available for cloud sessions yet/i);
  });
});
