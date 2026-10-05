/**
 * agent-menu.test.ts — the agent window's ONE ⋮ menu, as data
 * (src/renderer/help/agent-menu.ts; his orders, 2026-10-05): on the web,
 * attached → Apps enabled with the desktop's rows and each CLI's desktop
 * sessions; not attached → Apps disabled with the one line and the Devices
 * link; the CLIs are always there. On both surfaces: Work never lists
 * Files / Terminal / Editor / Diff, the Session section exists only for an
 * open session, and no section is ever empty.
 */
import { describe, it, expect } from "vitest";
import {
  agentMenuModel, toolViewsFor, toolRowsFor, sessionRowsFor, openedOnLine,
  CONNECT_DESKTOP_LINE, CONNECT_DESKTOP_LINK, NO_APPS_LINE, APPS_SECTION_LABEL, CLIS_SECTION_LABEL, TOOLS_SECTION_LABEL, SESSION_SECTION_LABEL,
  CLI_SESSIONS_PER_CLI, DESKTOP_CODE_TOOL_VIEWS,
  type MenuAppRow, type MenuCliSession, type MenuSection,
} from "../../src/renderer/help/agent-menu.js";
import { WEB_TOOL_VIEWS } from "../../src/renderer/help/web-cut.js";

const CLIS = [
  { id: "claude", name: "Claude" }, { id: "codex", name: "Codex" }, { id: "gemini", name: "Gemini" },
  { id: "copilot", name: "Copilot" }, { id: "cursor", name: "Cursor" }, { id: "glyphh", name: "Glyphh CLI" },
];
const MAC = { id: "m1", name: "Chris's MacBook" };
const apps: MenuAppRow[] = [
  { slug: "gmail", name: "Gmail", icon: "data:image/png;base64,AAAA", machineId: "m1", machineName: MAC.name },
  { slug: "linear", name: "Linear", icon: null, machineId: "m1", machineName: MAC.name },
  { slug: "notes", name: "Notes", icon: "/webicon?u=x", machineId: "m1", machineName: MAC.name },
];
const sess = (id: string, cli: string, mtime: number): MenuCliSession => ({ id, cli, title: `s-${id}`, cwd: "/w", mtime });
const section = <K extends MenuSection["kind"]>(m: { sections: MenuSection[] }, kind: K): Extract<MenuSection, { kind: K }> | undefined =>
  m.sections.find((s): s is Extract<MenuSection, { kind: K }> => s.kind === kind);
const kinds = (m: { sections: MenuSection[] }): string[] => m.sections.map((s) => s.kind);

describe("web, attached — a desktop answers", () => {
  const m = agentMenuModel({ surface: "web", mode: "code", session: { pinned: false }, machines: [MAC], apps, clis: CLIS, cliSessions: [sess("a", "claude", 3), sess("b", "codex", 2), sess("c", "claude", 1)] });
  it("the sections, in order: Apps, Agents / CLIs, Panels, Session", () => {
    expect(kinds(m)).toEqual(["apps", "clis", "tools", "session"]);
    expect(m.sections.map((s) => s.label)).toEqual([APPS_SECTION_LABEL, CLIS_SECTION_LABEL, TOOLS_SECTION_LABEL, SESSION_SECTION_LABEL]);
  });
  it("Apps is enabled with the desktop's rows, icons carried, no note", () => {
    expect(m.attached).toBe(true);
    expect(m.machine).toEqual(MAC);
    const a = section(m, "apps")!;
    expect(a.enabled).toBe(true);
    expect(a.rows.map((r) => r.slug)).toEqual(["gmail", "linear", "notes"]);
    expect(a.rows[0]!.icon).toMatch(/^data:image/);
    expect(a.note).toBeNull();
    expect(a.link).toBeNull();
  });
  it("every CLI is listed, in order, with its own desktop sessions newest first", () => {
    const c = section(m, "clis")!;
    expect(c.rows.map((x) => x.id)).toEqual(["claude", "codex", "gemini", "copilot", "cursor", "glyphh"]);
    expect(c.rows[0]!.sessions.map((s) => s.id)).toEqual(["a", "c"]);
    expect(c.rows[1]!.sessions.map((s) => s.id)).toEqual(["b"]);
    expect(c.rows[2]!.sessions).toEqual([]);
  });
  it("a CLI's sessions are capped", () => {
    const many = Array.from({ length: 12 }, (_, i) => sess(`x${i}`, "claude", i));
    const mm = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [MAC], apps: [], clis: CLIS, cliSessions: many });
    expect(section(mm, "clis")!.rows[0]!.sessions.length).toBe(CLI_SESSIONS_PER_CLI);
    expect(section(mm, "clis")!.rows[0]!.sessions[0]!.id).toBe("x11");
  });
  it("an attached desktop with nothing installed says so, still enabled", () => {
    const mm = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [MAC], apps: [], clis: CLIS, cliSessions: [] });
    const a = section(mm, "apps")!;
    expect(a.enabled).toBe(true);
    expect(a.rows).toEqual([]);
    expect(a.note).toBe(NO_APPS_LINE);
    expect(a.link).toBeNull();
  });
  it("two desktops with the same app list it once; a row without a slug is dropped", () => {
    const mm = agentMenuModel({
      surface: "web", mode: "code", session: null,
      machines: [MAC, { id: "m2", name: "Other" }],
      apps: [...apps, { slug: "Gmail", name: "Gmail", machineId: "m2", machineName: "Other" }, { slug: "", name: "ghost", machineId: "m2", machineName: "Other" }],
      clis: CLIS, cliSessions: [],
    });
    expect(section(mm, "apps")!.rows.map((r) => r.slug)).toEqual(["gmail", "linear", "notes"]);
    expect(mm.machine).toEqual(MAC);
  });
});

describe("web, not attached — no desktop", () => {
  const m = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [], apps, clis: CLIS, cliSessions: [sess("a", "claude", 3)] });
  it("Apps is present but disabled, with the line and the Devices link, no rows", () => {
    expect(m.attached).toBe(false);
    expect(m.machine).toBeNull();
    const a = section(m, "apps")!;
    expect(a.enabled).toBe(false);
    expect(a.rows).toEqual([]);
    expect(a.note).toBe(CONNECT_DESKTOP_LINE);
    expect(CONNECT_DESKTOP_LINE).toBe("Connect your desktop to open apps");
    expect(a.link).toEqual({ label: CONNECT_DESKTOP_LINK, settingsSub: "devices" });
  });
  it("the CLIs are still there (cloud terminals), with no desktop sessions under them", () => {
    const c = section(m, "clis")!;
    expect(c.rows.map((x) => x.id)).toEqual(CLIS.map((x) => x.id));
    for (const x of c.rows) expect(x.sessions).toEqual([]);
  });
  it("the web's Panels never carry the Browser", () => {
    expect(section(m, "tools")!.rows.map((t) => t.view)).toEqual([...WEB_TOOL_VIEWS]);
    expect(section(m, "tools")!.rows.some((t) => t.view === "preview")).toBe(false);
  });
});

describe("ONE menu, both surfaces — the session's type decides the panels (his report, 2026-10-05)", () => {
  it("Code on the desktop: the old Developer-tools list, Browser included", () => {
    expect([...toolViewsFor("desktop", "code")]).toEqual([...DESKTOP_CODE_TOOL_VIEWS]);
    expect(toolRowsFor("desktop", "code").map((t) => t.label)).toEqual(["Files", "Terminal", "Editor", "Browser", "Diff", "Plan", "Agents"]);
  });
  it("Work never lists Files / Terminal / Editor / Diff — on either surface", () => {
    for (const surface of ["web", "desktop"] as const) {
      const views = toolViewsFor(surface, "work");
      for (const v of ["files", "terminal", "monaco", "diff"]) expect(views).not.toContain(v);
      expect(views).toContain("agents");
    }
    expect([...toolViewsFor("desktop", "work")]).toEqual(["preview", "agents"]);
    expect([...toolViewsFor("web", "work")]).toEqual(["agents"]);
  });
  it("the desktop menu has no Apps / CLIs sections (the wall carries them there)", () => {
    const m = agentMenuModel({ surface: "desktop", mode: "code", session: { pinned: true }, machines: [MAC], apps, clis: CLIS, cliSessions: [sess("a", "claude", 1)] });
    expect(kinds(m)).toEqual(["tools", "session"]);
    expect(m.attached).toBe(false);
  });
  it("a fresh landing has no Session section; an open session has Rename / Pin / New agent panel / Delete", () => {
    expect(sessionRowsFor(null)).toEqual([]);
    expect(sessionRowsFor({ pinned: false }).map((r) => `${r.action}:${r.label}${r.danger ? "!" : ""}`))
      .toEqual(["rename:Rename", "pin:Pin", "new-panel:New agent panel", "delete:Delete!"]);
    expect(sessionRowsFor({ pinned: true })[1]!.label).toBe("Unpin");
    const fresh = agentMenuModel({ surface: "desktop", mode: "work", session: null });
    expect(kinds(fresh)).toEqual(["tools"]);
  });
  it("never an empty dropdown, never an empty section — every combination", () => {
    for (const surface of ["web", "desktop"] as const) {
      for (const mode of ["work", "code"] as const) {
        for (const session of [null, { pinned: false }]) {
          for (const machines of [[], [MAC]]) {
            const m = agentMenuModel({ surface, mode, session, machines, apps: [], clis: surface === "web" ? CLIS : [], cliSessions: [] });
            expect(m.sections.length).toBeGreaterThan(0);
            for (const s of m.sections) {
              if (s.kind === "apps") expect(s.rows.length > 0 || !!s.note).toBe(true);
              else expect(s.rows.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });
  it("a web menu with no CLI rows yet drops the section rather than heading nothing", () => {
    const m = agentMenuModel({ surface: "web", mode: "work", session: null, machines: [], apps: [], clis: [], cliSessions: [] });
    expect(kinds(m)).toEqual(["apps", "tools"]);
  });
});

describe("the toast", () => {
  it("names the machine", () => {
    expect(openedOnLine("Chris's MacBook")).toBe("Opened on Chris's MacBook");
    expect(openedOnLine("")).toBe("Opened on your desktop");
  });
});
