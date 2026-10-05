/**
 * agent-menu.test.ts — the agent window's ONE ⋮ menu, as data
 * (src/renderer/help/agent-menu.ts; his orders, 2026-10-05, and his review of
 * the web cut the same day): THE ORDER IS THE DESKTOP'S on both surfaces —
 * one frozen list, the desktop's a prefix of the web's; Apps and Agents /
 * CLIs are expandable sections, COLLAPSED on every open; Apps lists ONLY the
 * Glyphh apps the attached desktop can load; not attached → Apps disabled
 * with the one line and the Devices link. Work never lists Files / Terminal /
 * Editor / Diff, the Session section exists only for an open session, and no
 * section is ever empty.
 */
import { describe, it, expect } from "vitest";
import {
  agentMenuModel, appRowOpen, toolViewsFor, toolRowsFor, sessionRowsFor, openedOnLine, glyphhAppsOnly, sectionHeadLabel,
  menuFoldState, toggleFold, isExpanded, cliFoldKey,
  CONNECT_DESKTOP_LINE, CONNECT_DESKTOP_LINK, NO_APPS_LINE, APPS_SECTION_LABEL, CLIS_SECTION_LABEL, TOOLS_SECTION_LABEL, SESSION_SECTION_LABEL,
  CLI_SESSIONS_PER_CLI, DESKTOP_CODE_TOOL_VIEWS, MENU_SECTION_ORDER, COLLAPSIBLE_SECTIONS, GLYPHH_APP_KIND,
  type MenuAppRow, type MenuCliSession, type MenuSection, menuLocusOf } from "../../src/renderer/help/agent-menu.js";
import { WEB_TOOL_VIEWS } from "../../src/renderer/help/web-cut.js";

const CLIS = [
  { id: "claude", name: "Claude" }, { id: "codex", name: "Codex" }, { id: "gemini", name: "Gemini" },
  { id: "copilot", name: "Copilot" }, { id: "cursor", name: "Cursor" }, { id: "glyphh", name: "Glyphh CLI" },
];
const MAC = { id: "m1", name: "Chris's MacBook" };
/** What the desktop's panelApps.list hands over, kinded by web-contract.js: two Glyphh bundles among URL tabs and a native app. */
const apps: MenuAppRow[] = [
  { slug: "gmail", name: "Gmail", kind: "web", icon: "/webicon?u=x", machineId: "m1", machineName: MAC.name },
  { slug: "slides", name: "Slides", kind: "glyphh", icon: "data:image/png;base64,AAAA", machineId: "m1", machineName: MAC.name },
  { slug: "linear", name: "Linear", kind: "web", icon: null, machineId: "m1", machineName: MAC.name },
  { slug: "notes", name: "Notes", kind: "native", icon: null, machineId: "m1", machineName: MAC.name },
  { slug: "crm", name: "CRM", kind: "glyphh", icon: null, machineId: "m1", machineName: MAC.name },
];
const sess = (id: string, cli: string, mtime: number): MenuCliSession => ({ id, cli, title: `s-${id}`, cwd: "/w", mtime });
const section = <K extends MenuSection["kind"]>(m: { sections: MenuSection[] }, kind: K): Extract<MenuSection, { kind: K }> | undefined =>
  m.sections.find((s): s is Extract<MenuSection, { kind: K }> => s.kind === kind);
const kinds = (m: { sections: MenuSection[] }): string[] => m.sections.map((s) => s.kind);

describe("THE ORDER IS THE DESKTOP'S (his review, 2026-10-05) — one frozen list for both surfaces", () => {
  it("the frozen lists: desktop = Panels, Session; web = the same first, then Apps, Agents / CLIs", () => {
    expect([...MENU_SECTION_ORDER.desktop]).toEqual(["tools", "session"]);
    expect([...MENU_SECTION_ORDER.web]).toEqual(["tools", "session", "apps", "clis"]);
    expect(Object.isFrozen(MENU_SECTION_ORDER)).toBe(true);
    expect(Object.isFrozen(MENU_SECTION_ORDER.web)).toBe(true);
    expect(Object.isFrozen(MENU_SECTION_ORDER.desktop)).toBe(true);
  });
  it("the desktop's order is a PREFIX of the web's — the first rows are identical", () => {
    expect([...MENU_SECTION_ORDER.web].slice(0, MENU_SECTION_ORDER.desktop.length)).toEqual([...MENU_SECTION_ORDER.desktop]);
  });
  it("a full menu on each surface paints in exactly that order", () => {
    const web = agentMenuModel({ surface: "web", mode: "code", session: { pinned: false }, machines: [MAC], apps, clis: CLIS, cliSessions: [], locus: "local" });
    expect(kinds(web)).toEqual([...MENU_SECTION_ORDER.web]);
    expect(web.sections.map((s) => s.label)).toEqual([TOOLS_SECTION_LABEL, SESSION_SECTION_LABEL, APPS_SECTION_LABEL, CLIS_SECTION_LABEL]);
    const desk = agentMenuModel({ surface: "desktop", mode: "code", session: { pinned: false } });
    expect(kinds(desk)).toEqual([...MENU_SECTION_ORDER.desktop]);
    // The desktop's rows, verbatim, lead the web's menu (Browser aside — a streamed panel the web never reaches).
    const deskRows = desk.sections.flatMap((s) => s.rows.map((r) => ("label" in r ? r.label : "")));
    const webRows = web.sections.slice(0, 2).flatMap((s) => s.rows.map((r) => ("label" in r ? r.label : "")));
    expect(webRows).toEqual(deskRows.filter((l) => l !== "Browser"));
    expect(deskRows).toEqual(["Files", "Terminal", "Editor", "Browser", "Diff", "Plan", "Agents", "Artifacts", "Rename", "Pin", "New agent panel", "Delete"]);
  });
});

describe("EXPANDABLE SECTIONS, COLLAPSED ON OPEN (his review, 2026-10-05)", () => {
  it("Apps and Agents / CLIs are the collapsible ones, with a count on the head", () => {
    expect([...COLLAPSIBLE_SECTIONS]).toEqual(["apps", "clis"]);
    const m = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [MAC], apps, clis: CLIS, cliSessions: [sess("a", "claude", 1)], locus: "local" });
    const a = section(m, "apps")!;
    const c = section(m, "clis")!;
    expect(a.collapsible).toBe(true);
    expect(c.collapsible).toBe(true);
    expect(a.count).toBe(2);
    expect(c.count).toBe(6);
    expect(sectionHeadLabel(a.label, a.count)).toBe("Apps · 2");
    expect(sectionHeadLabel(c.label, c.count)).toBe("Agents / CLIs · 6");
    expect(section(m, "tools")).not.toHaveProperty("collapsible");
  });
  it("a fresh open expands nothing; a toggle opens one fold and a second closes it", () => {
    const folds = menuFoldState();
    for (const k of ["apps", "clis", cliFoldKey("claude")]) expect(isExpanded(folds, k)).toBe(false);
    expect(toggleFold(folds, "apps")).toBe(true);
    expect(isExpanded(folds, "apps")).toBe(true);
    expect(isExpanded(folds, "clis")).toBe(false);
    expect(toggleFold(folds, "apps")).toBe(false);
    expect(isExpanded(folds, "apps")).toBe(false);
  });
  it("a CLI's nested sessions fold under their own key, independent of the section's", () => {
    const folds = menuFoldState();
    toggleFold(folds, "clis");
    expect(isExpanded(folds, cliFoldKey("claude"))).toBe(false);
    toggleFold(folds, cliFoldKey("claude"));
    expect(isExpanded(folds, cliFoldKey("claude"))).toBe(true);
    expect(isExpanded(folds, cliFoldKey("codex"))).toBe(false);
    // The next open starts collapsed again — a new state, not the old one.
    expect(menuFoldState().size).toBe(0);
  });
});

describe("APPS = ONLY THE GLYPHH APPS THE DESKTOP CAN LOAD (his review, 2026-10-05)", () => {
  it("the filter keeps kind \"glyphh\" rows only: URL tabs, native apps and unkinded rows drop", () => {
    expect(GLYPHH_APP_KIND).toBe("glyphh");
    expect(glyphhAppsOnly(apps).map((r) => r.slug)).toEqual(["slides", "crm"]);
    expect(glyphhAppsOnly([{ slug: "x", name: "X", machineId: "m1", machineName: "" }])).toEqual([]);
    expect(glyphhAppsOnly([{ slug: "x", name: "X", kind: "glyphh-app", machineId: "m1", machineName: "" }])).toEqual([]);
  });
  it("the section carries the bundle's icon and the machine; its count is the kept rows'", () => {
    const m = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [MAC], apps, clis: CLIS, cliSessions: [] });
    const a = section(m, "apps")!;
    expect(a.enabled).toBe(true);
    expect(a.rows.map((r) => r.slug)).toEqual(["slides", "crm"]);
    expect(a.rows[0]!.icon).toMatch(/^data:image/);
    expect(a.rows[0]!.machineName).toBe(MAC.name);
    expect(a.count).toBe(2);
    expect(a.note).toBeNull();
  });
  it("an attached desktop with URL tabs but no Glyphh app says so, still enabled", () => {
    const mm = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [MAC], apps: apps.filter((r) => r.kind !== "glyphh"), clis: CLIS, cliSessions: [] });
    const a = section(mm, "apps")!;
    expect(a.enabled).toBe(true);
    expect(a.rows).toEqual([]);
    expect(a.count).toBe(0);
    expect(a.note).toBeNull();   // "Apps · 0" says it (his order, 2026-10-05)
    expect(a.link).toBeNull();
  });
  it("two desktops with the same app list it once; a row without a slug is dropped", () => {
    const mm = agentMenuModel({
      surface: "web", mode: "code", session: null,
      machines: [MAC, { id: "m2", name: "Other" }],
      apps: [...apps, { slug: "Slides", name: "Slides", kind: "glyphh", machineId: "m2", machineName: "Other" }, { slug: "", name: "ghost", kind: "glyphh", machineId: "m2", machineName: "Other" }],
      clis: CLIS, cliSessions: [],
    });
    expect(section(mm, "apps")!.rows.map((r) => r.slug)).toEqual(["slides", "crm"]);
    expect(mm.machine).toEqual(MAC);
  });
});

describe("web, attached — a desktop answers", () => {
  const m = agentMenuModel({ surface: "web", mode: "code", session: { pinned: false }, machines: [MAC], apps, clis: CLIS, cliSessions: [sess("a", "claude", 3), sess("b", "codex", 2), sess("c", "claude", 1)], locus: "local" });
  it("attached, on the first machine", () => {
    expect(m.attached).toBe(true);
    expect(m.machine).toEqual(MAC);
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
    const mm = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [MAC], apps: [], clis: CLIS, cliSessions: many, locus: "local" });
    expect(section(mm, "clis")!.rows[0]!.sessions.length).toBe(CLI_SESSIONS_PER_CLI);
    expect(section(mm, "clis")!.rows[0]!.sessions[0]!.id).toBe("x11");
  });
});

describe("web, not attached — no desktop (his order, 2026-10-05: installed apps show period; CLIs only on a desktop path)", () => {
  const cloudApp = { slug: "crm", name: "CRM", kind: "glyphh", machineId: "", machineName: "the cloud", cloud: true };
  const m = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [], apps, installed: [cloudApp], clis: CLIS, cliSessions: [sess("a", "claude", 3)], locus: "cloud" });
  it("Apps lists the cloud-installed apps, enabled, no Connect line, no link", () => {
    expect(m.attached).toBe(false);
    expect(m.machine).toBeNull();
    const a = section(m, "apps")!;
    expect(a.enabled).toBe(true);
    expect(a.rows.map((r) => r.slug)).toEqual(["crm"]);
    expect(a.rows[0]!.cloud).toBe(true);
    expect(a.count).toBe(1);
    expect(a.note).toBeNull();
    expect(a.link).toBeNull();
  });
  it("with nothing installed anywhere the section says so, still enabled", () => {
    const mm = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [], apps: [], installed: [], clis: CLIS, cliSessions: [], locus: "cloud" });
    const a = section(mm, "apps")!;
    expect(a.enabled).toBe(true);
    expect(a.rows).toEqual([]);
    expect(a.note).toBeNull();
  });
  it("no Agents / CLIs on a cloud locus, attached or not", () => {
    expect(section(m, "clis")).toBeUndefined();
    const attachedCloud = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [MAC], apps, clis: CLIS, cliSessions: [sess("a", "claude", 3)], locus: "cloud" });
    expect(section(attachedCloud, "clis")).toBeUndefined();
    const noLocus = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [MAC], apps, clis: CLIS, cliSessions: [] });
    expect(section(noLocus, "clis")).toBeUndefined();
  });
  it("a desktop path without a connected desktop shows no CLIs either", () => {
    const mm = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [], apps: [], installed: [], clis: CLIS, cliSessions: [], locus: "local" });
    expect(section(mm, "clis")).toBeUndefined();
  });
  it("the installed list and the desktop's rows merge one row per slug; a cloud row opens as a cloud panel, a desktop row on the desktop", () => {
    const mm = agentMenuModel({ surface: "web", mode: "code", session: null, machines: [MAC], apps, installed: [cloudApp, { slug: "slides", name: "Slides", kind: "glyphh", machineId: "", machineName: "the cloud", cloud: true }], clis: CLIS, cliSessions: [], locus: "local" });
    expect(section(mm, "apps")!.rows.map((r) => r.slug)).toEqual(["crm", "slides"]);
    expect(appRowOpen(cloudApp, "web")).toEqual({ open: "cloud-panel" });
    expect(appRowOpen({ kind: "glyphh", tool: null, cloud: false }, "web")).toEqual({ open: "desktop" });
    expect(appRowOpen(cloudApp, "desktop")).toEqual({ open: "desktop" });
    expect(menuLocusOf({ kind: "local" })).toBe("local");
    expect(menuLocusOf({ kind: "cloud-repo" })).toBe("cloud");
    expect(menuLocusOf(null)).toBe("cloud");
  });
});

describe("ONE menu, both surfaces — the session's type decides the panels (his report, 2026-10-05)", () => {
  it("Code on the desktop: the old Developer-tools list, Browser included", () => {
    expect([...toolViewsFor("desktop", "code")]).toEqual([...DESKTOP_CODE_TOOL_VIEWS]);
    expect(toolRowsFor("desktop", "code").map((t) => t.label)).toEqual(["Files", "Terminal", "Editor", "Browser", "Diff", "Plan", "Agents", "Artifacts"]);
  });
  it("Work never lists Files / Terminal / Editor / Diff — on either surface", () => {
    for (const surface of ["web", "desktop"] as const) {
      const views = toolViewsFor(surface, "work");
      for (const v of ["files", "terminal", "monaco", "diff"]) expect(views).not.toContain(v);
      expect(views).toContain("agents");
    }
    expect([...toolViewsFor("desktop", "work")]).toEqual(["preview", "agents", "artifacts"]);
    expect([...toolViewsFor("web", "work")]).toEqual(["agents", "artifacts"]);
  });
  it("⋮ Panels lists Artifacts on both surfaces and for both types, last (his order, 2026-10-05)", () => {
    for (const surface of ["web", "desktop"] as const) for (const mode of ["work", "code"] as const) {
      const views = toolViewsFor(surface, mode);
      expect(views[views.length - 1]).toBe("artifacts");
      expect(toolRowsFor(surface, mode).map((t) => t.label).pop()).toBe("Artifacts");
    }
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
              // An EMPTY Apps fold is allowed: "Apps · 0" says it, no line under it (his order, 2026-10-05).
              if (s.kind === "apps") expect(s.note).toBeNull();
              else expect(s.rows.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });
  it("a web menu with no CLI rows yet drops the section rather than heading nothing", () => {
    const m = agentMenuModel({ surface: "web", mode: "work", session: null, machines: [], apps: [], clis: [], cliSessions: [] });
    expect(kinds(m)).toEqual(["tools", "apps"]);
  });
});

describe("the toast", () => {
  it("names the machine", () => {
    expect(openedOnLine("Chris's MacBook")).toBe("Opened on Chris's MacBook");
    expect(openedOnLine("")).toBe("Opened on your desktop");
  });
});

describe("WHERE AN APPS ROW OPENS (his order, 2026-10-05: Apps → Design opens the web panel, pulled through the relay)", () => {
  const house = { slug: "design", name: "Design", kind: "glyphh", tool: "gdesign" };
  const bundle = { slug: "crm", name: "CRM", kind: "glyphh" };

  it("on the web a house row — a Glyphh app whose tool names a house panel — opens the web's OWN panel", () => {
    expect(appRowOpen(house, "web")).toEqual({ open: "web-panel", view: "gdesign" });
    for (const [tool, view] of [["gpoint", "gpoint"], ["gimage", "gimage"], ["gvideo", "gvideo"], ["gsound", "gsound"], ["gdrive", "gdrive"]]) {
      expect(appRowOpen({ kind: "glyphh", tool }, "web")).toEqual({ open: "web-panel", view });
    }
  });

  it("a Glyphh app without a house tool keeps today's open-on-desktop door", () => {
    expect(appRowOpen(bundle, "web")).toEqual({ open: "desktop" });
    expect(appRowOpen({ ...bundle, tool: null }, "web")).toEqual({ open: "desktop" });
    // A tool the web cannot host (the streamed Browser) is not a house panel either.
    expect(appRowOpen({ kind: "glyphh", tool: "preview" }, "web")).toEqual({ open: "desktop" });
  });

  it("only a Glyphh bundle counts — a URL tab or native app with a tool field is still the desktop's", () => {
    expect(appRowOpen({ kind: "web", tool: "gdesign" }, "web")).toEqual({ open: "desktop" });
    expect(appRowOpen({ kind: "native", tool: "gdesign" }, "web")).toEqual({ open: "desktop" });
  });

  it("the desktop never routes through this: its rows open on the desktop as before", () => {
    expect(appRowOpen(house, "desktop")).toEqual({ open: "desktop" });
  });

  it("the model carries the row's tool through to the painter", () => {
    const m = agentMenuModel({ surface: "web", mode: "work", session: null, machines: [MAC], apps: [{ ...house, machineId: "m1", machineName: MAC.name }, ...apps] });
    const rows = section(m, "apps")!.rows;
    expect(rows.find((r) => r.slug === "design")?.tool).toBe("gdesign");
    expect(rows.find((r) => r.slug === "crm")?.tool).toBeUndefined();
  });
});
