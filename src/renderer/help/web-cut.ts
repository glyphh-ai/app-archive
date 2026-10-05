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
  "general", "appearance", "memory", "privacy", "devices", "account", "artifacts", "usage", "mcp", "connections-cfg",
  "billing", "support", "about",
]);

/** The rail's doors into the command center and the Build/Customize pages —
 *  hidden on web (ids and selectors, applied by web-surface.ts). */
export const WEB_HIDDEN_RAIL: ReadonlyArray<string> = Object.freeze([
  "#rail-echo-btn", "#rail-echo-btn-strip", "#rail-more-toggle",
  '.app-rail-nav-item[data-settings-sub="build"]', '.app-rail-nav-item[data-settings-sub="customize"]',
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
