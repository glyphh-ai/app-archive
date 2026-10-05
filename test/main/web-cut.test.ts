/**
 * web-cut.test.ts — the web is the Glyphh agent and nothing for building
 * (src/renderer/help/web-cut.ts + web-surface.ts's DESKTOP_ONLY_SUBS; his
 * order, 2026-10-05): the boot surfaces, the dock doors, the tool views, and
 * the settings pages that leave the web.
 */
import { describe, it, expect } from "vitest";
import {
  webBootSurfaces, bootsSurface, DESKTOP_BOOT_SURFACES,
  WEB_BUILD_SUBS, WEB_CUSTOMIZE_SUBS, WEB_KEPT_SUBS, WEB_HIDDEN_NAV_GROUPS, WEB_HIDDEN_RAIL, WEB_HIDDEN_SETTINGS_ROWS,
  webDockDoorAllowed, WEB_TOOL_VIEWS, webToolAllowed, webToolReachable, WEB_UNREACHABLE_VIEWS,
} from "../../src/renderer/help/web-cut.js";
import { DESKTOP_ONLY_SUBS } from "../../src/renderer/help/web-surface.js";

describe("webBootSurfaces — what the home shell boots into", () => {
  it("on the web, ONLY the agent: no wall, no dock, no Echo", () => {
    expect([...webBootSurfaces(true)]).toEqual(["agent"]);
    expect(bootsSurface(true, "agent")).toBe(true);
    for (const s of ["wall", "dock", "echo"] as const) expect(bootsSurface(true, s)).toBe(false);
  });
  it("on the desktop, the whole command center — unchanged", () => {
    expect(webBootSurfaces(false)).toBe(DESKTOP_BOOT_SURFACES);
    expect([...webBootSurfaces(false)].sort()).toEqual(["agent", "dock", "echo", "wall"]);
  });
  it("the web's list is frozen — nobody can push a surface back in", () => {
    expect(Object.isFrozen(webBootSurfaces(true))).toBe(true);
    expect(Object.isFrozen(DESKTOP_BOOT_SURFACES)).toBe(true);
  });
});

describe("the dock's doors on the web", () => {
  it("only a new agent session and Settings act; cc / close all / new tab never", () => {
    expect(webDockDoorAllowed("glyphh")).toBe(true);
    expect(webDockDoorAllowed("settings")).toBe(true);
    for (const k of ["cc", "closeall", "newtab", "agent:claude", ""]) expect(webDockDoorAllowed(k)).toBe(false);
  });
});

describe("the tool views on the web", () => {
  it("the menu offers the in-document panels, never the Browser", () => {
    expect([...WEB_TOOL_VIEWS]).toEqual(["files", "terminal", "monaco", "diff", "plan", "agents"]);
    expect(webToolAllowed("preview")).toBe(false);
    expect(webToolAllowed("files")).toBe(true);
  });
  it("the workbench door refuses the streamed Browser from every caller", () => {
    expect([...WEB_UNREACHABLE_VIEWS]).toEqual(["preview"]);
    expect(webToolReachable("preview")).toBe(false);
    for (const v of WEB_TOOL_VIEWS) expect(webToolReachable(v)).toBe(true);
  });
});

describe("settings on the web — everything for building leaves", () => {
  it("the Build group: Skills, Agents, Apps, Tasks, plugins (Connections stays)", () => {
    expect([...WEB_BUILD_SUBS]).toEqual(["skills", "agents", "apps", "tasks", "plugins"]);
    expect(WEB_BUILD_SUBS).not.toContain("connections-cfg");
  });
  it("the Customize group, whole: Tabs, Workspaces, Drips, Schedules", () => {
    expect([...WEB_CUSTOMIZE_SUBS]).toEqual(["tabs", "layouts", "drips", "schedules"]);
  });
  it("DESKTOP_ONLY_SUBS carries both groups plus the desktop's own pages", () => {
    for (const sub of [...WEB_BUILD_SUBS, ...WEB_CUSTOMIZE_SUBS, "plugins", "remote"]) expect(DESKTOP_ONLY_SUBS.has(sub)).toBe(true);
  });
  it("what stays is never also hidden", () => {
    for (const sub of WEB_KEPT_SUBS) expect(DESKTOP_ONLY_SUBS.has(sub)).toBe(false);
    for (const sub of ["general", "appearance", "memory", "privacy", "devices", "artifacts", "usage", "mcp", "billing", "support", "connections-cfg"]) {
      expect(WEB_KEPT_SUBS).toContain(sub);
    }
  });
  it("both group headers hide, with the rail's doors and the dock / streamed rows", () => {
    expect([...WEB_HIDDEN_NAV_GROUPS]).toEqual(["nav-group-build", "nav-group-customize"]);
    expect(WEB_HIDDEN_RAIL).toContain("#rail-echo-btn");
    expect(WEB_HIDDEN_RAIL).toContain("#rail-echo-btn-strip");
    expect(WEB_HIDDEN_RAIL).toContain('.app-rail-nav-item[data-settings-sub="build"]');
    expect(WEB_HIDDEN_RAIL).toContain('.app-rail-nav-item[data-settings-sub="customize"]');
    expect([...WEB_HIDDEN_SETTINGS_ROWS]).toEqual(["#show-dock-row", "#streamed-panels-row"]);
  });
});
