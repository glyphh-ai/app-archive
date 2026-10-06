/**
 * web-cut.test.ts — the web is the Glyphh agent and nothing for building
 * (src/renderer/help/web-cut.ts + web-surface.ts's DESKTOP_ONLY_SUBS; his
 * order, 2026-10-05): the boot surfaces, the dock doors, the tool views, and
 * the settings pages that leave the web.
 */
import { describe, it, expect } from "vitest";
import {
  webBootSurfaces, bootsSurface, DESKTOP_BOOT_SURFACES,
  WEB_BUILD_SUBS, WEB_CUSTOMIZE_SUBS, WEB_KEPT_SUBS, WEB_HIDDEN_NAV_GROUPS, WEB_HIDDEN_RAIL, WEB_HIDDEN_SETTINGS_ROWS, WEB_RAIL_LINKS,
  webDockDoorAllowed, WEB_TOOL_VIEWS, webToolAllowed, webToolReachable, WEB_UNREACHABLE_VIEWS, webWallKeeps, WEB_HOUSE_VIEWS, WEB_DOCK_NAV,
  agentCardMovable, webNewSessionInPlace,
  webRestorableCard, webCardSkipReason, webRestorePlan, webWallMemory,
  webFullScreenPanels, webPanelOpensFullScreen, webFullScreenTitle, WEB_FULL_SCREEN_TITLES, WEB_GROUP_ROWS, WEB_CUT_ROW_CLASS, webGroupPanelKept, webNewClosesEverything, defaultTypeTab,
  WEB_RAIL_WORDMARK, WEB_RAIL_ECHO_BUTTONS, webRailWordmark, webEchoSurface, webEchoOpens, webCloseAllOpensNew,
  webLayoutCells, webWorkspaceOpenLines, workspaceOpenClosesHosts, LAYOUT_AGENT_CELL, type WebLayoutApp, RAIL_HEADER_ORDER, webRailHeaderOrder } from "../../src/renderer/help/web-cut.js";
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
  it("a new agent session, Settings, the command center and Close all act; New tab and a CLI never", () => {
    for (const k of ["glyphh", "settings", "cc", "closeall"]) expect(webDockDoorAllowed(k)).toBe(true);
    for (const k of ["newtab", "agent:claude", ""]) expect(webDockDoorAllowed(k)).toBe(false);
  });
  it("the web's wall keeps the cloud's half of two worlds (his order, 2026-10-05: 'the mirror of the app … a different filter')", () => {
    expect(webWallKeeps({ kind: "layout" })).toBe(true);
    expect(webWallKeeps({ kind: "app", cloud: true, archetype: "glyphh-app" })).toBe(true);
    expect(webWallKeeps({ kind: "app", archetype: "glyphh-app" })).toBe(false);        // a desktop-only Glyphh app
    expect(webWallKeeps({ kind: "app", archetype: "web" })).toBe(false);               // a URL tab
    expect(webWallKeeps({ kind: "app", archetype: "native" })).toBe(false);            // a native app
    expect(webWallKeeps({ kind: "app", archetype: "glyphh-nav" })).toBe(false);        // a section: the rail's
    expect(webWallKeeps({ kind: "agent" })).toBe(false);                               // a CLI
    expect(webWallKeeps({ kind: "tool", cliAgent: { id: "claude" } })).toBe(false);    // a CLI agent's wall/dock tile
    for (const v of [...WEB_TOOL_VIEWS, ...WEB_HOUSE_VIEWS]) expect(webWallKeeps({ kind: "tool", toolView: v })).toBe(true);
    expect(webWallKeeps({ kind: "tool", toolView: "preview" })).toBe(false);
    for (const k of WEB_DOCK_NAV) expect(webWallKeeps({ kind: "tool", navKey: k })).toBe(true);
    expect(webWallKeeps({ kind: "tool", navKey: "newtab" })).toBe(false);
    expect(webWallKeeps({ kind: "folder" })).toBe(true);
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
    for (const sub of ["general", "appearance", "memory", "privacy", "devices", "artifacts", "usage", "billing", "support", "connections-cfg"]) {
      expect(WEB_KEPT_SUBS).toContain(sub);
    }
  });
  it("the MCP Server page is the desktop's (his order, 2026-10-05)", () => {
    expect(WEB_KEPT_SUBS).not.toContain("mcp");
    expect(DESKTOP_ONLY_SUBS.has("mcp")).toBe(true);
  });
  it("the web rail's menu is ONLY Artifacts, Build, Customize (his order, 2026-10-05: Connections and Devices left the rail; they stay in Settings)", () => {
    expect(WEB_RAIL_LINKS.map((l) => l.label)).toEqual(["Artifacts", "Build", "Customize"]);
    expect(WEB_RAIL_LINKS.map((l) => l.sub)).toEqual(["artifacts", "build", "customize"]);
    for (const sub of ["connections-cfg", "devices"]) {
      expect(WEB_RAIL_LINKS.map((l) => l.sub)).not.toContain(sub);
      expect(WEB_KEPT_SUBS).toContain(sub);   // still a Settings page
    }
  });
  it("both group headers hide in Settings, with the rail's More and the dock / streamed rows — but NOT the rail's Build / Customize, NOT the Echo buttons and NOT the wordmark (his order, 2026-10-05: the logo holds the traffic lights' spot, the icons stay fixed beside it)", () => {
    expect([...WEB_HIDDEN_NAV_GROUPS]).toEqual(["nav-group-build", "nav-group-customize"]);
    expect([...WEB_HIDDEN_RAIL]).toEqual(["#rail-more-toggle"]);
    expect(WEB_HIDDEN_RAIL).not.toContain(WEB_RAIL_WORDMARK);
    expect(webRailWordmark(true)).toBe(true);
    expect(webRailWordmark(false)).toBe(false);
    expect([...RAIL_HEADER_ORDER]).toEqual(["chrome", "collapse", "echo"]);
    expect([...webRailHeaderOrder(true)]).toEqual([...webRailHeaderOrder(false)]);
    for (const b of WEB_RAIL_ECHO_BUTTONS) expect(WEB_HIDDEN_RAIL).not.toContain(b);
    expect(WEB_HIDDEN_RAIL).not.toContain('.app-rail-nav-item[data-settings-sub="build"]');
    expect(WEB_HIDDEN_RAIL).not.toContain('.app-rail-nav-item[data-settings-sub="customize"]');
    expect([...WEB_HIDDEN_SETTINGS_ROWS]).toEqual(["#streamed-panels-row"]);   // the dock's Appearance rows are back on the web (2026-10-05)
  });
});

describe("THE WEB'S FULL-SCREEN PANELS (his order, 2026-10-05: Artifacts / Build / Customize open full, replacing everything; X restores)", () => {
  it("exactly the rail's three open full screen on the web", () => {
    expect([...webFullScreenPanels]).toEqual(["artifacts", "build", "customize"]);
    expect(webFullScreenPanels.map((k) => k)).toEqual(WEB_RAIL_LINKS.map((l) => l.sub));
    for (const k of webFullScreenPanels) expect(webPanelOpensFullScreen(k)).toBe(true);
  });
  it("no other panel takes that path — Files, Agents, Settings, an app", () => {
    for (const k of ["files", "agents", "terminal", "settings", "gmail", "", "preview"]) expect(webPanelOpensFullScreen(k)).toBe(false);
  });
  it("the header reads '‹ Artifacts' / '‹ Build' / '‹ Customize'", () => {
    expect(webFullScreenTitle("artifacts")).toBe("Artifacts");
    expect(webFullScreenTitle("build")).toBe("Build");
    expect(webFullScreenTitle("customize")).toBe("Customize");
    expect(Object.keys(WEB_FULL_SCREEN_TITLES).sort()).toEqual([...webFullScreenPanels].sort());
    expect(webFullScreenTitle("wat")).toBe("wat");
  });
  it("the full-screen Build / Customize pages own the desktop's group rows — Connections included — and never hide them (the tabs are read from the same rows on both hosts)", () => {
    expect([...WEB_GROUP_ROWS]).toEqual([...WEB_BUILD_SUBS, "connections-cfg", ...WEB_CUSTOMIZE_SUBS]);
    for (const sub of WEB_GROUP_ROWS) expect(webGroupPanelKept(sub)).toBe(true);
    for (const sub of ["remote", "mcp", "general", "artifacts"]) expect(webGroupPanelKept(sub)).toBe(false);
    expect(WEB_CUT_ROW_CLASS).toBe("web-cut-row");
    expect(WEB_CUT_ROW_CLASS).not.toBe("hidden");
  });
  it("+ New on the web closes everything first; the desktop keeps its panels (his order, 2026-10-05)", () => {
    expect(webNewClosesEverything(true)).toBe(true);
    expect(webNewClosesEverything(false)).toBe(false);
  });
  it("a net-new user on the web starts on Work; a saved tab wins; the desktop starts on Code (his order, 2026-10-05)", () => {
    expect(defaultTypeTab(true, "")).toBe("work");
    expect(defaultTypeTab(true, undefined)).toBe("work");
    expect(defaultTypeTab(true, "code")).toBe("code");
    expect(defaultTypeTab(false, "")).toBe("code");
    expect(defaultTypeTab(false, "work")).toBe("work");
    expect(defaultTypeTab(true, "wat")).toBe("work");
  });
  it("the lists are frozen", () => {
    expect(Object.isFrozen(webFullScreenPanels)).toBe(true);
    expect(Object.isFrozen(WEB_RAIL_LINKS)).toBe(true);
  });
});

describe("the panels move on the web — the agent too (his review, 2026-10-05)", () => {
  it("on the web the agent card is a movable flow panel (drag source and swap target)", () => {
    expect(agentCardMovable(true)).toBe(true);
  });
  it("the desktop keeps its own rule — the agent is never reflowed by a drag there", () => {
    expect(agentCardMovable(false)).toBe(false);
  });
});

describe("+ New on the web (his report, 2026-10-05: the rail's + New did nothing)", () => {
  it("with the web's one agent seated, + New starts the new session IN it", () => {
    expect(webNewSessionInPlace(true, true)).toBe(true);
  });
  it("with no agent seated the web opens the agent as before; the desktop never takes this path", () => {
    expect(webNewSessionInPlace(true, false)).toBe(false);
    expect(webNewSessionInPlace(false, true)).toBe(false);
    expect(webNewSessionInPlace(false, false)).toBe(false);
  });
});

describe("the web remembers its panels (his order, 2026-10-05: open work panels come back after a refresh and a login)", () => {
  const files = { kind: "tool", toolView: "files" };
  const diff = { kind: "tool", toolView: "diff", solo: true };
  const browser = { kind: "tool", toolView: "preview" };
  const app = { kind: "app", slug: "gmail", name: "Gmail", url: "https://mail.google.com" };
  const section = { kind: "section", section: "apps" };
  const cli = { kind: "agent", agent: "claude", name: "Claude Code" };

  it("hosts exactly the ⋮ menu's tool panels — never the streamed Browser, an app, a section or a CLI agent", () => {
    for (const v of WEB_TOOL_VIEWS) expect(webRestorableCard({ kind: "tool", toolView: v })).toBe(true);
    for (const c of [browser, app, section, cli, null, undefined, { kind: "tool" }]) expect(webRestorableCard(c as never)).toBe(false);
  });
  it("names what it skips", () => {
    expect(webCardSkipReason(browser)).toContain("preview");
    expect(webCardSkipReason(app)).toContain("Gmail");
    expect(webCardSkipReason(section)).toContain("apps");
    expect(webCardSkipReason(cli)).toContain("Claude Code");
    expect(webCardSkipReason(null)).toContain("malformed");
    expect(webCardSkipReason({ kind: "wat" })).toContain("wat");
  });
  it("the plan: the restorable cards in their saved order, the rest named, the agent's seat kept", () => {
    const plan = webRestorePlan({ layout: null, cards: [files, app, diff, browser], agentAt: 1 });
    expect(plan.open).toEqual([files, diff]);
    expect(plan.open[1].solo).toBe(true);   // the edge-drop rides with the card
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped[0]).toContain("Gmail");
    expect(plan.skipped[1]).toContain("preview");
    expect(plan.agentAt).toBe(1);
  });
  it("the agent's seat clamps to the panels that open; absent → first", () => {
    expect(webRestorePlan({ layout: null, cards: [files, diff], agentAt: 9 }).agentAt).toBe(2);
    expect(webRestorePlan({ layout: null, cards: [files, diff], agentAt: -3 }).agentAt).toBe(0);
    expect(webRestorePlan({ layout: null, cards: [files, diff] }).agentAt).toBe(0);
    expect(webRestorePlan({ layout: null, cards: [files, diff], agentAt: Number.NaN }).agentAt).toBe(0);
  });
  it("a saved layout opens nothing on the web and is named; nothing saved → nothing", () => {
    const plan = webRestorePlan({ layout: "dev", cards: [] });
    expect(plan.open).toEqual([]);
    expect(plan.skipped).toEqual([expect.stringContaining("dev")]);
    for (const s of [null, undefined, {}, { layout: null, cards: null }, "junk"]) {
      expect(webRestorePlan(s as never)).toEqual({ open: [], skipped: [], agentAt: 0 });
    }
  });
  it("the web keeps the wall's memory its way (agent seat + saves on a move); the desktop is untouched", () => {
    expect(webWallMemory(true)).toBe(true);
    expect(webWallMemory(false)).toBe(false);
  });
});

describe("THE ECHO ICON AT THE RAIL'S TOP-LEFT ON THE WEB (his order, 2026-10-05)", () => {
  it("the wordmark leaves (hidden by selector), the desktop's two Echo buttons stay, and Echo leads the strip on the web only", () => {
    expect(WEB_RAIL_WORDMARK).toBe(".app-rail-logo");
    expect([...WEB_RAIL_ECHO_BUTTONS]).toEqual(["#rail-echo-btn", "#rail-echo-btn-strip"]);
    expect(WEB_HIDDEN_RAIL).not.toContain(WEB_RAIL_WORDMARK);
    expect(webRailWordmark(true)).toBe(true);
    expect(webRailWordmark(false)).toBe(false);
  });
  it("the web's Echo is the desktop's Echo with the cloud filter: search, dock and the cloud's tiles — lifted on the web, never the desktop's rule", () => {
    expect(webEchoSurface()).toEqual({ search: true, dock: true, tiles: "cloud" });
    expect(Object.isFrozen(webEchoSurface())).toBe(true);
    expect(webEchoOpens(true)).toBe(true);
    expect(webEchoOpens(false)).toBe(false);
    // The wall and the dock still never BOOT on the web — this is an overlay, not a boot surface.
    expect(bootsSurface(true, "wall")).toBe(false);
    expect(bootsSurface(true, "dock")).toBe(false);
    expect(bootsSurface(true, "echo")).toBe(false);
  });
});

describe("CLOSE ALL PANELS ON THE WEB OPENS A NEW SESSION (his order, 2026-10-05)", () => {
  it("the web closes everything and starts fresh in the rail's current type; the desktop only closes", () => {
    expect(webCloseAllOpensNew(true)).toBe(true);
    expect(webCloseAllOpensNew(false)).toBe(false);
  });
});

describe("WORKSPACES ON THE WEB render only what is web native (his order, 2026-10-05)", () => {
  const apps: WebLayoutApp[] = [
    { slug: "crm", id: "crm", name: "CRM", kind: "glyphh", cloud: true },
    { slug: "slides", id: "slides", name: "Slides", kind: "glyphh", cloud: false },
    { slug: "gmail", id: "gmail", name: "Gmail", kind: "web", cloud: false },
    { slug: "notes", id: "notes", name: "Notes", kind: "native", cloud: false },
  ];
  const cell = (panelId: string) => ({ panelId });
  it("keeps the ⋮ menu's in-document tool panels, drops the Browser and Artifacts (a full-screen page), each named", () => {
    const plan = webLayoutCells([cell("tool:files"), cell("tool:terminal"), cell("tool:preview"), cell("tool:artifacts"), cell("tool:")], apps);
    expect(plan.keep).toEqual([{ kind: "tool", view: "files" }, { kind: "tool", view: "terminal" }]);
    expect(plan.skipped).toEqual([
      "the preview panel (not hosted on the web)",
      "the artifacts panel (not hosted on the web)",
      "the unnamed panel (not hosted on the web)",
    ]);
    for (const v of WEB_TOOL_VIEWS) expect(webLayoutCells([cell(`tool:${v}`)], []).keep).toEqual([{ kind: "tool", view: v }]);
  });
  it("keeps a CLOUD Glyphh app (by slug or id, any case); a desktop-installed bundle, a URL tab, a native app and an unknown id drop, each named", () => {
    const plan = webLayoutCells([cell("CRM"), cell("slides"), cell("gmail"), cell("notes"), cell("ghost")], apps);
    expect(plan.keep).toEqual([{ kind: "app", slug: "crm", name: "CRM" }]);
    expect(plan.skipped).toEqual([
      'the app "Slides" (installed on the desktop)',
      'the tab "Gmail" (opens on the desktop)',
      'the app "Notes" (desktop only)',
      'the app "ghost" (not in your library)',
    ]);
  });
  it("the agent's own cell is kept (the web's agent is seated already); a CLI agent's cell is desktop only", () => {
    expect(LAYOUT_AGENT_CELL).toBe("tool:coding");
    const plan = webLayoutCells([cell("tool:coding"), cell("agent:claude")], apps);
    expect(plan.keep).toEqual([{ kind: "agent" }]);
    expect(plan.skipped).toEqual(['the CLI agent "claude" (desktop only)']);
  });
  it("empty and malformed cells are named, never thrown on", () => {
    expect(webLayoutCells([cell(""), cell("   "), { panelId: undefined as never }], apps).skipped).toEqual(["an empty cell", "an empty cell", "an empty cell"]);
    expect(webLayoutCells([], [])).toEqual({ keep: [], skipped: [] });
  });
  it("the toasts: nothing kept → one error line; something skipped → one line listing it; all kept → quiet", () => {
    expect(webWorkspaceOpenLines("Dev", { keep: [], skipped: ["the tab \"Gmail\" (opens on the desktop)"] }))
      .toEqual({ error: 'Nothing in "Dev" runs on the web', info: null });
    expect(webWorkspaceOpenLines("Dev", { keep: [{ kind: "tool", view: "files" }], skipped: ["a", "b"] }))
      .toEqual({ error: null, info: "Skipped on the web: a, b" });
    expect(webWorkspaceOpenLines("Dev", { keep: [{ kind: "tool", view: "files" }], skipped: [] })).toEqual({ error: null, info: null });
  });
});

describe("OPEN WORKSPACE CLOSES ITS HOST FIRST (his order, 2026-10-05: 'close the customize or settings menu and open the workspace')", () => {
  it("the web closes the full-screen Customize panel; the desktop the Settings modal and the Customize work panel", () => {
    expect([...workspaceOpenClosesHosts(true)]).toEqual(["web-full-panel"]);
    expect([...workspaceOpenClosesHosts(false)]).toEqual(["settings-modal", "customize-panel"]);
    expect(Object.isFrozen(workspaceOpenClosesHosts(true))).toBe(true);
  });
});
