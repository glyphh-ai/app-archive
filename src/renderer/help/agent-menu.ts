/**
 * agent-menu.ts — THE AGENT WINDOW'S ONE ⋮ MENU, as data (his report,
 * 2026-10-05, web AND desktop: a new Glyphh agent on a Work session showed
 * TWO ⋮ on its top row — the session kebab (Rename / Pin / Delete, dead on a
 * fresh session) and the Developer-tools ⋮ — one of them empty, the other the
 * tools. His order: ONE menu, the top-right ⋮; never an empty dropdown; a
 * Work session never lists Files / Terminal / Editor / Diff).
 *
 * THE ORDER IS THE DESKTOP'S (his review of the web cut, 2026-10-05: "the top
 * of the list should be exactly the same as it is on desktop, meaning the
 * order"). MENU_SECTION_ORDER is the one frozen list: the desktop's rows —
 * Panels, then Session — come FIRST on both surfaces, in the desktop's order;
 * the two web-only sections follow them. The test asserts both lists.
 *
 * Sections, each present ONLY when it has something to show:
 *   Panels         the workbench views for THIS session's type — Code: Files,
 *                  Terminal, Editor, (Browser on the desktop), Diff, Plan,
 *                  Agents; Work: Agents (and the Browser on the desktop) —
 *                  the Work toolbelt has no files, shell, editor or diff.
 *   Session        the open session's own actions — Rename, Pin / Unpin, New
 *                  agent panel, Delete. Absent on a fresh landing (nothing to
 *                  rename or delete), so the menu is never a dead click.
 *   Apps           WEB ONLY, COLLAPSED on every open (his review: "dropdowns
 *                  or expandable sections that are collapsed on load") — ONLY
 *                  the GLYPHH APPS the attached desktop can load (his review:
 *                  "the apps should ONLY be glyphh apps that can load from the
 *                  connected machine"): the rows of its `panelApps.list` whose
 *                  kind is "glyphh" (an installed bundle — apps-store.ts /
 *                  org-apps.ts toRow); URL tabs, native apps, vendor marks and
 *                  the system rows are out. A click opens the app ON THE
 *                  DESKTOP (`panels.open {app}`) and the web says "Opened on
 *                  <machine>". No desktop → the section stays, disabled, with
 *                  one line and a link to Settings → Devices.
 *   Agents / CLIs  WEB ONLY, COLLAPSED on every open — the CLI agents as
 *                  built: a click opens a cloud terminal running that CLI on
 *                  the worker; with a desktop attached, its live CLI sessions
 *                  nest under each CLI's row behind that row's own chevron
 *                  (collapsed too), a click resuming that session on the desktop.
 *
 * Pure: agent-menu-ui.ts paints exactly this; test/main/agent-menu.test.ts
 * pins the behaviours.
 */
import { WEB_TOOL_VIEWS } from "./web-cut.js";

export type MenuSurface = "web" | "desktop";
export type MenuMode = "work" | "code";
export type MenuSectionKind = "tools" | "session" | "apps" | "clis";

export const CONNECT_DESKTOP_LINE = "Connect your desktop to open apps";
export const CONNECT_DESKTOP_LINK = "Settings → Devices";
export const APPS_SECTION_LABEL = "Apps";
export const CLIS_SECTION_LABEL = "Agents / CLIs";
export const TOOLS_SECTION_LABEL = "Panels";
export const SESSION_SECTION_LABEL = "Session";
export const NO_APPS_LINE = "No Glyphh apps installed on this desktop";
/** How many of a CLI's sessions list under it (newest first). */
export const CLI_SESSIONS_PER_CLI = 5;

/** THE FROZEN ORDER, per surface. The desktop's list is a PREFIX of the
 *  web's: the web's first sections are the desktop's, in the desktop's
 *  order; its own two come after. */
export const MENU_SECTION_ORDER: Readonly<Record<MenuSurface, ReadonlyArray<MenuSectionKind>>> = Object.freeze({
  desktop: Object.freeze(["tools", "session"] as MenuSectionKind[]),
  web: Object.freeze(["tools", "session", "apps", "clis"] as MenuSectionKind[]),
});

/** The sections that open as expandable heads, collapsed on every open. */
export const COLLAPSIBLE_SECTIONS: ReadonlyArray<MenuSectionKind> = Object.freeze(["apps", "clis"]);

/** The desktop's Code toolbelt: the old Developer-tools list, in its order. */
export const DESKTOP_CODE_TOOL_VIEWS: ReadonlyArray<string> = Object.freeze(["files", "terminal", "monaco", "preview", "diff", "plan", "agents"]);
/** A Work session's panels: the swarm (and, on the desktop, the Browser). */
export const DESKTOP_WORK_TOOL_VIEWS: ReadonlyArray<string> = Object.freeze(["preview", "agents"]);
export const WEB_WORK_TOOL_VIEWS: ReadonlyArray<string> = Object.freeze(["agents"]);

const TOOL_LABELS: Record<string, string> = {
  files: "Files", terminal: "Terminal", monaco: "Editor", diff: "Diff", plan: "Plan", agents: "Agents", preview: "Browser",
};

/** The one app kind the web's Apps section lists: an installed Glyphh app
 *  bundle (apps-store.ts LocalAppRow.kind "glyphh" — org-apps.ts toRow
 *  projects it as appArchetype "glyphh-app"; web-contract.js desktopAppRow
 *  carries it back as `kind`). */
export const GLYPHH_APP_KIND = "glyphh";

/** One attached desktop (attach.status's machines, name = the member's label for it). */
export interface MenuMachine { id: string; name: string }

/** An app row off a desktop's `panelApps.list`, tagged with the machine it came from. */
export interface MenuAppRow {
  slug: string;
  name: string;
  /** The row's kind as the desktop stores it: "glyphh" (a bundle), "web" (a URL tab), "native". */
  kind?: string;
  /** The art the web can show: a data URL, the marketplace icon, a proxied favicon, or nothing. */
  icon?: string | null;
  machineId: string;
  machineName: string;
}

/** A CLI agent row (preload / web-contract `cliAgentsList`). */
export interface MenuCliRow { id: string; name: string }

/** A desktop CLI session (preload / web-contract `cliSessionsList`). */
export interface MenuCliSession { id: string; cli: string; title: string; cwd: string; mtime: number }

/** The open session, or null on a fresh landing. */
export interface MenuSession { pinned: boolean }

export interface AgentMenuInput {
  surface: MenuSurface;
  /** The session's type (modeOf), or the rail's active tab on a fresh landing. */
  mode: MenuMode;
  session: MenuSession | null;
  /** WEB: attach.status's machines — is a desktop attached, and which. */
  machines?: ReadonlyArray<MenuMachine>;
  apps?: ReadonlyArray<MenuAppRow>;
  clis?: ReadonlyArray<MenuCliRow>;
  cliSessions?: ReadonlyArray<MenuCliSession>;
}

export interface MenuAppsSection {
  kind: "apps";
  label: string;
  /** Expandable head, collapsed on open (COLLAPSIBLE_SECTIONS). */
  collapsible: true;
  /** The rows behind the head — the number on it ("Apps · 3"). */
  count: number;
  /** False with no desktop attached: the rows are empty and `note` says why. */
  enabled: boolean;
  rows: MenuAppRow[];
  /** The one line under a disabled section (or an attached desktop with nothing installed). */
  note: string | null;
  /** Shown beside the note only when a desktop is missing. */
  link: { label: string; settingsSub: string } | null;
}
export interface MenuCliEntry { id: string; name: string; sessions: MenuCliSession[] }
export interface MenuClisSection { kind: "clis"; label: string; collapsible: true; count: number; rows: MenuCliEntry[] }
export interface MenuToolRow { view: string; label: string }
export interface MenuToolsSection { kind: "tools"; label: string; rows: MenuToolRow[] }
export type SessionAction = "rename" | "pin" | "new-panel" | "delete";
export interface MenuSessionRow { action: SessionAction; label: string; danger: boolean }
export interface MenuSessionSection { kind: "session"; label: string; rows: MenuSessionRow[] }
export type MenuSection = MenuAppsSection | MenuClisSection | MenuToolsSection | MenuSessionSection;

export interface AgentMenu {
  surface: MenuSurface;
  mode: MenuMode;
  attached: boolean;
  /** The machine an open lands on: the first attached desktop. */
  machine: MenuMachine | null;
  /** In paint order (MENU_SECTION_ORDER[surface]); never an empty section, never an empty list. */
  sections: MenuSection[];
}

/** The tool views a session of this type offers on this surface. */
export function toolViewsFor(surface: MenuSurface, mode: MenuMode): ReadonlyArray<string> {
  if (surface === "web") return mode === "work" ? WEB_WORK_TOOL_VIEWS : WEB_TOOL_VIEWS;
  return mode === "work" ? DESKTOP_WORK_TOOL_VIEWS : DESKTOP_CODE_TOOL_VIEWS;
}

export function toolRowsFor(surface: MenuSurface, mode: MenuMode): MenuToolRow[] {
  return toolViewsFor(surface, mode).map((view) => ({ view, label: TOOL_LABELS[view] ?? view }));
}

/** The open session's rows: Rename, Pin / Unpin, New agent panel, Delete (danger, last). */
export function sessionRowsFor(session: MenuSession | null): MenuSessionRow[] {
  if (!session) return [];
  return [
    { action: "rename", label: "Rename", danger: false },
    { action: "pin", label: session.pinned ? "Unpin" : "Pin", danger: false },
    { action: "new-panel", label: "New agent panel", danger: false },
    { action: "delete", label: "Delete", danger: true },
  ];
}

/** THE APPS FILTER: only Glyphh app bundles (kind "glyphh") with a slug, one
 *  row per slug (two attached desktops with the same app show it once). */
export function glyphhAppsOnly(rows: ReadonlyArray<MenuAppRow>): MenuAppRow[] {
  const seen = new Set<string>();
  const out: MenuAppRow[] = [];
  for (const r of rows) {
    if (!r.slug || r.kind !== GLYPHH_APP_KIND) continue;
    const k = r.slug.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** The expandable head's text: "Apps · 3", "Agents / CLIs · 6". */
export function sectionHeadLabel(label: string, count: number): string {
  return `${label} · ${count}`;
}

/** The menu for one open. */
export function agentMenuModel(i: AgentMenuInput): AgentMenu {
  const machines = i.machines ?? [];
  const machine = i.surface === "web" ? (machines[0] ?? null) : null;
  const attached = !!machine;
  const byKind = new Map<MenuSectionKind, MenuSection>();
  const tools = toolRowsFor(i.surface, i.mode);
  if (tools.length) byKind.set("tools", { kind: "tools", label: TOOLS_SECTION_LABEL, rows: tools });
  const session = sessionRowsFor(i.session);
  if (session.length) byKind.set("session", { kind: "session", label: SESSION_SECTION_LABEL, rows: session });
  if (i.surface === "web") {
    const appRows = attached ? glyphhAppsOnly(i.apps ?? []) : [];
    byKind.set("apps", {
      kind: "apps",
      label: APPS_SECTION_LABEL,
      collapsible: true,
      count: appRows.length,
      enabled: attached,
      rows: appRows,
      note: !attached ? CONNECT_DESKTOP_LINE : appRows.length ? null : NO_APPS_LINE,
      link: !attached ? { label: CONNECT_DESKTOP_LINK, settingsSub: "devices" } : null,
    });
    const sessions = attached ? [...(i.cliSessions ?? [])].sort((a, b) => (b.mtime || 0) - (a.mtime || 0)) : [];
    const clis = (i.clis ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      sessions: sessions.filter((s) => s.cli === c.id).slice(0, CLI_SESSIONS_PER_CLI),
    }));
    if (clis.length) byKind.set("clis", { kind: "clis", label: CLIS_SECTION_LABEL, collapsible: true, count: clis.length, rows: clis });
  }
  const sections: MenuSection[] = [];
  for (const kind of MENU_SECTION_ORDER[i.surface]) {
    const s = byKind.get(kind);
    if (s) sections.push(s);
  }
  return { surface: i.surface, mode: i.mode, attached, machine, sections };
}

// ── THE FOLD STATE: what is expanded in the menu on screen ─────────────────
// A fresh set on every open — nothing expanded (his order: collapsed on load,
// at the very least). Keys: a section's kind ("apps", "clis") and a CLI's own
// row (cliFoldKey) for the sessions nested under it.

export type FoldState = Set<string>;

/** The state a menu opens with: everything collapsed. */
export function menuFoldState(): FoldState {
  return new Set<string>();
}

/** The fold key of a CLI's nested sessions. */
export function cliFoldKey(cliId: string): string {
  return `cli:${cliId}`;
}

export function isExpanded(state: FoldState, key: string): boolean {
  return state.has(key);
}

/** Toggle one fold; answers the new expanded state. */
export function toggleFold(state: FoldState, key: string): boolean {
  if (state.has(key)) { state.delete(key); return false; }
  state.add(key);
  return true;
}

/** The toast after an app opened on the desktop. */
export function openedOnLine(machineName: string): string {
  return `Opened on ${machineName || "your desktop"}`;
}
