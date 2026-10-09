/**
 * agent-menu.test.ts — the agent window's ONE ⋮ menu, as data
 * (src/renderer/help/agent-menu.ts; his orders, 2026-10-05, and 2026-10-06:
 * ONE MENU ON BOTH SURFACES — one frozen list; no Apps section (his order,
 * 2026-10-09: "remove apps from this menu"); Agents / CLIs on both surfaces, a CLI
 * opening on the session's folder, the rows saying so when a desktop path has
 * no desktop; Workspaces = the one list; the Browser row only where a
 * streamed panel can be). Agents / CLIs and Workspaces are expandable
 * sections, COLLAPSED on every open. The Session section exists only for an
 * open session, and no section is ever empty.
 */
import { describe, it, expect } from "vitest";
import {
  agentMenuModel, toolViewsFor, toolRowsFor, sessionRowsFor, sectionHeadLabel,
  menuFoldState, toggleFold, isExpanded,
  TOOLS_SECTION_LABEL, SESSION_SECTION_LABEL,
  CODE_TOOL_VIEWS, MENU_SECTION_ORDER, COLLAPSIBLE_SECTIONS,
  WORKSPACES_SECTION_LABEL, workspaceRows,
  type MenuSection, menuLocusOf } from "../../src/renderer/help/agent-menu.js";
import { WEB_TOOL_VIEWS, DESKTOP_TOOL_VIEWS } from "../../src/renderer/help/surface.js";

const MAC = { id: "m1", name: "Chris's MacBook" };
const SPACES = [{ name: "Dev" }, { name: "Writing" }];
const section = <K extends MenuSection["kind"]>(m: { sections: MenuSection[] }, kind: K): Extract<MenuSection, { kind: K }> | undefined =>
  m.sections.find((s): s is Extract<MenuSection, { kind: K }> => s.kind === kind);
const kinds = (m: { sections: MenuSection[] }): string[] => m.sections.map((s) => s.kind);

describe("ONE MENU ON BOTH SURFACES (his order, 2026-10-06) — one frozen list", () => {
  it("the one list: Panels, Session, Workspaces — frozen; no Apps (his order, 2026-10-09)", () => {
    expect([...MENU_SECTION_ORDER]).toEqual(["tools", "session", "workspaces"]);
    expect(Object.isFrozen(MENU_SECTION_ORDER)).toBe(true);
  });
  it("a full menu on each surface paints in exactly that order, the same labels", () => {
    for (const surface of ["web", "desktop"] as const) {
      const m = agentMenuModel({ surface, session: { pinned: false }, machines: [MAC], locus: "local", workspaces: SPACES });
      expect(kinds(m)).toEqual([...MENU_SECTION_ORDER]);
      expect(m.sections.map((s) => s.label)).toEqual([TOOLS_SECTION_LABEL, SESSION_SECTION_LABEL, WORKSPACES_SECTION_LABEL]);
    }
  });
  it("the rows are identical on both surfaces but for the Browser — a streamed panel the browser does not reach", () => {
    const desk = agentMenuModel({ surface: "desktop", session: { pinned: false }, workspaces: SPACES });
    const web = agentMenuModel({ surface: "web", session: { pinned: false }, workspaces: SPACES });
    const labels = (m: { sections: MenuSection[] }): string[] => m.sections.flatMap((s) => s.rows.map((r) => ("label" in r ? r.label : "name" in r ? r.name : "")));
    expect(labels(desk)).toEqual(["Files", "Terminal", "Editor", "Browser", "Diff", "Plan", "Bots", "Artifacts", "Rename", "Pin", "New agent panel", "Delete", "Dev", "Writing"]);
    expect(labels(web)).toEqual(labels(desk).filter((l) => l !== "Browser"));
  });
});

describe("EXPANDABLE SECTIONS, COLLAPSED ON OPEN (his review, 2026-10-05)", () => {
  it("Workspaces is the collapsible one, with a count on the head", () => {
    expect([...COLLAPSIBLE_SECTIONS]).toEqual(["workspaces"]);
    const m = agentMenuModel({ surface: "web", session: null, machines: [MAC], locus: "local", workspaces: SPACES });
    const w = section(m, "workspaces")!;
    expect(w.collapsible).toBe(true);
    expect(w.count).toBe(2);
    expect(sectionHeadLabel(w.label, w.count)).toBe("Workspaces · 2");
    expect(section(m, "tools")).not.toHaveProperty("collapsible");
  });
  it("a fresh open expands nothing; a toggle opens one fold and a second closes it", () => {
    const folds = menuFoldState();
    expect(isExpanded(folds, "workspaces")).toBe(false);
    expect(toggleFold(folds, "workspaces")).toBe(true);
    expect(isExpanded(folds, "workspaces")).toBe(true);
    expect(toggleFold(folds, "workspaces")).toBe(false);
    expect(isExpanded(folds, "workspaces")).toBe(false);
  });
});

describe("THE LOCUS", () => {
  it("the locus reads off a session source", () => {
    expect(menuLocusOf({ kind: "local" })).toBe("local");
    expect(menuLocusOf({ kind: "cloud-repo" })).toBe("cloud");
    expect(menuLocusOf(null)).toBe("cloud");
  });
});

describe("the session's type decides the panels — one list through the caps", () => {
  it("Code: the one Developer-tools list, Browser included on the desktop, then Artifacts", () => {
    expect([...CODE_TOOL_VIEWS]).toEqual([...DESKTOP_TOOL_VIEWS, "artifacts"]);
    expect([...toolViewsFor("desktop")]).toEqual([...CODE_TOOL_VIEWS]);
    expect([...toolViewsFor("web")]).toEqual([...WEB_TOOL_VIEWS, "artifacts"]);
    expect(toolRowsFor("desktop").map((t) => t.label)).toEqual(["Files", "Terminal", "Editor", "Browser", "Diff", "Plan", "Bots", "Artifacts"]);
  });
  it("⋮ Panels lists Artifacts on both surfaces and for both types, last (his order, 2026-10-05)", () => {
    for (const surface of ["web", "desktop"] as const) for (const mode of ["work", "code"] as const) {
      const views = toolViewsFor(surface, mode);
      expect(views[views.length - 1]).toBe("artifacts");
      expect(toolRowsFor(surface, mode).map((t) => t.label).pop()).toBe("Artifacts");
    }
  });
  it("a fresh landing has no Session section; an open session has Rename / Pin / New agent panel / Delete", () => {
    expect(sessionRowsFor(null)).toEqual([]);
    expect(sessionRowsFor({ pinned: false }).map((r) => `${r.action}:${r.label}${r.danger ? "!" : ""}`))
      .toEqual(["rename:Rename", "pin:Pin", "new-panel:New agent panel", "delete:Delete!"]);
    expect(sessionRowsFor({ pinned: true })[1]!.label).toBe("Unpin");
    const fresh = agentMenuModel({ surface: "desktop", session: null });
    expect(kinds(fresh)).toEqual(["tools", "workspaces"]);
  });
  it("never an empty dropdown, never an empty section — every combination", () => {
    for (const surface of ["web", "desktop"] as const) {
      for (const mode of ["work", "code"] as const) {
        for (const session of [null, { pinned: false }]) {
          for (const machines of [[], [MAC]]) {
            for (const locus of ["local", "cloud", undefined] as const) {
              const m = agentMenuModel({ surface, mode, session, machines, locus });
              expect(m.sections.length).toBeGreaterThan(0);
              for (const s of m.sections) {
                // An empty Workspaces fold still holds "Create workspace…" (the menu's UI paints it; 2026-10-08).
                if (s.kind === "workspaces") expect(s.count).toBe(s.rows.length);
                else expect(s.rows.length).toBeGreaterThan(0);
              }
            }
          }
        }
      }
    }
  });
});

describe("WORKSPACES — the one list, the last fold on both surfaces", () => {
  it("lists the member's workspaces by name, collapsible with a count, LAST — on either surface, with or without a desktop, on either locus", () => {
    for (const surface of ["web", "desktop"] as const) for (const machines of [[MAC], []]) for (const locus of ["local", "cloud"] as const) {
      const m = agentMenuModel({ surface, session: null, machines, locus, workspaces: SPACES });
      const w = section(m, "workspaces")!;
      expect(w).toBeDefined();
      expect(w.collapsible).toBe(true);
      expect(w.count).toBe(2);
      expect(w.label).toBe(WORKSPACES_SECTION_LABEL);
      expect(w.rows).toEqual([{ name: "Dev" }, { name: "Writing" }]);
      expect(sectionHeadLabel(w.label, w.count)).toBe("Workspaces · 2");
      expect(kinds(m)[kinds(m).length - 1]).toBe("workspaces");
    }
  });
  it("no workspaces → the fold is still there, empty, for Create workspace… (his order, 2026-10-08)", () => {
    for (const workspaces of [[], undefined, [{ name: "" }, { name: "   " }]]) {
      const m = agentMenuModel({ surface: "web", session: null, machines: [MAC], workspaces });
      const s = section(m, "workspaces") as { count: number; rows: unknown[] } | undefined;
      expect(s?.count).toBe(0);
      expect(s?.rows).toEqual([]);
    }
  });
  it("the rows: trimmed names, one per name (case-insensitive), blanks dropped", () => {
    expect(workspaceRows([{ name: " Dev " }, { name: "dev" }, { name: "" }, { name: "Writing" }])).toEqual([{ name: "Dev" }, { name: "Writing" }]);
  });
  it("the fold starts collapsed like the others", () => {
    const folds = menuFoldState();
    expect(isExpanded(folds, "workspaces")).toBe(false);
    expect(toggleFold(folds, "workspaces")).toBe(true);
  });
});
