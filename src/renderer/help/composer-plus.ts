/**
 * composer-plus.ts — THE COMPOSER'S `+` MENU (his order, 2026-10-06, with
 * Claude's composer menu as the reference): one component on BOTH surfaces,
 * to the right of the permission-mode chip. Every row = an icon to the left
 * of the words. The desktop has more rows; the web is the desktop with
 * capability checks (web-surface.ts hostHas) — a row whose door the host
 * cannot serve is not offered.
 *
 *   Add files or photos  ⌘U    the attach door (glyphhPickAttachments — paste
 *                              and drag-drop stay as shortcuts)
 *   Skills ›                   the member's skills, a check toggles each
 *                              (skillSetEnabled); Manage skills → Build › Skills
 *   Connectors ›               the member's connected accounts — a custom MCP
 *                              server's check toggles its enabled flag
 *                              (mcpConnectionsUpdate, the Connections page's
 *                              own switch); a Pipedream account opens its
 *                              page (it has no on/off, only Disconnect);
 *                              Add connector / Manage connectors → Connections
 *   Memory ✓                   the member's memory preference (the Settings →
 *                              Memory switches `memoryInject` + `memoryCapture`
 *                              — there is no per-session memory flag, so this
 *                              is the same preference the page toggles)
 *   ── desktop only ──
 *   Add folder…                a folder rides the next message (Code); the
 *                              session's own folder is the folder chip's
 *
 * The MODEL (rows per surface + the door calls) is pure, so the unit test
 * runs it bare; mountComposerPlus paints it into the composer's drop-up.
 */

import { appIconInner } from "./app-icon.js";

export type PlusSurface = "desktop" | "web";
export type PlusSpace = "code";
export type PlusRowId = "attach" | "skills" | "connectors" | "models" | "browse" | "memory" | "add-folder";
export type PlusRowKind = "action" | "submenu" | "check";

export interface PlusRow {
  id: PlusRowId;
  label: string;
  icon: string;
  kind: PlusRowKind;
  shortcut?: string;
  /** A check row's state. */
  checked?: boolean;
  /** A row the web never shows (a native window / the OS filesystem). */
  desktopOnly?: boolean;
  /** A row Code alone shows (a folder is a Code idea; Work has no walker). */
  codeOnly?: boolean;
  /** A separator above this row. */
  sepBefore?: boolean;
  hint?: string;
}

/** What the host can serve, as the menu reads it. */
export interface PlusCaps {
  attach: boolean;
  skills: boolean;
  connectors: boolean;
  /** The member's enabled models (loopModels) — the Models section. */
  models: boolean;
  memory: boolean;
}

/** The capability read, from ONE probe (web-surface.ts hostHas on the live
 *  renderer; a stub in the test). */
export function plusCapsOf(has: (name: string) => boolean): PlusCaps {
  return {
    attach: has("glyphhPickAttachments"),
    skills: has("skillsList") && has("skillSetEnabled"),
    connectors: has("connectionsList") || has("mcpConnectionsList"),
    models: has("loopModels"),
    memory: has("getPreference") && has("setPreference"),
  };
}

const S = `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;
/** The row icons — the house 24-box stroke glyphs (the settings nav's family). */
export const PLUS_ICONS = {
  attach: `<svg viewBox="0 0 24 24" ${S}><path d="M21.4 11.1l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"/></svg>`,
  skills: `<svg viewBox="0 0 24 24" ${S}><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`,
  connectors: `<svg viewBox="0 0 24 24" ${S}><path d="M13.4 10.6a4.4 4.4 0 0 1 0 6.2l-2.9 2.9a4.4 4.4 0 0 1-6.2-6.2l1.7-1.7"/><path d="M10.6 13.4a4.4 4.4 0 0 1 0-6.2l2.9-2.9a4.4 4.4 0 0 1 6.2 6.2l-1.7 1.7"/></svg>`,
  memory: `<svg viewBox="0 0 24 24" ${S}><path d="M12 3a5 5 0 0 0-5 5v1a4 4 0 0 0-2 7v1a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-1a4 4 0 0 0-2-7V8a5 5 0 0 0-5-5z"/><path d="M12 8v12"/></svg>`,
  folder: `<svg viewBox="0 0 24 24" ${S}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  folderPlus: `<svg viewBox="0 0 24 24" ${S}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" ${S}><path d="M12 5v14M5 12h14"/></svg>`,
  models: `<svg viewBox="0 0 24 24" ${S}><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9z"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/></svg>`,
  powers: `<svg viewBox="0 0 24 24" ${S}><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>`,
  chest: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="9" width="18" height="11" rx="2"/><path d="M3 9a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5"/><path d="M3 13h18M11 13v3h2v-3"/></svg>`,
} as const;
export const PLUS_CHECK = `<svg class="drop-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
export const PLUS_CARET = `<svg class="drop-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;

export const ATTACH_SHORTCUT = "⌘U";
export const ATTACH_LABEL = "Add files or photos";
// THE POWERS BOX (his order, 2026-10-09): the + is where a member sees and
// controls Glyphh's powers — Connections, Models, Your powers — and opens the
// whole catalog. Skills and tasks are just "powers you built".
export const BROWSE_POWERS_LABEL = "Browse all powers…";
export const POWERS_LABELS = { connectors: "Connections", models: "Models", skills: "Your powers" } as const;

export interface PlusState {
  surface: PlusSurface;
  space: PlusSpace;
  memoryOn: boolean;
}

/** THE ROWS, per surface: the web (hostHas) never sees a native row; Chat
 *  sees nothing of the folder family; Work sees no "Add folder…" (a belt
 *  with no reader). Pure. */
export function plusMenuRows(caps: PlusCaps, st: PlusState): PlusRow[] {
  const rows: PlusRow[] = [];
  if (caps.attach) rows.push({ id: "attach", label: ATTACH_LABEL, icon: PLUS_ICONS.attach, kind: "action", shortcut: ATTACH_SHORTCUT, hint: "Images and documents ride the next message" });
  // THE POWERS (his order, 2026-10-09): Connections, Models, Your powers, then the whole catalog.
  const powersFrom = rows.length;
  // Each opens THE POWERS MODAL on its tab (his order, 2026-10-09: "the + …
  // launches every power add etc. into the same modal as edit super power does").
  if (caps.connectors) rows.push({ id: "connectors", label: POWERS_LABELS.connectors, icon: PLUS_ICONS.connectors, kind: "action", sepBefore: rows.length > 0, hint: "Connect accounts and choose what their tools may do" });
  if (caps.models) rows.push({ id: "models", label: POWERS_LABELS.models, icon: PLUS_ICONS.models, kind: "action", sepBefore: rows.length > 0 && rows.length === powersFrom, hint: "Your team's models, their rates and details" });
  if (caps.skills) rows.push({ id: "skills", label: POWERS_LABELS.skills, icon: PLUS_ICONS.powers, kind: "action", sepBefore: rows.length > 0 && rows.length === powersFrom, hint: "What you built with Glyphh, and a new one" });
  if (caps.skills || caps.connectors) rows.push({ id: "browse", label: BROWSE_POWERS_LABEL, icon: PLUS_ICONS.chest, kind: "action", hint: "Every power: connections, models, the ones you and your team built" });
  if (caps.memory) rows.push({ id: "memory", label: "Memory", icon: PLUS_ICONS.memory, kind: "check", checked: st.memoryOn, sepBefore: rows.length > 0, hint: st.memoryOn ? "Glyphh remembers this session" : "Off — nothing is remembered" });
  // The folder family is the DESKTOP's (the OS pickers), where a session has
  // a folder to walk.
  if (st.surface === "desktop") {
    // The session's own folder is the folder chip's (2026-10-09): only Add folder… stays here.
    if (caps.attach) rows.push({ id: "add-folder", label: "Add folder…", icon: PLUS_ICONS.folderPlus, kind: "action", desktopOnly: true, codeOnly: true, sepBefore: rows.length > 0, hint: "Give Glyphh read access to another directory" });
  }
  return rows;
}

// ── The doors (the host's API, as the menu calls it) ─────────────────────
type Env<T> = { ok: boolean; data?: T; error?: string };
export interface PlusSkill { id: string; name: string; enabled: boolean; type?: string }
export interface PlusConnection { id: string; appSlug: string; appName: string; label?: string; connected?: boolean; org?: boolean; accountId?: string }
export interface PlusMcp { slug: string; name: string; enabled: boolean; kind?: string; iconUrl?: string | null }
export interface PlusApi {
  skillsList?: (kinds: string[]) => Promise<Env<PlusSkill[]>>;
  skillSetEnabled?: (id: string, on: boolean) => Promise<Env<PlusSkill>>;
  connectionsList?: () => Promise<{ ok: boolean; connections: PlusConnection[] }>;
  mcpConnectionsList?: () => Promise<{ ok: boolean; connections: PlusMcp[] }>;
  mcpConnectionsUpdate?: (slug: string, fields: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  getPreference?: (key: string, defaultVal?: unknown) => Promise<unknown>;
  setPreference?: (key: string, value: unknown) => unknown;
}

/** One connector row of the submenu, from either lane (the Connections page's
 *  own two reads): a custom MCP server toggles; an account opens. */
export interface PlusConnectorRow {
  key: string;
  name: string;
  /** "mcp" rows carry an enabled flag the page toggles; "account" rows are connected or not. */
  kind: "mcp" | "account";
  on: boolean;
  /** The slug the Connections page deep-links on (openConnectionOnLoad). */
  slug: string;
  org: boolean;
  /** The connector's own logo, built exactly as the Connections page builds
   *  it (app-icon.ts appIconInner: the account's logo once the icon cache
   *  warms, a custom server's iconUrl, else the initial). His order,
   *  2026-10-06: "pulled from the same place they are pulled from on the
   *  connections page". */
  icon: string;
  /** What primes the logo cache for an account row (primeConnectedIcons). */
  prime?: { accountId?: string; pipedreamSlug: string };
}
export async function readConnectorRows(api: PlusApi): Promise<PlusConnectorRow[]> {
  const [res, custom] = await Promise.all([
    api.connectionsList?.().catch(() => ({ ok: false, connections: [] as PlusConnection[] })) ?? Promise.resolve({ ok: false, connections: [] as PlusConnection[] }),
    api.mcpConnectionsList?.().catch(() => ({ ok: false, connections: [] as PlusMcp[] })) ?? Promise.resolve({ ok: false, connections: [] as PlusMcp[] }),
  ]);
  const mcps = custom?.connections ?? [];
  const mcpSlugs = new Set(mcps.map((m) => m.slug));
  const conns = (res?.connections ?? []).filter((c) => !mcpSlugs.has(c.appSlug) && !mcpSlugs.has(c.id));
  return [
    ...conns.map((c): PlusConnectorRow => {
      const name = c.label || c.appName;
      const prime = { accountId: c.accountId, pipedreamSlug: c.appSlug };
      return { key: `pd:${c.id}`, name, kind: "account", on: c.connected !== false, slug: c.appSlug, org: !!c.org, icon: connectorIcon({ iconUrl: null, connection: prime }, name), prime };
    }),
    ...mcps.map((m): PlusConnectorRow => ({ key: `mcp:${m.slug}`, name: m.name, kind: "mcp", on: !!m.enabled, slug: m.slug, org: m.kind === "org", icon: connectorIcon({ iconUrl: m.iconUrl ?? null }, m.name) })),
  ].sort((a, b) => a.name.localeCompare(b.name));
}
/** One connector's icon markup — the Connections page's own builder. */
export function connectorIcon(app: { iconUrl: string | null; connection?: { accountId?: string; pipedreamSlug: string } }, name: string): string {
  return appIconInner(app, name, "drop-icon-initial");
}

// ── Memory: the member's preference (there is no per-session flag) ───────
export const MEMORY_PREFS = { accepted: "memoryPolicyAcceptedAt", inject: "memoryInject", capture: "memoryCapture" } as const;
export interface MemoryState { accepted: boolean; on: boolean }
/** On = the policy is accepted and memory is searched (`memoryInject`, the
 *  Settings → Memory "search past sessions" switch; capture rides with it). */
export async function readMemoryState(api: PlusApi): Promise<MemoryState> {
  try {
    const accepted = !!(await api.getPreference?.(MEMORY_PREFS.accepted, ""));
    const inject = await api.getPreference?.(MEMORY_PREFS.inject, true);
    return { accepted, on: accepted && inject !== false };
  } catch { return { accepted: false, on: false }; }
}
/** Flip memory. Writes BOTH switches the page has (search + generate) so
 *  "off" means off. Before the policy is accepted nothing is written — the
 *  caller opens Settings → Memory instead (returns "needs-policy"). */
export function toggleMemory(api: PlusApi, st: MemoryState): "on" | "off" | "needs-policy" {
  if (!st.accepted) return "needs-policy";
  const on = !st.on;
  api.setPreference?.(MEMORY_PREFS.inject, on);
  api.setPreference?.(MEMORY_PREFS.capture, on);
  return on ? "on" : "off";
}

// ── Where "Manage …" goes, per surface ───────────────────────────────────
export type ManageKind = "memory";
export type ManageTarget = { kind: "settings"; sub: string };
/** Memory is a plain settings page on both surfaces; every power opens in
 *  the powers modal instead (the Customize page is gone, 2026-10-09). */
export function manageTargetOf(_surface: PlusSurface, _kind: ManageKind): ManageTarget {
  return { kind: "settings", sub: "memory" };
}

// ── The DOM: the drop-up, its panes and rows ─────────────────────────────
export interface PlusDoors {
  surface: PlusSurface;
  has: (name: string) => boolean;
  api: PlusApi;
  space: () => PlusSpace;
  attachFiles: () => void;
  attachFolder: () => void;
  /** Opens a Manage target (navigation.ts on the live renderer). */
  openTarget: (t: ManageTarget) => void;
  /** THE POWERS MODAL on a tab (help/powers-modal.ts). */
  openPowers: (tab: "folders" | "connections" | "models" | "skills") => void;
  toast: (msg: string) => void;
  /** Place an opened drop-up (openChipDropUp on the live renderer). */
  place: (menu: HTMLElement) => void;
}

export interface PlusController {
  menu: HTMLElement;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** ⌘U — the attach door, when the host has it. */
  attachFiles: () => void;
}

const appendMarkup = (host: HTMLElement, svg: string): void => { host.insertAdjacentHTML("beforeend", svg); };

/** One row: icon · words · (shortcut | caret | check). */
function rowEl(opts: { label: string; icon: string; kind: PlusRowKind; checked?: boolean; shortcut?: string; hint?: string; sub?: string; muted?: boolean }): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "code-drop-item code-plus-item" + (opts.checked ? " selected" : "") + (opts.muted ? " muted" : "");
  b.setAttribute("role", opts.kind === "check" ? "menuitemcheckbox" : "menuitem");
  if (opts.kind === "check") b.setAttribute("aria-checked", opts.checked ? "true" : "false");
  if (opts.kind === "submenu") b.setAttribute("aria-haspopup", "menu");
  if (opts.hint) b.title = opts.hint;
  const icon = document.createElement("span");
  icon.className = "drop-icon";
  icon.innerHTML = opts.icon;
  const lines = document.createElement("span");
  lines.className = "drop-lines";
  const main = document.createElement("span");
  main.className = "drop-main";
  main.textContent = opts.label;
  lines.appendChild(main);
  if (opts.sub) {
    const sub = document.createElement("span");
    sub.className = "drop-sub";
    sub.textContent = opts.sub;
    lines.appendChild(sub);
  }
  b.append(icon, lines);
  if (opts.shortcut) {
    const k = document.createElement("span");
    k.className = "drop-key";
    k.textContent = opts.shortcut;
    b.appendChild(k);
  }
  if (opts.kind === "submenu") appendMarkup(b, PLUS_CARET);
  if (opts.kind === "check") {
    const slot = document.createElement("span");
    slot.className = "drop-check-slot";
    if (opts.checked) slot.innerHTML = PLUS_CHECK;
    b.appendChild(slot);
  }
  return b;
}

function sepEl(): HTMLElement {
  const s = document.createElement("div");
  s.className = "code-drop-sep";
  return s;
}

/** Keyboard on the open menu: arrows move, Enter picks, Esc closes (a
 *  sub-pane's Esc steps back first). */
function menuKeys(menu: HTMLElement, e: KeyboardEvent, back: () => boolean, close: () => void): void {
  const pane = menu.querySelector<HTMLElement>(".drop-pane:not(.hidden)") ?? menu;
  const rows = Array.from(pane.querySelectorAll<HTMLButtonElement>(".code-drop-item"));
  const at = rows.findIndex((r) => r === document.activeElement);
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!back()) close(); }
  else if (e.key === "ArrowDown" && rows.length) { e.preventDefault(); rows[(at + 1 + rows.length) % rows.length].focus(); }
  else if (e.key === "ArrowUp" && rows.length) { e.preventDefault(); rows[(at - 1 + rows.length) % rows.length].focus(); }
  else if (e.key === "ArrowLeft") { if (back()) e.preventDefault(); }
  else if (e.key === "ArrowRight" && at >= 0 && rows[at].getAttribute("aria-haspopup") === "menu") { e.preventDefault(); rows[at].click(); }
  else if (e.key === "Enter" && at >= 0) { e.preventDefault(); rows[at].click(); }
}

/** Build the `+` menu into `wrap` (the chip's `.code-chipwrap`) and wire the
 *  chip. The menu keeps the id `code-plus-menu` the composer's outside-click
 *  closer already knows. */
export function mountComposerPlus(wrap: HTMLElement, chip: HTMLButtonElement | null, doors: PlusDoors): PlusController {
  const menu = document.createElement("div");
  menu.id = "code-plus-menu";
  menu.className = "code-drop-up code-plus-menu hidden";
  menu.setAttribute("role", "menu");
  wrap.appendChild(menu);
  const caps = plusCapsOf(doors.has);
  let memory: MemoryState = { accepted: false, on: false };

  const close = (): void => { menu.classList.add("hidden"); chip?.focus(); };
  const focusFirst = (pane: HTMLElement): void => { pane.querySelector<HTMLButtonElement>(".code-drop-item")?.focus(); };

  /** The root pane — rebuilt on every open (the memory state is read then). */
  const paintRoot = (): HTMLElement => {
    menu.textContent = "";
    const pane = document.createElement("div");
    pane.className = "drop-pane plus-root";
    menu.appendChild(pane);
    const st: PlusState = { surface: doors.surface, space: doors.space(), memoryOn: memory.on };
    const rows = plusMenuRows(caps, st);
    for (const r of rows) {
      if (r.sepBefore) pane.appendChild(sepEl());
      const b = rowEl({ label: r.label, icon: r.icon, kind: r.kind, checked: r.checked, shortcut: r.shortcut, hint: r.hint });
      b.dataset.plusRow = r.id;
      if (r.codeOnly) b.classList.add("plus-folder-only");
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        switch (r.id) {
          case "attach": close(); doors.attachFiles(); break;
          case "add-folder": close(); doors.attachFolder(); break;
          case "skills": close(); doors.openPowers("skills"); break;
          case "connectors": close(); doors.openPowers("connections"); break;
          case "models": close(); doors.openPowers("models"); break;
          case "browse": close(); doors.openPowers("skills"); break;
          case "memory": {
            const verdict = toggleMemory(doors.api, memory);
            if (verdict === "needs-policy") { close(); doors.openTarget(manageTargetOf(doors.surface, "memory")); doors.toast("Accept the memory policy first — Settings › Memory."); break; }
            memory = { ...memory, on: verdict === "on" };
            doors.toast(verdict === "on" ? "Memory on" : "Memory off");
            // Repaint, and keep the keyboard on the row (the old button is gone).
            paintRoot().querySelector<HTMLButtonElement>('[data-plus-row="memory"]')?.focus();
            break;
          }
        }
      });
      pane.appendChild(b);
    }
    return pane;
  };

  const goBack = (): boolean => {
    const sub = menu.querySelector<HTMLElement>(".plus-sub");
    if (!sub) return false;
    sub.remove();
    const root = menu.querySelector<HTMLElement>(".plus-root");
    root?.classList.remove("hidden");
    if (root) focusFirst(root);
    return true;
  };
  const open = (): void => {
    if (!menu.classList.contains("hidden")) return;
    paintRoot();
    menu.classList.remove("hidden");
    doors.place(menu);
    // The memory read lands a beat later; the row repaints with it.
    if (caps.memory) void readMemoryState(doors.api).then((m) => {
      memory = m;
      if (menu.classList.contains("hidden") || menu.querySelector(".plus-sub")) return;
      const row = menu.querySelector<HTMLButtonElement>('[data-plus-row="memory"]');
      if (!row) return;
      row.setAttribute("aria-checked", m.on ? "true" : "false");
      row.classList.toggle("selected", m.on);
      row.title = m.on ? "Glyphh remembers this session" : "Off — nothing is remembered";
      const slot = row.querySelector<HTMLElement>(".drop-check-slot");
      if (slot) slot.innerHTML = m.on ? PLUS_CHECK : "";
    });
    focusFirst(menu);
  };
  const toggle = (): void => { if (menu.classList.contains("hidden")) open(); else close(); };

  menu.addEventListener("keydown", (e) => menuKeys(menu, e, goBack, close));
  // Esc closes the open menu from anywhere (the keys may sit on the composer).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || menu.classList.contains("hidden") || menu.contains(e.target as Node)) return;
    e.stopPropagation();
    if (!goBack()) close();
  }, true);
  chip?.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
  chip?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && menu.classList.contains("hidden")) { e.preventDefault(); open(); }
  });
  if (chip) chip.setAttribute("aria-haspopup", "menu");

  return { menu, open, close, toggle, attachFiles: () => { if (caps.attach) doors.attachFiles(); } };
}
