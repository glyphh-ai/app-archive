/**
 * web-cut.ts — THE WEB IS THE GLYPHH AGENT, NOTHING FOR BUILDING (his order,
 * 2026-10-05: "cut down the web to remove everything for building to help me
 * see it better. Remove Echo and just have the Glyphh agent window be what's
 * loaded").
 *
 * The desktop is where building and installing happens; app.glyphh.ai is for
 * reaching that desktop and, without one, running a chat with your
 * connections. So on the web the command center never boots — no wall, no
 * dock, no dock tiles, no Echo — and the agent panel is the page, with the
 * left rail (sessions, search, filter, the user chip) beside it. Settings
 * drops the Build and Customize groups. Every rule here is PURE data so the
 * workbench, the settings nav and the tests read the same answer; nothing
 * here touches the desktop build (the callers gate on `onWeb()`).
 *
 * Unit-tested in test/main/web-cut.test.ts.
 */

/** What the home shell can boot into. */
export type BootSurface = "agent" | "wall" | "dock" | "echo";

/** The desktop boots the whole command center. */
export const DESKTOP_BOOT_SURFACES: ReadonlyArray<BootSurface> = Object.freeze(["wall", "dock", "echo", "agent"]);

/** THE ONE RULE: on the web the only surface is the agent. A caller that
 *  asks for a surface this list lacks must not paint it. */
export function webBootSurfaces(web: boolean): ReadonlyArray<BootSurface> {
  return web ? Object.freeze(["agent"] as BootSurface[]) : DESKTOP_BOOT_SURFACES;
}

/** Does this surface boot here? */
export function bootsSurface(web: boolean, surface: BootSurface): boolean {
  return webBootSurfaces(web).includes(surface);
}

/** The settings pages of the BUILD group that leave the web: Skills, Agents,
 *  Apps, Tasks and the Claude Code plugins. Connections stays — the web's
 *  chat runs with your connections. */
export const WEB_BUILD_SUBS: ReadonlyArray<string> = Object.freeze(["skills", "agents", "apps", "tasks", "plugins"]);

/** The CUSTOMIZE group, whole: Tabs, Workspaces, Drips, Schedules. */
export const WEB_CUSTOMIZE_SUBS: ReadonlyArray<string> = Object.freeze(["tabs", "layouts", "drips", "schedules"]);

/** The settings nav group headers that have nothing left under them on web. */
export const WEB_HIDDEN_NAV_GROUPS: ReadonlyArray<string> = Object.freeze(["nav-group-build", "nav-group-customize"]);

/** The pages that KEEP showing on the web (the test pins this list against
 *  the hidden ones so a page can never be on both sides). */
export const WEB_KEPT_SUBS: ReadonlyArray<string> = Object.freeze([
  "general", "appearance", "memory", "privacy", "devices", "account", "artifacts", "usage", "connections-cfg",
  "billing", "support", "about",
]);

/** The MCP Server page is the DESKTOP's local MCP door — it has nothing to
 *  show on the web (his order, 2026-10-05: "mcp server shouldn't be on the web"). */
export const WEB_DESKTOP_ONLY_EXTRA: ReadonlyArray<string> = Object.freeze(["mcp"]);

/** THE RAIL'S MENU ON THE WEB (his order, 2026-10-05: "In web the build,
 *  customize webpanels should be what is shown in the left rail", then
 *  "remove connections and devices from the left rail on web"): Artifacts,
 *  Build, Customize — each opens FULL SCREEN (webPanelOpensFullScreen).
 *  Connections and Devices stay reachable inside Settings. The desktop's
 *  rail keeps the same three, opening as ordinary work panels. */
export const WEB_RAIL_LINKS: ReadonlyArray<{ sub: string; label: string }> = Object.freeze([
  { sub: "artifacts", label: "Artifacts" },
  { sub: "build", label: "Build" },
  { sub: "customize", label: "Customize" },
]);

/** THE WEB'S FULL-SCREEN PANELS (his order, 2026-10-05: "artifacts -> new
 *  web panel -> open an artifact it opens full screen in place of anything
 *  else showing… The build and customize left rail items go to the same
 *  thing. Those panels open full replacing anything showing in the web. The
 *  close or x on the top right just closes and the agent and any other work
 *  panels open."). Opening one hides the agent card and every open work
 *  panel (kept mounted, state preserved) and paints the panel edge to edge
 *  under a header where the agent header is — "‹ <title>" on the left (back
 *  = close), an X on the right. Closing restores exactly what was showing.
 *  The desktop never takes this path: there they are ordinary work panels. */
export const webFullScreenPanels: ReadonlyArray<string> = Object.freeze(["artifacts", "build", "customize"]);
export function webPanelOpensFullScreen(key: string): boolean {
  return webFullScreenPanels.includes(key);
}
/** The header's title per full-screen panel ("‹ Artifacts"). */
export const WEB_FULL_SCREEN_TITLES: Readonly<Record<string, string>> = Object.freeze({ artifacts: "Artifacts", build: "Build", customize: "Customize" });
export function webFullScreenTitle(key: string): string {
  return WEB_FULL_SCREEN_TITLES[key] ?? key;
}

/** THE BUILD AND CUSTOMIZE PAGES ON THE WEB ARE THE DESKTOP'S (his order,
 *  2026-10-05: "why is the web build tab different than the desktop one?").
 *  A group page lists its tabs ONE way on both hosts: the group's nav rows
 *  that are not `.hidden` (navigation.ts groupTabs) — Skills, Agents,
 *  Connections, Plugins for Build; Tabs, Workspaces, Drips, Schedules for
 *  Customize. The web cut therefore never marks those rows `.hidden`: it
 *  marks them WEB_CUT_ROW_CLASS (CSS-hidden in the Settings nav only), and
 *  their panels stay mounted for the full-screen page to adopt. */
export const WEB_CUT_ROW_CLASS = "web-cut-row";
/** The settings rows the full-screen group pages own on the web. */
export const WEB_GROUP_ROWS: ReadonlyArray<string> = Object.freeze([...WEB_BUILD_SUBS, "connections-cfg", ...WEB_CUSTOMIZE_SUBS]);
/** Is this settings row a group page's on the web — its panel stays MOUNTED
 *  (not CSS-hidden) and its nav row wears WEB_CUT_ROW_CLASS, never `.hidden`? */
export function webGroupPanelKept(sub: string): boolean {
  return WEB_GROUP_ROWS.includes(sub);
}

/** A NET-NEW USER ON THE WEB STARTS ON WORK → NEW (his order, 2026-10-05).
 *  The rail's type tab is a saved preference; with none saved the web lands
 *  on Work (the desktop keeps Code, its builder's default). A saved pick
 *  always wins on both hosts. */
export function defaultTypeTab(web: boolean, saved: unknown): "work" | "code" {
  if (saved === "work" || saved === "code") return saved;
  return web ? "work" : "code";
}

/** + NEW ON THE WEB CLOSES EVERYTHING (his order, 2026-10-05: "no matter
 *  what page is up clicking new in the left rail closes whatever is open and
 *  shows the new session page"): the full-screen page, every open work
 *  panel and app card go, and the fresh session is what shows. The desktop
 *  keeps its panels (New there is another panel on a new session). */
export function webNewClosesEverything(web: boolean): boolean {
  return web;
}

/** The rail's doors into the command center — hidden on web (ids and
 *  selectors, applied by web-surface.ts). Build and Customize left this list
 *  on 2026-10-05: they are the rail's full-screen pages now. */
export const WEB_HIDDEN_RAIL: ReadonlyArray<string> = Object.freeze([
  "#rail-echo-btn", "#rail-echo-btn-strip", "#rail-more-toggle",
]);

/** Settings rows that govern surfaces the web no longer has: the dock
 *  (Appearance → Dock) and the streamed web panels (General). */
export const WEB_HIDDEN_SETTINGS_ROWS: ReadonlyArray<string> = Object.freeze([
  "#show-dock-row", "#streamed-panels-row",
]);

/** The dock's nav keys that still mean something on the web: a new agent
 *  session and Settings. The command center, Close all and New tab are the
 *  wall's own and never act here. */
export function webDockDoorAllowed(key: string): boolean {
  return key === "glyphh" || key === "settings";
}

/** The workbench tool views the agent's ⋮ menu offers on the web: the
 *  in-document panels that read the session's own locus (the attached
 *  desktop over the relay, or a cloud session's pod). The Browser is a
 *  streamed panel — a code path the web no longer reaches. */
export const WEB_TOOL_VIEWS: ReadonlyArray<string> = Object.freeze(["files", "terminal", "monaco", "diff", "plan", "agents"]);

/** Is this tool view reachable from the web's agent menu? */
export function webToolAllowed(view: string): boolean {
  return WEB_TOOL_VIEWS.includes(view);
}

/** The views the web's workbench door (__wbOpenTool) refuses outright: the
 *  Browser is a page streamed from a worker — a code path the web no longer
 *  reaches, whatever asks (the rail's More, a saved wall, an agent tool). */
export const WEB_UNREACHABLE_VIEWS: ReadonlyArray<string> = Object.freeze(["preview"]);
export function webToolReachable(view: string): boolean {
  return !WEB_UNREACHABLE_VIEWS.includes(view);
}

/** THE PANELS MOVE ON THE WEB — THE AGENT TOO (his review of the web cut,
 *  2026-10-05: "the panels are not movable", then "the glyphh agent panel
 *  should be draggable too… like it was before, not fixed in place"). The
 *  web seats the agent as a card and nothing else is on the page, so with
 *  its head hidden there was nothing to grab, and the flow's drag refused
 *  the agent as a source and as a swap target. On the web the agent card is
 *  a movable flow panel like any other: its head is the drag handle, it
 *  reorders among the panels and drives to a side, and the seams resize it.
 *  It still owns its column — nothing stacks under it. The desktop keeps its
 *  own rule (the agent never reflowed by a drag), untouched. */
export function agentCardMovable(web: boolean): boolean {
  return web;
}

/** + NEW ON THE WEB (his report, 2026-10-05: the rail's + New did nothing).
 *  The web's one agent is in-document and never instanced, so the desktop's
 *  "another panel, told to start clean" has no panel to mint: `activateGlyphh`
 *  found the seated card and only repainted it. With the agent seated the
 *  web starts the new session IN that card (help/code.ts newSessionInPlace,
 *  bound as __glyphhNewSession); with none seated it opens the agent as
 *  before. The desktop is untouched (always false). */
export function webNewSessionInPlace(web: boolean, agentSeated: boolean): boolean {
  return web && agentSeated;
}

/** THE WEB REMEMBERS ITS PANELS (his order, 2026-10-05: "on the web when the
 *  user opens work panels and apps the ui should remember that state, even
 *  after refresh and login / logout"). The desktop saves its open cards to
 *  the server-side `echoWallState` preference (per user, so a login brings
 *  it back) and replays them at boot; the web cut threw that state away at
 *  boot (restoreWallOnce(…, null)) and showed the agent alone. Now the web
 *  replays what it can HOST — the in-document tool panels (WEB_TOOL_VIEWS)
 *  in their saved order, a card driven to a side (`solo`) back in its own
 *  column, the agent card back in its seat — and names
 *  what it cannot (a layout, an app card, a section, a CLI agent, a
 *  streamed panel) instead of crashing or faking it. The desktop never
 *  takes this path (its branch already restores). */
export type WebWallCard = { kind: string; toolView?: string; slug?: string; section?: string; agent?: string; name?: string; solo?: boolean };
export type WebWallState = { layout?: string | null; cards?: WebWallCard[] | null; agentAt?: number | null };

/** Can the web host this saved card? Only a tool panel the agent's ⋮ menu
 *  offers on the web (files, terminal, monaco, diff, plan, agents). */
export function webRestorableCard(card: WebWallCard | null | undefined): boolean {
  return !!card && card.kind === "tool" && typeof card.toolView === "string" && webToolAllowed(card.toolView);
}

/** Why a saved card stays closed on the web — one line naming it, for the
 *  console.warn that replaces a silent drop. */
export function webCardSkipReason(card: WebWallCard | null | undefined): string {
  if (!card || typeof card !== "object") return "a malformed card";
  if (card.kind === "tool") return `the ${card.toolView || "unnamed"} panel (not hosted on the web)`;
  if (card.kind === "app") return `the app card "${card.name || card.slug || "unnamed"}" (apps open on the desktop)`;
  if (card.kind === "section") return `the section "${card.section || "unnamed"}" (desktop only)`;
  if (card.kind === "agent") return `the CLI agent "${card.name || card.agent || "unnamed"}" (desktop only)`;
  return `a "${card.kind}" card (unknown kind)`;
}

/** The web's replay of a saved wall: the tool panels to open, in order; the
 *  cards it skips, named; and the agent card's seat among the opened panels
 *  (its index, clamped — a seat saved beside panels that no longer open
 *  still lands). A layout opens nothing: the web boots no wall. */
export function webRestorePlan(saved: WebWallState | null | undefined): { open: WebWallCard[]; skipped: string[]; agentAt: number } {
  if (!saved || typeof saved !== "object") return { open: [], skipped: [], agentAt: 0 };
  if (saved.layout) return { open: [], skipped: [`the layout "${saved.layout}" (the web boots no wall)`], agentAt: 0 };
  const open: WebWallCard[] = [];
  const skipped: string[] = [];
  for (const c of Array.isArray(saved.cards) ? saved.cards : []) {
    if (webRestorableCard(c)) open.push(c); else skipped.push(webCardSkipReason(c));
  }
  const at = typeof saved.agentAt === "number" && Number.isFinite(saved.agentAt) ? Math.trunc(saved.agentAt) : 0;
  return { open, skipped, agentAt: Math.max(0, Math.min(at, open.length)) };
}

/** Does this surface keep the wall's memory the web way — the agent's seat
 *  written beside the cards, and a drag (reorder / drive to a side) saved
 *  like an open or a close? The desktop keeps its own saves untouched. */
export function webWallMemory(web: boolean): boolean {
  return web;
}
