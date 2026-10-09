/**
 * powers-modal.ts — THE POWERS MODAL, used everywhere (his order, 2026-10-09:
 * "This is going to be the powers modal that is used everywhere. First it
 * needs a search for each tab on the left of the page and to the right of the
 * search a + Add. Starting with connections. This will slide the connections
 * tab to discover… listed and searchable with the connect button. Connecting
 * kicks off the oauth flow, then once connected the customize -> connection
 * -> tools / permissions page shows in this modal with <- connections").
 *
 * One fixed size. Four tabs: Folders, Connections, Models, Your powers. Each
 * tab: a search on the left, + Add on its right, the list under them.
 *
 *   Connections   + Add slides to the directory (the Discover cards as a
 *                 searchable list, each with Connect). Connect runs the OAuth
 *                 flow; once the account lands its tool permissions open here,
 *                 under "‹ Connections" back to the list. A row's name opens
 *                 the same page.
 *   Folders       + Add opens the folder picker (desktop).
 *   Models, Your powers   + Add is not built yet.
 *
 * With a `selection` (a super power's powers) every row carries the Discover
 * card's button, + to add and ✓ once added (a ✓ takes it back off),
 * and the footer saves the picks; Cancel, ✕ or Escape drop them.
 */

import { escapeHtml, guardWebviewsForModal } from "./shared.js";
import { appIconInner, primeConnectedIcons } from "./app-icon.js";
import { PLUS_ICONS, readConnectorRows, type PlusApi, type PlusConnectorRow } from "./composer-plus.js";
import { renderToolGroups } from "./settings-connections.js";
import { planGates } from "./plan-gate.js";
import { hideAppOverlay } from "../app-overlay.js";

export type PowerTab = "folders" | "connections" | "models" | "skills";
export const POWER_TABS: ReadonlyArray<{ tab: PowerTab; label: string }> = Object.freeze([
  { tab: "folders", label: "Folders" },
  { tab: "connections", label: "Connections" },
  { tab: "models", label: "Models" },
  { tab: "skills", label: "Your powers" },
]);

/** A super power's picks. `models` is one list: the first is the one it runs on. */
export interface PowerSelection { folders: string[]; connections: string[]; models: string[]; skills: string[] }

export interface PowersModalOptions {
  tab?: PowerTab;
  /** Present when the modal picks powers FOR something (a super power). */
  selection?: PowerSelection;
  onSave?: (sel: PowerSelection) => Promise<{ ok: boolean; error?: string }>;
  title?: string;
}

type Conn = { id: string; appSlug: string; appName: string; label?: string; connected?: boolean; accountId?: string; org?: boolean; shared?: boolean };
type CatalogApp = { id: string; name: string; description: string; icon?: string };
interface Api extends PlusApi {
  loopModels?: (loopId: string, force?: boolean) => Promise<{ ok: boolean; models: Array<{ id: string; name: string; utility?: boolean }> }>;
  pickDirectory?: () => Promise<string | null>;
  getWorkingDirRecents?: () => Promise<string[]>;
  connectorsGetApps?: (search?: string, after?: string, category?: string) => Promise<{ apps: CatalogApp[]; hasMore: boolean; next?: string }>;
  connectorsConnect?: (appSlug: string) => Promise<{ ok: boolean; error?: string }>;
  onConnectorsChanged?: (cb: () => void) => void;
  connectionToolsList?: (id: string) => Promise<{ ok: boolean; tools?: Array<{ name: string; description?: string; hidden?: boolean }>; error?: string }>;
  connectionToolsSet?: (id: string, hidden: string[]) => Promise<unknown>;
}
const api = (): Api => ((window as unknown as { glyphh?: Api }).glyphh ?? {});

const S = `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"`;
const CLOSE_SVG = `<svg ${S} stroke-width="2.4"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
const SEARCH_SVG = `<svg ${S} stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
const BACK_SVG = `<svg ${S} stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>`;
const MODEL_SVG = `<svg ${S} stroke-width="1.9"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>`;
const CHECK_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>`;
const PLUS_BTN_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
const POWER_SVG = `<svg ${S} stroke-width="1.9"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const baseName = (p: string): string => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
const matches = (needle: string, ...hay: string[]): boolean => !needle || hay.join(" ").toLowerCase().includes(needle);

/** Flip one name in a list (order kept; a model list's first stays the one it runs on). */
export function toggleIn(list: string[], name: string): string[] {
  return list.includes(name) ? list.filter((x) => x !== name) : [...list, name];
}

/** THE CONNECT CLOCK (settings-connections.ts awaitConnected, the same waits):
 *  the account lands out of band after the OAuth window closes; a
 *  connectors-changed push from main wakes the wait at once. */
const CONNECT_WAITS_MS: ReadonlyArray<number> = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000];
let wake: (() => void) | null = null;
let wakeWired = false;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
  const t = setTimeout(() => { wake = null; resolve(); }, ms);
  wake = () => { clearTimeout(t); wake = null; resolve(); };
});

let openModal: { close: () => void } | null = null;

export function openPowersModal(opts: PowersModalOptions = {}): void {
  openModal?.close();
  if (!wakeWired) { wakeWired = true; api().onConnectorsChanged?.(() => wake?.()); }
  let tab: PowerTab = opts.tab ?? "folders";
  const sel: PowerSelection | null = opts.selection
    ? { folders: [...opts.selection.folders], connections: [...opts.selection.connections], models: [...opts.selection.models], skills: [...opts.selection.skills] }
    : null;
  /** The connections tab's own screens: the list, the directory, one connection's permissions. */
  let connView: { kind: "list" } | { kind: "discover" } | { kind: "perms"; conn: Conn; app?: CatalogApp } = { kind: "list" };
  const queries: Record<string, string> = {};
  let conns: Conn[] = [];
  let rows: PlusConnectorRow[] = [];
  let models: Array<{ id: string; name: string }> = [];
  let skills: Array<{ id: string; name: string; type?: string }> = [];
  let recents: string[] = [];
  let catalog: CatalogApp[] = [];
  let catalogNext = "";
  let catalogQ = "";
  let catalogLoaded = false;
  let connectAllowed = true;
  const connecting = new Set<string>();
  let closed = false;

  const overlay = el("div", "confirm-overlay powm");
  overlay.innerHTML = `
    <div class="confirm-box powm-box" role="dialog" aria-modal="true">
      <div class="confirm-head powm-head"><h3></h3>
        <button class="ws-icon-btn powm-x" type="button" title="Close" aria-label="Close">${CLOSE_SVG}</button></div>
      <div class="skills-tabs powm-tabs" role="tablist"></div>
      <div class="powm-bar"></div>
      <div class="confirm-body powm-body"></div>
      <div class="crud-form-error powm-error hidden"></div>
      <div class="confirm-foot powm-foot"></div>
    </div>`;
  const q = <T extends HTMLElement>(s: string): T => overlay.querySelector<T>(s)!;
  q<HTMLElement>(".powm-head h3").textContent = opts.title ?? "Add a power";
  overlay.querySelector(".powm-box")!.setAttribute("aria-label", opts.title ?? "Add a power");
  const tabsEl = q<HTMLElement>(".powm-tabs");
  const bar = q<HTMLElement>(".powm-bar");
  const body = q<HTMLElement>(".powm-body");
  const errEl = q<HTMLElement>(".powm-error");
  const foot = q<HTMLElement>(".powm-foot");
  const showErr = (msg: string): void => { errEl.textContent = msg; errEl.classList.toggle("hidden", !msg); };

  for (const t of POWER_TABS) {
    const b = el("button", "skills-tab", t.label);
    b.type = "button"; b.dataset.tab = t.tab; b.setAttribute("role", "tab");
    b.addEventListener("click", () => { tab = t.tab; if (t.tab === "connections") connView = { kind: "list" }; showErr(""); paint(); });
    tabsEl.appendChild(b);
  }

  // ── the footer: Cancel · Save with a selection, Done without ──
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    guardWebviewsForModal(false);
    document.removeEventListener("keydown", onKey, true);
    if (openModal?.close === close) openModal = null;
  };
  function onKey(e: KeyboardEvent): void { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }
  if (sel && opts.onSave) {
    const cancel = el("button", "action-btn secondary", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", close);
    const save = el("button", "action-btn primary", "Save");
    save.type = "button";
    save.addEventListener("click", async () => {
      save.disabled = true;
      const r = await opts.onSave!(sel).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      save.disabled = false;
      if (!r.ok) { showErr(r.error || "The powers could not be saved."); return; }
      close();
    });
    foot.append(cancel, save);
  } else {
    const done = el("button", "action-btn primary", "Done");
    done.type = "button";
    done.addEventListener("click", close);
    foot.appendChild(done);
  }
  q(".powm-x").addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });

  // ── the bar: search left, + Add right (or ‹ Connections on a sub-screen) ──
  /** The search inputs live as long as the modal, one per screen, so typing never loses its caret. */
  const searches = new Map<string, HTMLInputElement>();
  function searchBox(key: string, placeholder: string, onInput: (v: string) => void): HTMLElement {
    const box = el("div", "skills-search powm-search");
    box.innerHTML = SEARCH_SVG;
    let input = searches.get(key);
    if (!input) {
      input = el("input");
      input.type = "text"; input.spellcheck = false; input.autocomplete = "off";
      input.value = queries[key] ?? "";
      input.addEventListener("input", () => { queries[key] = input!.value; onInput(input!.value); });
      searches.set(key, input);
    }
    input.placeholder = placeholder;
    box.appendChild(input);
    return box;
  }
  function addButton(label: string, onClick: (() => void) | null, why = ""): HTMLButtonElement {
    const b = el("button", "action-btn primary powm-add", label);
    b.type = "button";
    if (onClick) b.addEventListener("click", onClick); else { b.disabled = true; b.title = why; }
    return b;
  }
  function backButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = el("button", "skills-back powm-back");
    b.type = "button";
    b.innerHTML = `${BACK_SVG}<span></span>`;
    b.querySelector("span")!.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  /** One row: icon, name (opening it when it has a page), a quiet line, and + / ✓ or an action. */
  function row(o: { icon: string; name: string; sub?: string; tag?: string; has?: boolean; onToggle?: () => void; onOpen?: () => void; action?: HTMLElement }): HTMLElement {
    const r = el("div", "botp-choice powm-row" + (o.onOpen ? " openable" : ""));
    const ic = el("div", "botp-power-icon powm-icon");
    ic.innerHTML = o.icon;
    const main = el("div", "botp-power-main");
    main.appendChild(el("div", "botp-power-name", o.name));
    if (o.sub) main.appendChild(el("div", "botp-power-sub", o.sub));
    r.append(ic, main);
    if (o.onOpen) main.addEventListener("click", o.onOpen);
    if (o.tag) r.appendChild(el("span", "botp-power-tag", o.tag));
    if (o.action) r.appendChild(o.action);
    else if (sel && o.onToggle) {
      // THE DISCOVER CARD'S BUTTON on every row (his order, 2026-10-09): + to
      // add, ✓ once added; the ✓ takes it back off.
      const b = el("button", "action-btn conn2-plus powm-pick" + (o.has ? " done" : ""));
      b.type = "button";
      b.innerHTML = o.has ? CHECK_SVG : PLUS_BTN_SVG;
      b.title = o.has ? `Added — click to remove ${o.name}` : `Add ${o.name}`;
      b.setAttribute("aria-label", o.has ? `Remove ${o.name}` : `Add ${o.name}`);
      b.setAttribute("aria-pressed", o.has ? "true" : "false");
      b.addEventListener("click", (e) => { e.stopPropagation(); o.onToggle!(); });
      r.appendChild(b);
    }
    return r;
  }
  const empty = (t: string): void => { body.appendChild(el("div", "botp-empty", t)); };

  // ── paint ──
  function paint(): void {
    if (closed) return;
    tabsEl.querySelectorAll<HTMLElement>(".skills-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    bar.textContent = "";
    body.textContent = "";
    if (tab === "folders") paintFolders();
    else if (tab === "connections") paintConnections();
    else if (tab === "models") paintModels();
    else paintSkills();
  }
  function repaintBody(): void {
    body.textContent = "";
    if (tab === "folders") paintFolders(true);
    else if (tab === "connections") paintConnections(true);
    else if (tab === "models") paintModels(true);
    else paintSkills(true);
  }

  function paintFolders(bodyOnly = false): void {
    const desktop = !!api().pickDirectory;
    if (!bodyOnly) bar.append(searchBox("folders", "Search folders", repaintBody), addButton("+ Add", desktop ? () => {
      void api().pickDirectory!().then((dir) => {
        if (!dir) return;
        if (!recents.includes(dir)) recents = [dir, ...recents];
        if (sel && !sel.folders.includes(dir)) sel.folders = [...sel.folders, dir];
        paint();
      });
    } : null, "Folders live on your computer: open Glyphh on your desktop."));
    if (!desktop) { empty("Folders live on your computer. Open Glyphh on your desktop to add one."); }
    const needle = (queries.folders ?? "").trim().toLowerCase();
    const have = sel?.folders ?? [];
    const list = [...have, ...recents.filter((r) => !have.includes(r))].filter((f) => matches(needle, f));
    if (!list.length && desktop) empty(needle ? "Nothing matches." : "No folders yet. + Add picks one.");
    for (const f of list) body.appendChild(row({ icon: PLUS_ICONS.folder, name: baseName(f), sub: f, has: have.includes(f), onToggle: () => { sel!.folders = toggleIn(sel!.folders, f); repaintBody(); } }));
  }

  // ── CONNECTIONS ──
  function paintConnections(bodyOnly = false): void {
    if (connView.kind === "discover") { paintDiscover(bodyOnly); return; }
    if (connView.kind === "perms") { if (!bodyOnly) void paintPerms(connView.conn, connView.app); return; }
    if (!bodyOnly) bar.append(searchBox("connections", "Search connections", repaintBody), addButton("+ Add", () => { connView = { kind: "discover" }; paint(); }));
    const needle = (queries.connections ?? "").trim().toLowerCase();
    const have = sel?.connections ?? [];
    const live = rows.filter((c) => c.on || have.includes(c.slug)).filter((c) => matches(needle, c.name, c.slug));
    if (!live.length) { empty(needle ? "Nothing matches." : "No connections yet. + Add connects one."); return; }
    for (const c of live) {
      const conn = conns.find((x) => x.appSlug === c.slug && x.connected !== false) ?? conns.find((x) => x.appSlug === c.slug);
      body.appendChild(row({
        icon: c.icon, name: c.name, sub: c.org ? "Your organization's" : "",
        has: have.includes(c.slug),
        onToggle: () => { sel!.connections = toggleIn(sel!.connections, c.slug); repaintBody(); },
        ...(conn && c.kind === "account" ? { onOpen: () => { connView = { kind: "perms", conn }; paint(); } } : {}),
      }));
    }
  }

  async function loadCatalog(qText: string): Promise<void> {
    catalogQ = qText;
    const r = await api().connectorsGetApps?.(qText).catch(() => null);
    if (closed || catalogQ !== qText) return;
    catalog = r?.apps ?? [];
    catalogNext = r?.next ?? "";
    catalogLoaded = true;
  }
  let catalogTimer: number | undefined;
  function paintDiscover(bodyOnly = false): void {
    if (!bodyOnly) {
      bar.append(
        backButton("Connections", () => { connView = { kind: "list" }; paint(); }),
        searchBox("discover", "Search 3,000+ apps", (v) => {
          window.clearTimeout(catalogTimer);
          catalogTimer = window.setTimeout(() => { void loadCatalog(v.trim()).then(() => { if (tab === "connections" && connView.kind === "discover") repaintBody(); }); }, 250);
        }),
      );
    }
    if (!catalogLoaded) {
      empty("Loading the directory…");
      void loadCatalog((queries.discover ?? "").trim()).then(() => { if (tab === "connections" && connView.kind === "discover") repaintBody(); });
      return;
    }
    if (!catalog.length) { empty(catalogQ ? `Nothing matching "${catalogQ}".` : "The directory is empty."); return; }
    const have = new Set(conns.filter((c) => c.connected !== false).map((c) => c.appSlug));
    for (const a of catalog) {
      const done = have.has(a.id);
      const busy = connecting.has(a.id);
      // THE DISCOVER CARD'S + (his order, 2026-10-09): + to connect, … while
      // connecting, ✓ once connected — settings-connections.ts connectAppButton.
      const b = el("button", "action-btn conn2-plus powm-connect" + (done ? " done" : ""));
      b.type = "button";
      b.innerHTML = done ? CHECK_SVG : busy ? "…" : PLUS_BTN_SVG;
      b.disabled = done || busy || !connectAllowed;
      b.title = done ? "Connected" : busy ? "Connecting…" : connectAllowed ? `Connect ${a.name}` : "Connections aren't on your plan.";
      b.setAttribute("aria-label", b.title);
      b.addEventListener("click", () => { void connect(a, b); });
      const icon = `<span class="conn2-icon powm-app-icon">${appIconInner({ iconUrl: a.icon ?? null, connection: { pipedreamSlug: a.id } }, a.name, "conn2-icon-initial")}</span>`;
      body.appendChild(row({
        icon, name: a.name, sub: a.description || "", action: b,
        ...(done ? { onOpen: () => { const c = conns.find((x) => x.appSlug === a.id && x.connected !== false); if (c) { connView = { kind: "perms", conn: c, app: a }; paint(); } } } : {}),
      }));
    }
    if (catalogNext) {
      const more = el("button", "action-btn secondary powm-more", "Show more");
      more.type = "button";
      more.addEventListener("click", async () => {
        more.disabled = true;
        const r = await api().connectorsGetApps?.(catalogQ, catalogNext).catch(() => null);
        if (closed) return;
        const seen = new Set(catalog.map((x) => x.id));
        catalog = [...catalog, ...(r?.apps ?? []).filter((x) => !seen.has(x.id))];
        catalogNext = r?.next ?? "";
        const top = body.scrollTop;
        repaintBody();
        body.scrollTop = top;
      });
      body.appendChild(more);
    }
  }

  async function reloadConnections(): Promise<void> {
    const [list, r] = await Promise.all([
      (api() as { connectionsList?: () => Promise<{ ok: boolean; connections: Conn[] }> }).connectionsList?.().catch(() => null),
      readConnectorRows(api()).catch(() => [] as PlusConnectorRow[]),
    ]);
    conns = list?.connections ?? [];
    rows = r;
  }

  /** CONNECT: the OAuth flow, then the account's permissions page here. */
  async function connect(a: CatalogApp, btn: HTMLButtonElement): Promise<void> {
    if (connecting.has(a.id) || !api().connectorsConnect) return;
    showErr("");
    connecting.add(a.id);
    btn.disabled = true;
    btn.textContent = "…";
    const before = new Set(conns.filter((c) => c.connected !== false).map((c) => c.id));
    const r = await api().connectorsConnect!(a.id).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) { connecting.delete(a.id); hideAppOverlay(); if (!closed) { showErr(r.error || "Couldn't connect."); repaintBody(); } return; }
    let fresh: Conn | undefined;
    for (let i = 0; !closed; i++) {
      await reloadConnections();
      fresh = conns.find((c) => c.appSlug === a.id && c.connected !== false && !before.has(c.id));
      if (fresh || i >= CONNECT_WAITS_MS.length) break;
      await sleep(CONNECT_WAITS_MS[i]!);
    }
    connecting.delete(a.id);
    hideAppOverlay();
    if (closed) return;
    if (!fresh) { showErr(`${a.name} hasn't shown up yet. It will be under Connections once it lands.`); repaintBody(); return; }
    // A connection made while picking for a super power is one of its powers.
    if (sel && !sel.connections.includes(a.id)) sel.connections = [...sel.connections, a.id];
    connView = { kind: "perms", conn: fresh, app: a };
    paint();
  }

  /** The connection's tools and permissions (Customize → Connections → the
   *  connection), under ‹ Connections back to the list. */
  async function paintPerms(conn: Conn, app?: CatalogApp): Promise<void> {
    bar.appendChild(backButton("Connections", () => { connView = { kind: "list" }; paint(); }));
    const name = conn.label || conn.appName || app?.name || conn.appSlug;
    const head = el("div", "conn2-phead powm-phead");
    head.innerHTML = `<span class="conn2-icon">${appIconInner({ iconUrl: app?.icon ?? null, connection: { accountId: conn.accountId, pipedreamSlug: conn.appSlug } }, name, "conn2-icon-initial")}</span><span class="conn2-phead-name">${escapeHtml(name)}</span>`;
    body.appendChild(head);
    if (app?.description) body.appendChild(el("p", "conn2-about", app.description));
    body.appendChild(el("div", "conn2-h3", "Tool permissions"));
    const sub = el("div", "conn2-muted", conn.org ? "Managed by your organization." : "Choose when your AI is allowed to use these tools.");
    sub.style.marginBottom = "10px";
    body.appendChild(sub);
    const groups = el("div", "conn2-groups");
    groups.innerHTML = `<div class="conn2-chip-muted">Loading tools…</div>`;
    body.appendChild(groups);
    const res = await api().connectionToolsList?.(conn.id).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (closed || connView.kind !== "perms" || connView.conn.id !== conn.id) return;
    if (!res?.ok) { groups.innerHTML = `<div class="conn2-chip-muted">Couldn't load tools.</div>`; if (res && "error" in res && res.error) showErr(String(res.error)); return; }
    const tools = (res as { tools?: Array<{ name: string; description?: string; hidden?: boolean }> }).tools ?? [];
    if (!tools.length) { groups.innerHTML = `<div class="conn2-chip-muted">This connection publishes no tools yet.</div>`; return; }
    await renderToolGroups(groups, {
      key: `pd:${conn.id}`, appName: conn.appSlug, tools, readOnly: !!conn.org,
      persistHidden: async (list) => { await api().connectionToolsSet?.(conn.id, list); },
    });
  }

  // ── MODELS and YOUR POWERS ──
  function paintModels(bodyOnly = false): void {
    if (!bodyOnly) bar.append(searchBox("models", "Search models", repaintBody), addButton("+ Add", null, "Adding a model here isn't built yet."));
    const needle = (queries.models ?? "").trim().toLowerCase();
    const have = sel?.models ?? [];
    const list = models.filter((m) => matches(needle, m.name, m.id));
    if (!list.length) { empty(models.length ? "Nothing matches." : "Your team's models couldn't be read."); return; }
    for (const m of list) {
      body.appendChild(row({
        icon: MODEL_SVG, name: m.name, has: have.includes(m.id),
        ...(have[0] === m.id ? { tag: "Runs on" } : {}),
        onToggle: () => { sel!.models = toggleIn(sel!.models, m.id); repaintBody(); },
      }));
    }
  }
  function paintSkills(bodyOnly = false): void {
    if (!bodyOnly) bar.append(searchBox("skills", "Search your powers", repaintBody), addButton("+ Add", null, "Making a power here isn't built yet. Ask Glyphh to make one."));
    const needle = (queries.skills ?? "").trim().toLowerCase();
    const have = sel?.skills ?? [];
    const list = skills.filter((s) => matches(needle, s.name, s.id));
    if (!list.length) { empty(skills.length ? "Nothing matches." : "No powers of your own yet. Ask Glyphh to make one."); return; }
    for (const s of list) {
      body.appendChild(row({ icon: POWER_SVG, name: s.name, sub: s.type === "task" ? "Task" : "Skill", has: have.includes(s.id), onToggle: () => { sel!.skills = toggleIn(sel!.skills, s.id); repaintBody(); } }));
    }
  }

  // ── open, then fill ──
  document.addEventListener("keydown", onKey, true);
  guardWebviewsForModal(true);
  document.body.appendChild(overlay);
  openModal = { close };
  paint();
  void (async () => {
    const [ms, sk, rc, gates] = await Promise.all([
      api().loopModels?.("glyphh").catch(() => null),
      api().skillsList?.(["skill", "task"]).catch(() => null),
      api().getWorkingDirRecents?.().catch(() => []) ?? Promise.resolve([] as string[]),
      planGates().catch(() => null),
      reloadConnections(),
    ]);
    if (closed) return;
    models = ms?.ok ? ms.models.filter((m) => !m.utility) : [];
    skills = sk?.ok && Array.isArray(sk.data) ? (sk.data as Array<{ id: string; name: string; type?: string }>) : [];
    recents = Array.isArray(rc) ? rc.map(String) : [];
    connectAllowed = (gates as { connectionsAllowed?: boolean } | null)?.connectionsAllowed !== false;
    repaintBody();
    void primeConnectedIcons(rows.filter((r) => r.prime).map((r) => ({ connection: r.prime! })), () => {
      if (closed) return;
      void readConnectorRows(api()).then((r) => { rows = r; if (tab === "connections" && connView.kind === "list") repaintBody(); }).catch(() => {});
    });
  })();
}
