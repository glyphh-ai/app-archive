/**
 * agent-menu.ts — THE AGENT WINDOW'S ONE ⋮ MENU, as data (his report,
 * 2026-10-05, web AND desktop: a new Glyphh agent on a Work session showed
 * TWO ⋮ on its top row — the session kebab (Rename / Pin / Delete, dead on a
 * fresh session) and the Developer-tools ⋮ — one of them empty, the other the
 * tools. His order: ONE menu, the top-right ⋮; never an empty dropdown; a
 * Work session never lists Files / Terminal / Editor / Diff).
 *
 * ONE MENU ON BOTH SURFACES (his order, 2026-10-06: "Cloud is first and every
 * surface pulls from it"): MENU_SECTION_ORDER is the one frozen list, the
 * same on the desktop and the web. The only differences are capabilities,
 * checked where they are used (help/surface.ts): the Browser row needs a
 * streamed panel; a CLI on a desktop path needs that desktop attached.
 *
 * Sections, each present ONLY when it has something to show:
 *   Panels         the workbench views for THIS session's type — Code: Files,
 *                  Terminal, Editor, Browser, Diff, Plan, Agents; Work: Browser,
 *                  Agents — then Artifacts; the Browser only where a streamed
 *                  panel can be. The Work toolbelt has no files, shell, editor
 *                  or diff.
 *   Session        the open session's own actions — Rename, Pin / Unpin, New
 *                  agent panel, Delete. Absent on a fresh landing (nothing to
 *                  rename or delete), so the menu is never a dead click.
 *   Agents / CLIs  COLLAPSED on every open — the CLI agents as built, on both
 *                  surfaces. A click opens the CLI ON THE SESSION'S FOLDER:
 *                  the attached desktop over remote control, or the cloud
 *                  workspace — whatever the session's locus is. A desktop path
 *                  with no desktop attached: the rows stay, disabled, with one
 *                  line and a link to Settings → Devices. With a desktop
 *                  attached, its live CLI sessions nest under each CLI's row
 *                  behind that row's own chevron (collapsed too).
 *   Workspaces     LAST, COLLAPSED on every open — the member's workspaces by
 *                  name (`layoutsList` — the member library's one list on
 *                  every surface); a click opens one through the workbench's
 *                  layout open (surface.ts surfaceLayoutCells filters the
 *                  cells the surface cannot host). Omitted when the member
 *                  has none.
 *
 * Pure: agent-menu-ui.ts paints exactly this; test/main/agent-menu.test.ts
 * pins the behaviours.
 */
import { surfaceCaps, surfaceHostsView, DESKTOP_TOOL_VIEWS } from "./surface.js";

export type MenuSurface = "web" | "desktop";
export type MenuSectionKind = "tools" | "session" | "workspaces";

export const WORKSPACES_SECTION_LABEL = "Workspaces";
export const TOOLS_SECTION_LABEL = "Panels";
export const SESSION_SECTION_LABEL = "Session";

/** THE FROZEN ORDER — one list, both surfaces. No Apps section (his order,
 *  2026-10-09: "remove apps from this menu"): an app is a power, in the + box. */
export const MENU_SECTION_ORDER: ReadonlyArray<MenuSectionKind> = Object.freeze(["tools", "session", "workspaces"] as MenuSectionKind[]);

/** The sections that open as expandable heads, collapsed on every open. */
export const COLLAPSIBLE_SECTIONS: ReadonlyArray<MenuSectionKind> = Object.freeze(["workspaces"]);

/** THE ARTIFACTS PANEL (his order, 2026-10-05) lists in the Panels section
 *  on both surfaces and for both types — last, after the type's own views.
 *  On the web it opens full screen (surface.ts webPanelOpensFullScreen). */
export const ARTIFACTS_VIEW = "artifacts";
/** The Code toolbelt: the old Developer-tools list, in its order, then Artifacts. */
export const CODE_TOOL_VIEWS: ReadonlyArray<string> = Object.freeze([...DESKTOP_TOOL_VIEWS, ARTIFACTS_VIEW]);

const TOOL_LABELS: Record<string, string> = {
  files: "Files", terminal: "Terminal", monaco: "Editor", diff: "Diff", plan: "Plan", agents: "Bots", preview: "Browser", artifacts: "Artifacts",
};

/** One attached desktop (attach.status's machines, name = the member's label for it). */
export interface MenuMachine { id: string; name: string }

/** Where the session's folder is (his order, 2026-10-05: the ⋮ menu is
 *  keyed off it): a desktop path, or the cloud. */
export type MenuLocus = "local" | "cloud";



/** The open session, or null on a fresh landing. */
export interface MenuSession { pinned: boolean }

/** One of the member's workspaces (preload / web-contract `layoutsList`), by name. */
export interface MenuWorkspaceRow { name: string }

export interface AgentMenuInput {
  surface: MenuSurface;
  session: MenuSession | null;
  /** attach.status's machines — is a desktop attached, and which. The
   *  desktop itself is always its own machine. */
  machines?: ReadonlyArray<MenuMachine>;
  /** The session's locus. */
  locus?: MenuLocus;
  /** The member's workspaces (`layoutsList`); none → no section. */
  workspaces?: ReadonlyArray<MenuWorkspaceRow>;
}

export interface MenuWorkspacesSection { kind: "workspaces"; label: string; collapsible: true; count: number; rows: MenuWorkspaceRow[] }
export interface MenuToolRow { view: string; label: string }
export interface MenuToolsSection { kind: "tools"; label: string; rows: MenuToolRow[] }
export type SessionAction = "rename" | "pin" | "new-panel" | "delete";
export interface MenuSessionRow { action: SessionAction; label: string; danger: boolean }
export interface MenuSessionSection { kind: "session"; label: string; rows: MenuSessionRow[] }
export type MenuSection = MenuToolsSection | MenuSessionSection | MenuWorkspacesSection;

export interface AgentMenu {
  surface: MenuSurface;
  attached: boolean;
  /** The machine a desktop open lands on: the first attached desktop. */
  machine: MenuMachine | null;
  /** In paint order (MENU_SECTION_ORDER); never an empty section, never an empty list. */
  sections: MenuSection[];
}

/** The tool views a session of this type offers on this surface: the one
 *  list for the type, through the surface's capabilities (the Browser needs
 *  a streamed panel). */
export function toolViewsFor(surface: MenuSurface): ReadonlyArray<string> {
  const caps = surfaceCaps(surface === "web");
  return CODE_TOOL_VIEWS.filter((v) => surfaceHostsView(v, caps));
}

export function toolRowsFor(surface: MenuSurface): MenuToolRow[] {
  return toolViewsFor(surface).map((view) => ({ view, label: TOOL_LABELS[view] ?? view }));
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

/** The locus the ⋮ menu keys off, read from a session source: a local
 *  source (a desktop path) is "local"; anything else — a cloud source, or
 *  no source at all — is "cloud". */
export function menuLocusOf(source: { kind?: unknown } | null | undefined): MenuLocus {
  return source && typeof source === "object" && source.kind === "local" ? "local" : "cloud";
}

/** THE WORKSPACE ROWS: one per name (trimmed, non-empty), the first of a
 *  duplicate name wins (the library merges rows by name already; this guards
 *  the menu against a stray twin). */
export function workspaceRows(rows: ReadonlyArray<MenuWorkspaceRow>): MenuWorkspaceRow[] {
  const seen = new Set<string>();
  const out: MenuWorkspaceRow[] = [];
  for (const r of rows) {
    const name = String(r?.name ?? "").trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name });
  }
  return out;
}

/** The expandable head's text: "Apps · 3", "Workspaces · 2". */
export function sectionHeadLabel(label: string, count: number): string {
  return `${label} · ${count}`;
}


/** The menu for one open — the same sections on both surfaces. */
export function agentMenuModel(i: AgentMenuInput): AgentMenu {
  const machines = i.machines ?? [];
  const machine = machines[0] ?? null;
  // The desktop IS a desktop: its own folders are always reachable.
  const attached = i.surface === "desktop" || !!machine;
  const byKind = new Map<MenuSectionKind, MenuSection>();
  const tools = toolRowsFor(i.surface);
  if (tools.length) byKind.set("tools", { kind: "tools", label: TOOLS_SECTION_LABEL, rows: tools });
  const session = sessionRowsFor(i.session);
  if (session.length) byKind.set("session", { kind: "session", label: SESSION_SECTION_LABEL, rows: session });
  // NO APPS SECTION (his order, 2026-10-09: "remove apps from this menu in
  // the top right of the agent page"): an app is a power now, found in the
  // + box's Your powers.
  // WORKSPACES, LAST (his order, 2026-10-05): the member's workspaces by
  // name, one row each. Always present since 2026-10-08 — "Create
  // workspace…" lives at its head (his order: "agent -> dropdown -> Create
  // Workspace").
  const spaces = workspaceRows(i.workspaces ?? []);
  byKind.set("workspaces", { kind: "workspaces", label: WORKSPACES_SECTION_LABEL, collapsible: true, count: spaces.length, rows: spaces });
  const sections: MenuSection[] = [];
  for (const kind of MENU_SECTION_ORDER) {
    const s = byKind.get(kind);
    if (s) sections.push(s);
  }
  return { surface: i.surface, attached, machine, sections };
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
