import { hostHas } from "./web-surface.js";
import { DROP_PAGE, dropPager, pageSlice } from "./drop-page.js";
import { LOCUS_SVG, canWalkUp, filterPickerRows, folderGranted, machineOfSource, machinePicker, namedFolderId, namedFolderOf, onOtherDesktop, pickerRecent, type GlyphhMachine, type MachinePicker, type PickerMachine, type PickerMachineRow } from "./session-locus.js";
import { deviceRowsOf, type DevicesAnswer } from "./devices-rows.js";
import { selfMachineId } from "./devices-pick.js";
import { placeMenu, type PlaceBox } from "./menu-place.js";
/**
 * code-source-chip.ts — the WORKSPACE-SOURCE chip (ported from the platform's
 * RuntimeLocationChip), reimplemented in vanilla TS. It sits ABOVE the Code and
 * Work composers (never Chat) and picks where the next session RUNS + what it
 * WORKS ON. The trigger label reflects the current source; clicking opens a
 * drop-up with two sections:
 *
 *   CLOUD (remote runtime, the default)
 *     · Cloud                 — an empty git-init'd cloud workspace, no GitHub
 *       (sessions.create({ newProject:true }) on web).
 *     · GitHub repo  →        — a repo picker over git.repos(); not connected →
 *       a Connect-GitHub row (git.connect() OAuth URL, then poll git.status()).
 *   LOCAL (connected machines)
 *     · none →                — an install prompt (local needs an attached machine).
 *     · a machine  →          — a folder browser over the machine's FS
 *       (attach.fsList), capped at the machine root.
 *
 * TRANSPORT — this renderer is BOTH desktop Electron and app-web:
 *   · web    → window.glyphhSdk exposes .sessions / .git / .attach (the SDK
 *              handle). The cloud + remote-machine paths run against it.
 *   · desktop→ window.wb exposes local FS/git (listDir/gitInfo/pickCwd). Local
 *              folder picking runs against it; the cloud SDK resources may be
 *              absent (honest "connect on web" states then).
 * Every path degrades to an honest designed state — never a fake reply.
 *
 * The picked Source is owned by code.ts (persisted + threaded into the session
 * record + glyphhRun); this module is only the control.
 */

export type Source =
  /** `environmentId` rides on the bare workspace too, so the environment pick
   *  survives while no repo is picked yet (his report, 2026-10-05). */
  | { kind: "cloud-new"; dir?: string; environmentId?: string }
  /** `environmentId` names the member's cloud environment the session runs in
   *  (his direction, 2026-10-05: personal environments); absent = Default.
   *  `branch` is the base branch of `repo` (the first pick); `repos` is the
   *  whole selection, one base branch each (help/cloud-source.ts). */
  | { kind: "cloud-repo"; repo: string; dir?: string; environmentId?: string; branch?: string; repos?: Array<{ repo: string; branch: string }> }
  /** An EXISTING cloud workspace (his ask, 2026-08-19): `space` is the thread
   *  id that keyed the pod workspace — the run + the fs panels scope to it,
   *  so a new session re-enters the same folder. `label` is display only. */
  | { kind: "cloud-space"; space: string; label?: string; dir?: string }
  /** `machineId` is the attach socket's id, minted anew on every reconnect;
   *  `machine` is the desktop's NAME (its hostname), which is how a stale id
   *  is re-resolved before a run (his report, 2026-10-08). */
  | { kind: "local"; path: string; machineId?: string; machine?: string };

// ── SDK / bridge handles (both targets) ──────────────────────────────────
interface Repo { id: string; fullName: string; private: boolean; defaultBranch: string }
interface GitConnection { connected: boolean; login?: string | null }
interface GitConnectLink { url: string; state?: string }
interface AttachedMachine { id?: string; name?: string; app?: string; version?: string; capabilities?: string[]; /** The folders it granted for remote control. */ folders?: string[] }
interface AttachStatus { attached: boolean; machines: AttachedMachine[] }
interface FsEntry { name: string; path: string; dir: boolean; git?: boolean }
interface FsListing { path: string; parent: string | null; root?: string; entries: FsEntry[] }

interface SdkHandle {
  sessions?: { list?: () => Promise<unknown[]> };
  git?: { status?: () => Promise<GitConnection>; repos?: () => Promise<Repo[]>; connect?: () => Promise<GitConnectLink>; disconnect?: () => Promise<void> };
  attach?: { status?: () => Promise<AttachStatus>; fsList?: (path?: string, opts?: { machineId?: string }) => Promise<FsListing>; dispatch?: (method: string, params?: Record<string, unknown>, opts?: { machineId?: string }) => Promise<unknown> };
  http?: { get?: <T>(path: string) => Promise<T> };
}
interface WbHandle {
  listDir?: (dir: string) => Promise<Array<{ name: string; isDir: boolean }>>;
  gitInfo?: (root: string) => Promise<{ isRepo: boolean; branch?: string }>;
  pickCwd?: (opts?: { nullOnCancel?: boolean }) => Promise<string | null>;
  getCwdExplicit?: () => Promise<string | null>;
}

const sdk = (): SdkHandle | undefined => (window as unknown as { glyphhSdk?: SdkHandle }).glyphhSdk;
const wbh = (): WbHandle | undefined => (window as unknown as { wb?: WbHandle }).wb;
const isWeb = (): boolean =>
  !!(window as unknown as { __GLYPHH_WEB__?: boolean }).__GLYPHH_WEB__
  || (typeof document !== "undefined" && document.documentElement.classList.contains("glyphh-web"));

// ── SVG glyphs ────────────────────────────────────────────────────────────
// Exported for the web's cloud chips (help/cloud-chips.ts) — one check, one
// chevron, one row builder across every chip drop.
export const CHECK = `<svg class="drop-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
export const CHEV = `<svg class="ws-chev" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>`;
const FOLDER = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;

// ── Label ─────────────────────────────────────────────────────────────────
const lastSeg = (p: string): string => p.split("/").filter(Boolean).pop() || p;
function shortId(id?: string | null): string { return id ? String(id).replace(/^.*?-/, "").slice(0, 6) : ""; }

/** The compact label the chip shows for a source. Remote → `Fly · <id> · <folder>`,
 *  local → `Desktop · <folder>`. */
export function sourceLabel(source: Source, sessionId?: string | null, machineName?: string): string {
  if (source.kind === "local") {
    // The MACHINE'S NAME only — the folder chip beside it owns the folder.
    // Cloud labels are reserved for remote runs.
    // On web a local source exists only while attach.status listed a machine
    // (code.ts's default resolution), so this reads "My desktop" there.
    return machineName || (isWeb() ? "My desktop" : "This machine");
  }
  const folder = source.kind === "cloud-repo" && source.repo ? lastSeg(source.repo)
    : source.kind === "cloud-space" ? (source.label || `space ${shortId(source.space)}`)
    : "workspace";
  const id = shortId(sessionId);
  if (id) return `Fly · ${id} · ${folder}`;
  // Plain "Cloud" with no session yet — the repo or space, when there is one,
  // is the only thing worth qualifying it with.
  if (source.kind === "cloud-repo" && source.repo) return `Cloud · ${lastSeg(source.repo)}`;
  if (source.kind === "cloud-space") return `Cloud · ${folder}`;
  return "Cloud";
}


/**
 * Is git already enabled on this folder, and on what branch?
 *
 * ONE answer on both surfaces: the desktop asks its own FS bridge, the web
 * asks the machine over the attach relay (`fs.gitInfo`). Returns null when
 * neither transport can answer — the caller shows nothing rather than
 * guessing "no repo" at a folder it never actually checked.
 */
export async function gitStateFor(path: string): Promise<{ isRepo: boolean; branch?: string } | null> {
  if (!path) return null;
  const local = wbh()?.gitInfo;
  if (local) {
    try { return await local(path); } catch { return null; }
  }
  const dispatch = sdk()?.attach?.dispatch;
  if (!dispatch) return null;
  try {
    const r = await dispatch("fs.gitInfo", { path }) as { isRepo?: boolean; branch?: string } | null;
    return r ? { isRepo: !!r.isRepo, ...(r.branch ? { branch: r.branch } : {}) } : null;
  } catch { return null; }
}

// ── Chip factory ────────────────────────────────────────────────────────────
type ViewName = "root";

interface ChipController {
  el: HTMLElement;
  setSource: (s: Source) => void;
  setSessionId: (id: string | null) => void;
}

/** Build one source chip. `getSource`/`onPick` bridge to code.ts's owned state. */
export function createSourceChip(opts: {
  getSource: () => Source;
  onPick: (s: Source) => void;
  getSessionId: () => string | null;
}): ChipController {
  const wrap = document.createElement("div");
  wrap.className = "cl-runtime-chip-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cl-runtime-chip cl-runtime-btn";
  btn.title = "Where this session runs and what it works on";
  wrap.appendChild(btn);

  let menu: HTMLElement | null = null;
  let selectedMachine: AttachedMachine | null = null;
  let known: AttachedMachine[] = [];

  const nameFor = (s: Source): string => {
    if (s.kind !== "local") return "";
    const m = (s.machineId && known.find((k) => k.id === s.machineId)) || known.find((k) => k.name) || known[0];
    return m?.name || m?.app || "";
  };
  const paintChip = (): void => {
    const s = opts.getSource();
    const dotLive = s.kind === "local" ? "" : ` data-live="1"`;
    btn.innerHTML = `<span class="cl-runtime-dot"${dotLive}></span><span class="cl-runtime-lbl"></span>${CHEV}`;
    (btn.querySelector(".cl-runtime-lbl") as HTMLElement).textContent = sourceLabel(s, opts.getSessionId(), nameFor(s));
  };
  // The attached machines' hostnames label a local source ("chris-mbp · Home") —
  // resolved per source.machineId since several desktops can be attached.
  void listMachines().then((machines) => { known = machines; paintChip(); });

  const closeMenu = (): void => { menu?.remove(); menu = null; };

  const pick = (next: Source): void => { opts.onPick(next); paintChip(); closeMenu(); };

  const openMenu = (): void => {
    closeMenu();
    closeAllDrops();
    menu = document.createElement("div");
    menu.className = "code-drop-up ws-source-drop";
    wrap.appendChild(menu);
    showView("root");
    // Side + clamping are decided by clampDropX (edge alignment, one rule).
    clampDropUp(menu, btn);
    clampDropX(menu, btn);
  };

  const showView = (v: ViewName): void => {
    if (!menu) return;
    menu.textContent = "";
    if (v === "root") renderRoot(menu, opts, pick, (view, m) => { if (m) selectedMachine = m; showView(view); });
  };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu) { closeMenu(); return; }
    openMenu();
  });
  document.addEventListener("mousedown", (e) => {
    if (menu && !wrap.contains(e.target as Node)) closeMenu();
  }, true);

  paintChip();
  return {
    el: wrap,
    setSource: () => paintChip(),
    setSessionId: () => paintChip(),
  };
}

// ── The GIT chip (landing row, after the folder) ──────────────────────────
const BRANCH_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 8v8"/><path d="M18 10v1a4 4 0 0 1-4 4H8"/></svg>`;

/** The repo picker for a CLOUD source — the repository the remote agent checks
 *  out into the project workspace. Hidden on a local source (the passive
 *  branch mirror covers local); "Connect GitHub" when no account is linked
 *  (renderRepos carries the connect flow + poll). */
export function createGitChip(opts: {
  getSource: () => Source;
  onPick: (s: Source) => void;
}): { el: HTMLElement; refresh: () => void } {
  const wrap = document.createElement("div");
  wrap.className = "cl-runtime-chip-wrap";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cl-runtime-chip cl-runtime-btn";
  btn.title = "The GitHub repository this cloud workspace checks out";
  wrap.appendChild(btn);

  let menu: HTMLElement | null = null;
  const closeMenu = (): void => { menu?.remove(); menu = null; };

  // VISIBILITY IS THE SPACE'S CALL, not this chip's — Code shows every chip,
  // Work and Chat show no repo chip at all. Hiding itself on a local source
  // (as it used to) meant a Code session working on a machine folder had no
  // GitHub control anywhere.
  const paint = (): void => {
    const s = opts.getSource();
    const label = s.kind === "cloud-repo" && s.repo ? lastSeg(s.repo) : "Connect GitHub";
    btn.innerHTML = `${BRANCH_SVG}<span class="cl-runtime-lbl"></span>${CHEV}`;
    (btn.querySelector(".cl-runtime-lbl") as HTMLElement).textContent = label;
  };

  const pick = (next: Source): void => { opts.onPick(next); paint(); closeMenu(); };

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu) { closeMenu(); return; }
    closeAllDrops();
    menu = document.createElement("div");
    menu.className = "code-drop-up ws-source-drop";
    wrap.appendChild(menu);
    menu.classList.add("ws-drop-flex");
    renderRepos(menu, opts, pick, closeMenu);
    clampDropUp(menu, btn);
    clampDropX(menu, btn);
  });
  document.addEventListener("mousedown", (e) => {
    if (menu && !wrap.contains(e.target as Node)) closeMenu();
  }, true);

  paint();
  return { el: wrap, refresh: paint };
}

/** Open the MACHINE FOLDER BROWSER as a drop anchored to `anchor` — the folder
 *  chip's web plumbing (desktop keeps the native OS picker). Resolves the
 *  source's machine (machineId) so multi-desktop picks land on the right box. */
export function openMachineFolderBrowser(anchor: HTMLElement, opts: {
  getSource: () => Source;
  onPick: (s: Source) => void;
}): void {
  const wrap = anchor.parentElement || anchor;
  wrap.querySelector(".ws-source-drop")?.remove();
  closeAllDrops();
  const menu = document.createElement("div");
  menu.className = "code-drop-up ws-source-drop ws-drop-flex";
  (wrap as HTMLElement).style.position ||= "relative";
  wrap.appendChild(menu);
  clampDropUp(menu, anchor);
  clampDropX(menu, anchor);
  const close = (): void => menu.remove();
  const pick = (next: Source): void => { opts.onPick(next); close(); };
  void listMachines().then((machines) => {
    const s = opts.getSource();
    const mid = s.kind === "local" ? s.machineId : undefined;
    const machine = (mid && machines.find((m) => m.id === mid)) || machines[0] || null;
    renderLocal(menu, opts, machine, pick, close);
  });
  const away = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node) && e.target !== anchor) { close(); document.removeEventListener("mousedown", away, true); }
  };
  document.addEventListener("mousedown", away, true);
}

// ── THE MACHINE CHIP AND THE FOLDER CHIP (his order, 2026-10-09: "on this
//    drop down let the user pick the machine, then the folder picker is
//    another picker") ───────────────────────────────────────────────────
//
// The MACHINE chip lists machines under Local: (this desktop) and Remote:
// (the member's other attached desktops, then the Glyphh machine). The
// FOLDER chip lists the folders of the machine the session is on: anything on
// this desktop; another desktop's folders inside what it granted; the Glyphh
// machine's own folders. Both are fixed once the session has a turn (code.ts
// locks the chips; a session is bound to its machine and its folder).

/** The machines this surface can see: Local, the other attached desktops
 *  (their grants) and the Glyphh machine. Signed out or offline: fewer. */
export async function loadMachines(born: Source | null = null): Promise<MachinePicker> {
  const surface = isWeb() ? "web" : "desktop";
  const g = window as unknown as { glyphh?: { attachDevicesList?: () => Promise<DevicesAnswer>; remoteControlGet?: () => Promise<{ device?: string }>; machinesList?: () => Promise<{ machines?: Array<Record<string, unknown>> }> } };
  let desktops: PickerMachine[] = [];
  let selfId: string | null = null;
  let glyphh: GlyphhMachine[] = [];
  if (surface === "web") {
    desktops = (await listMachines()).map((m) => ({ ...(m.id ? { id: m.id } : {}), name: m.name || m.app || "Glyphh desktop", folders: m.folders ?? [] }));
    const r = await sdk()?.http?.get?.<{ machines?: Array<Record<string, unknown>> }>("/api/machines").catch(() => null);
    glyphh = glyphhMachinesOf(r?.machines);
  } else {
    const [list, status, mine] = await Promise.all([
      hostHas("attachDevicesList") ? g.glyphh!.attachDevicesList!().catch(() => null) : null,
      hostHas("remoteControlGet") ? g.glyphh!.remoteControlGet!().catch(() => null) : null,
      hostHas("machinesList") ? g.glyphh!.machinesList!().catch(() => null) : null,
    ]);
    const rows = list ? deviceRowsOf(list).devices : [];
    selfId = status?.device ? selfMachineId(rows, status.device) : null;
    desktops = rows.map((d) => ({ id: d.machineId, name: d.name, folders: d.folders }));
    glyphh = glyphhMachinesOf(mine?.machines);
  }
  const picker = machinePicker({ surface, desktops, selfId, glyphh, born });
  lastGlyphhName = picker.remote.find((r) => r.kind === "glyphh")?.name ?? lastGlyphhName;
  return picker;
}

/** The Glyphh machine's name as last read: the machine chip labels a cloud source with it. */
let lastGlyphhName = "";
/** The machine chip's words for a source: "Local", another desktop's name, the Glyphh machine's. */
export function machineChipLabel(src: Source): string {
  if (src.kind !== "local") return lastGlyphhName || "Glyphh machine";
  if (!onOtherDesktop(src)) return isWeb() ? machineLabel(src.machine || "Your desktop") : "Local";
  return machineLabel(src.machine || "Another desktop");
}

/** One drop under a chip: opened, clamped, closed on a click away. */
/** The paged drops' ceiling: a page of rows, the search, the head and the pager. */
const PAGED_DROP_MAX_PX = 440;
function chipDrop(anchor: HTMLElement): { menu: HTMLElement; close: () => void } {
  const wrap = anchor.parentElement || anchor;
  wrap.querySelector(".ws-source-drop")?.remove();
  closeAllDrops();
  const menu = document.createElement("div");
  menu.className = "code-drop-up ws-source-drop ws-drop-flex ws-locus-drop";
  (wrap as HTMLElement).style.position ||= "relative";
  wrap.appendChild(menu);
  clampDropUp(menu, anchor);
  clampDropX(menu, anchor);
  const close = (): void => { menu.remove(); document.removeEventListener("mousedown", away, true); };
  const away = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  document.addEventListener("mousedown", away, true);
  return { menu, close };
}
const dropHead = (menu: HTMLElement, title: string): void => {
  const head = document.createElement("div");
  head.className = "code-drop-head";
  const span = document.createElement("span");
  span.textContent = title;
  head.appendChild(span);
  menu.appendChild(head);
};
const secLabel = (list: HTMLElement, text: string, svg: string): void => {
  const el = document.createElement("div");
  el.className = "ws-sec-label";
  el.innerHTML = `${svg}<span></span>`;
  (el.querySelector("span") as HTMLElement).textContent = text;
  list.appendChild(el);
};
const lockRow = (row: HTMLElement, why: string | undefined): boolean => {
  if (!why) return false;
  markUnreachable(row, why);
  return true;
};
/** The folder a pick of `m` starts in: the current one when it is there, else the newest inside the grants, else the first grant. */
function startFolderOn(m: PickerMachineRow, src: Source, recents: readonly string[]): string {
  const cur = src.kind === "local" && machineOfSource({ local: null, remote: [m] }, src) === m ? src.path || "" : "";
  return pickerRecent({ surface: "web", current: cur, recents, granted: m.folders, spaces: [] }).desktop[0] ?? m.folders[0] ?? "";
}

/** THE MACHINE CHIP'S PICKER: machines only, Local: then Remote:. */
export function openMachinePicker(anchor: HTMLElement, opts: {
  getSource: () => Source;
  onPick: (s: Source) => void;
  /** The member's recently used desktop folders, newest first (the web's, from its sessions). */
  recentFolders?: () => readonly string[];
}): void {
  const { menu, close } = chipDrop(anchor);
  const pick = (next: Source): void => { opts.onPick(next); close(); };
  const src = opts.getSource();
  dropHead(menu, "Where this session runs");
  const list = document.createElement("div");
  list.className = "ws-locus-list";
  menu.appendChild(list);
  list.insertAdjacentHTML("beforeend", `<div class="drop-empty">Checking your machines…</div>`);
  void (async () => {
    const [model, reach] = await Promise.all([loadMachines(), probeSources()]);
    const w = wbh() as (WbHandle & { getCwdRecents?: () => Promise<string[]> }) | undefined;
    const localRecents = model.local ? (await w?.getCwdRecents?.().catch(() => [] as string[])) ?? [] : [];
    if (!menu.isConnected) return;
    list.textContent = "";
    const here = machineOfSource(model, src);
    const row = (m: PickerMachineRow, onClick: () => void, why?: string): void => {
      const sel = here === m;
      const r = drillItem(machineLabel(m.name), m.hint, sel ? CHECK : "");
      if (sel) r.classList.add("selected");
      if (!lockRow(r, why)) r.addEventListener("click", () => { if (sel) close(); else onClick(); });
      list.appendChild(r);
    };
    if (model.local) {
      secLabel(list, "Local:", LOCUS_SVG.local);
      row({ ...model.local, name: "This desktop" }, () => pick({ kind: "local", path: localRecents[0] ?? "" }));
    }
    // The machines can be many: one page of them, the session's own page first.
    const at = Math.max(0, model.remote.findIndex((m) => m === here));
    let page = Math.floor(at / DROP_PAGE);
    const remoteAt = list.childElementCount;
    const paintRemote = (): void => {
      while (list.childElementCount > remoteAt) list.lastElementChild!.remove();
      menu.querySelector(".drop-pager")?.remove();
      secLabel(list, "Remote:", LOCUS_SVG.cloud);
      const shown = pageSlice(model.remote, page);
      page = shown.page;
      for (const m of shown.items) {
        if (m.kind === "glyphh") {
          row(m, () => pick({ kind: "cloud-new" }), reach.cloud === false ? (reach.cloudWhy || "Can't reach the Glyphh machine right now") : undefined);
        } else {
          row(m, () => pick({ kind: "local", path: startFolderOn(m, src, opts.recentFolders?.() ?? []), ...(m.id ? { machineId: m.id } : {}), machine: m.name }), m.empty);
        }
      }
      const pager = dropPager(page, shown.pages, (p) => { page = p; paintRemote(); });
      if (pager) menu.appendChild(pager);
    };
    paintRemote();
    clampDropUp(menu, anchor, PAGED_DROP_MAX_PX);
    clampDropX(menu, anchor);
  })();
}

/** THE FOLDER CHIP'S PICKER, ONE FLOW ON EVERY MACHINE (his order,
 *  2026-10-09): the machine's folders, searchable, then New folder…. On this
 *  desktop New folder… is the file chooser; on another desktop or the Glyphh
 *  machine it steps (→) to a name field in this same drop, and a made folder
 *  comes back to the list, picked ("not another odd modal"). */
export function openFolderPicker(anchor: HTMLElement, opts: {
  getSource: () => Source;
  onPick: (s: Source) => void;
  recentFolders?: () => readonly string[];
}): void {
  const { menu, close } = chipDrop(anchor);
  const pick = (next: Source): void => { opts.onPick(next); close(); };
  menu.insertAdjacentHTML("beforeend", `<div class="drop-empty">Checking its folders…</div>`);

  interface Row { main: string; hint: string; sel: boolean; go: () => void }
  interface Fresh { hint: string; step: boolean; go: () => void }
  /** The list view: the folders, then New folder…, the same on every machine. */
  const paint = (title: string, rows: Row[], fresh: Fresh): void => {
    menu.textContent = "";
    dropHead(menu, title);
    const search = document.createElement("input");
    search.type = "text";
    search.className = "loop-drop-search repo-drop-search ws-locus-search";
    search.placeholder = "Search folders…";
    search.spellcheck = false;
    search.autocomplete = "off";
    search.addEventListener("mousedown", (ev) => ev.stopPropagation());
    menu.appendChild(search);
    const list = document.createElement("div");
    list.className = "ws-locus-list";
    menu.appendChild(list);
    // The folders can be many: one page at a time; a search pages its matches.
    let page = Math.floor(Math.max(0, rows.findIndex((r) => r.sel)) / DROP_PAGE);
    const draw = (): void => {
      list.textContent = "";
      menu.querySelector(".drop-pager")?.remove();
      const q = search.value.trim().toLowerCase();
      const matched = q ? rows.filter((r) => `${r.main} ${r.hint}`.toLowerCase().includes(q)) : rows;
      const paged = pageSlice(matched, page);
      page = paged.page;
      const shown = paged.items;
      for (const r of shown) {
        const b = drillItem(r.main, r.hint, r.sel ? CHECK : "");
        b.classList.add("ws-fs-row");
        if (r.sel) b.classList.add("selected");
        b.addEventListener("click", r.go);
        list.appendChild(b);
      }
      if (q && !shown.length) list.insertAdjacentHTML("beforeend", `<div class="drop-empty">No folder matches.</div>`);
      if (!q) {
        const b = drillItem("New folder…", fresh.hint, fresh.step ? CHEV : "");
        b.addEventListener("click", fresh.go);
        list.appendChild(b);
      }
      const pager = dropPager(page, paged.pages, (p) => { page = p; draw(); });
      if (pager) menu.appendChild(pager);
    };
    search.addEventListener("input", () => { page = 0; draw(); });
    draw();
    clampDropUp(menu, anchor, PAGED_DROP_MAX_PX);
    clampDropX(menu, anchor);
    requestAnimationFrame(() => search.focus());
  };

  /** The name step: ‹ back to the list; Create makes it, picks it and shows the list again. */
  const paintName = (label: string, make: (name: string) => Promise<Source>): void => {
    menu.textContent = "";
    backHead(menu, `New folder on ${label}`, () => { void render(); });
    const row = document.createElement("div");
    row.className = "ws-fs-newfolder";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "loop-drop-search repo-drop-search";
    input.placeholder = "Folder name";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.addEventListener("mousedown", (ev) => ev.stopPropagation());
    const create = document.createElement("button");
    create.type = "button";
    create.className = "action-btn primary";
    create.textContent = "Create";
    row.append(input, create);
    const err = document.createElement("div");
    err.className = "ws-fs-newfolder-err";
    menu.append(row, err);
    const go = async (): Promise<void> => {
      const name = input.value.trim();
      if (!name || create.disabled) return;
      create.disabled = true;
      err.textContent = "";
      try {
        opts.onPick(await make(name));
        void render();
      } catch (e) {
        create.disabled = false;
        err.textContent = `Couldn't make it: ${e instanceof Error ? e.message : String(e)}`;
      }
    };
    create.addEventListener("click", () => { void go(); });
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void go(); });
    clampDropUp(menu, anchor);
    clampDropX(menu, anchor);
    requestAnimationFrame(() => input.focus());
  };

  /** The list for the session's machine, read fresh (a made folder shows, picked). */
  const render = async (): Promise<void> => {
    const src = opts.getSource();
    const currentFolder = src.kind === "local" ? src.path || "" : "";
    const currentSpace = src.kind === "cloud-space" ? src.space : "";
    const model = await loadMachines();
    if (!menu.isConnected) return;
    const here = machineOfSource(model, src);

    // ── this desktop: its recent folders; New folder… is the file chooser ──
    if (here?.kind === "local") {
      const w = wbh() as (WbHandle & { getCwdRecents?: () => Promise<string[]> }) | undefined;
      const recents = (await w?.getCwdRecents?.().catch(() => [] as string[])) ?? [];
      if (!menu.isConnected) return;
      const dirs = pickerRecent({ surface: "desktop", current: currentFolder, recents, granted: [], spaces: [] }).desktop;
      paint("Folder on this desktop", dirs.map((d) => ({ main: lastSeg(d), hint: d, sel: d === currentFolder, go: () => pick({ kind: "local", path: d }) })),
        { hint: "Choose or make any folder on this computer", step: false, go: () => { void w?.pickCwd?.({ nullOnCancel: true }).then((d) => { if (d) pick({ kind: "local", path: d }); }); } });
      return;
    }

    // ── the Glyphh machine: its folders; New folder… names one ──
    if (here?.kind === "glyphh") {
      const spaces = await listSpaces();
      if (!menu.isConnected) return;
      const titleFor = (window as unknown as { __glyphhSessionTitleFor?: (id: string) => string }).__glyphhSessionTitleFor;
      const labelOf = (sp: { id: string; top: readonly string[] }): string =>
        namedFolderOf(sp.id) || (titleFor?.(sp.id) || "").trim() || (sp.top.length ? sp.top.join(" · ") : `folder ${shortId(sp.id)}`);
      const listed = spaces.map((sp) => ({ id: sp.id, label: labelOf(sp), updatedAt: sp.updatedAt }));
      // A folder just named exists from its first send: listed (and picked) until then.
      if (currentSpace && !listed.some((sp) => sp.id === currentSpace)) {
        listed.unshift({ id: currentSpace, label: (src.kind === "cloud-space" && src.label) || namedFolderOf(currentSpace) || currentSpace, updatedAt: 0 });
      }
      const rows = pickerRecent({ surface: "web", current: "", recents: [], granted: [], spaces: listed, ...(currentSpace ? { currentSpace } : {}) }).cloud;
      paint(`Folder on ${here.name}`, rows.map((c) => ({
        main: c.label, hint: c.updatedAt ? `Used ${new Date(c.updatedAt).toLocaleDateString()}` : "New", sel: c.id === currentSpace,
        go: () => pick({ kind: "cloud-space", space: c.id, label: c.label }),
      })), {
        hint: `Name a new folder on ${here.name}`, step: true,
        go: () => paintName(here.name, async (name) => {
          const id = namedFolderId(name);
          if (!id) throw new Error("use letters, numbers, - or _");
          return { kind: "cloud-space", space: id, label: name };
        }),
      });
      return;
    }

    // ── another desktop: its folders inside the grants; New folder… names one there ──
    if (here) {
      const label = machineLabel(here.name);
      if (here.empty) {
        menu.textContent = "";
        const note = drillItem("No folder granted", here.empty, "");
        markUnreachable(note, here.empty);
        menu.appendChild(note);
        return;
      }
      const at = (dir: string): Source => ({ kind: "local", path: dir, ...(here.id ? { machineId: here.id } : {}), machine: here.name });
      const recents = pickerRecent({ surface: "web", current: currentFolder, recents: opts.recentFolders?.() ?? [], granted: here.folders, spaces: [] }).desktop;
      const dirs = [...recents, ...here.folders.filter((g) => !recents.includes(g))];
      paint(`Folder on ${label}`, dirs.map((d) => ({ main: lastSeg(d), hint: d, sel: d === currentFolder, go: () => pick(at(d)) })), {
        hint: `Name a new folder on ${label}`, step: true,
        go: () => paintName(label, async (name) => {
          // Inside a grant: the current folder when it is in one, else the first grant.
          const parent = currentFolder && folderGranted(currentFolder, here.folders) ? currentFolder : here.folders[0]!;
          return at(await mkdirOn(here.id ?? "", parent, name));
        }),
      });
      return;
    }

    // The session's desktop is not attached now: say so, never another machine's folders.
    menu.textContent = "";
    const name = src.kind === "local" ? machineLabel(src.machine || "That desktop") : "That machine";
    const note = drillItem(`${name} is not attached`, "Open Glyphh there with remote control on, then pick its folder.", "");
    markUnreachable(note, `${name} is not attached right now`);
    menu.appendChild(note);
  };
  void render();
}

/** Make `name` inside `parent` on another desktop, over the relay; answers its path. */
async function mkdirOn(machineId: string, parent: string, name: string): Promise<string> {
  const g = window as unknown as { glyphh?: { attachFsMkdir?: (p: string, n: string, id: string) => Promise<{ path?: string }> } };
  const made = !isWeb() && hostHas("attachFsMkdir")
    ? await g.glyphh!.attachFsMkdir!(parent, name, machineId)
    : await (sdk()?.attach?.dispatch?.("fs.mkdir", { path: parent, name }, machineId ? { machineId } : {}) ?? Promise.reject(new Error("no desktop attached"))) as { path?: string };
  if (!made?.path) throw new Error("the desktop did not make it");
  return made.path;
}

/** A machine as people read it: a desktop's hostname without ".local". */
const machineLabel = (name: string): string => name.replace(/\.local$/i, "") || name;

/** The member's Glyphh machines as GET /api/machines answers them. */
function glyphhMachinesOf(raw: Array<Record<string, unknown>> | undefined): GlyphhMachine[] {
  return (Array.isArray(raw) ? raw : [])
    .map((m) => ({ id: String(m.id ?? ""), name: String(m.name ?? ""), state: String(m.state ?? ""), default: m.default === true }))
    .filter((m) => !!m.id);
}

/** The CLOUD workspace folder browser (his ask, 2026-08-20): the folder chip
 *  on a cloud source browses the POD workspace and picks a folder INSIDE it —
 *  the run's `subdir`. Needs a scope (an existing space, or a born session's
 *  thread); a cloud-new/repo source with no workspace yet gets the honest
 *  "appears after the first message" note. */
export function openCloudFolderBrowser(anchor: HTMLElement, opts: {
  scope: string | null;
  currentDir?: string;
  onPickDir: (relDir: string) => void;
}): void {
  const wrap = anchor.parentElement || anchor;
  wrap.querySelector(".ws-source-drop")?.remove();
  closeAllDrops();
  const menu = document.createElement("div");
  menu.className = "code-drop-up ws-source-drop ws-drop-flex";
  (wrap as HTMLElement).style.position ||= "relative";
  wrap.appendChild(menu);
  clampDropUp(menu, anchor);
  clampDropX(menu, anchor);
  const close = (): void => menu.remove();
  const away = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node) && e.target !== anchor) { close(); document.removeEventListener("mousedown", away, true); }
  };
  document.addEventListener("mousedown", away, true);

  menu.insertAdjacentHTML("beforeend", `<div class="code-drop-head"><span>Cloud workspace folder</span></div>`);
  const body = document.createElement("div");
  body.className = "ws-drop-body";
  menu.appendChild(body);

  if (!opts.scope) {
    body.insertAdjacentHTML("beforeend",
      `<div class="ws-note"><div class="ws-note-title">No workspace yet</div><div class="ws-note-body">This session's cloud workspace appears after its first message — send once, then pick a folder here.</div></div>`);
    return;
  }
  body.insertAdjacentHTML("beforeend", `<div class="drop-empty">Loading the workspace…</div>`);

  const browse = async (dir?: string): Promise<{ root: string; path: string; entries: Array<{ name: string; path: string; kind: string }> } | null> => {
    try {
      if (isWeb()) {
        const h = (sdk() as { harnessViaApi?: () => { fsInfo: (o: { scope?: string }) => Promise<{ root: string }>; fsList: (o: { dir?: string; scope?: string }) => Promise<{ entries: Array<{ name: string; path: string; kind: string }> }> } })?.harnessViaApi;
        if (!h) return null;
        const hc = h();
        const info = await hc.fsInfo({ scope: opts.scope! });
        const path = dir || info.root;
        const r = await hc.fsList({ dir: path, scope: opts.scope! });
        return { root: info.root, path, entries: (r.entries ?? []).filter((e) => e.kind === "dir") };
      }
      const g = (window as unknown as { glyphh?: { cloudFsBrowse?: (scope: string, dir?: string) => Promise<{ root: string; path: string; entries: Array<{ name: string; path: string; kind: string }> } | null> } }).glyphh;
      if (typeof g?.cloudFsBrowse !== "function") return null;
      return await g.cloudFsBrowse(opts.scope!, dir);
    } catch { return null; }
  };

  const paint = (root: string, path: string, entries: Array<{ name: string; path: string }>): void => {
    body.textContent = "";
    const rel = path === root ? "" : path.startsWith(root) ? path.slice(root.length).replace(/^\/+/, "") : path;
    const pathEl = document.createElement("div");
    pathEl.className = "ws-path";
    pathEl.title = path;
    pathEl.textContent = rel ? `workspace/${rel}` : "workspace";
    body.appendChild(pathEl);
    const list = document.createElement("div");
    list.className = "code-repo-drop-list ws-fs-list";
    body.appendChild(list);
    if (rel) {
      const up = drillItem("‹ up", "", "");
      up.classList.add("ws-fs-up");
      const parent = path.replace(/\/[^/]+\/?$/, "");
      up.addEventListener("click", () => { void walk(parent.length >= root.length ? parent : root); });
      list.appendChild(up);
    }
    for (const e of entries) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "code-drop-item ws-fs-row";
      row.innerHTML = `${FOLDER}<span class="drop-lines"><span></span></span>`;
      (row.querySelector(".drop-lines span") as HTMLElement).textContent = e.name;
      row.addEventListener("click", () => { void walk(e.path); });
      list.appendChild(row);
    }
    if (!entries.length) list.insertAdjacentHTML("beforeend", `<div class="drop-empty">No sub-folders here.</div>`);
    const use = document.createElement("button");
    use.type = "button";
    use.className = "action-btn primary ws-use-folder";
    use.textContent = rel ? `Use “${rel.split("/").pop()}”` : "Use the workspace root";
    use.addEventListener("click", () => { opts.onPickDir(rel); close(); });
    body.appendChild(use);
  };

  const walk = async (dir?: string): Promise<void> => {
    const r = await browse(dir);
    if (!r) {
      body.textContent = "";
      body.insertAdjacentHTML("beforeend",
        `<div class="ws-note"><div class="ws-note-title">Can't reach the workspace</div><div class="ws-note-body">The cloud runtime didn't answer — try again in a moment.</div></div>`);
      return;
    }
    paint(r.root, r.path, r.entries);
  };
  void walk(opts.currentDir ? undefined : undefined).then(() => { /* first paint at root */ });
}

/** ONE picker at a time, anywhere: hide the composer pops, remove the
 *  source-family drops — every opener calls this before showing its own. */
export function closeAllDrops(except?: HTMLElement | null): void {
  document.querySelectorAll<HTMLElement>(".code-drop-up").forEach((m) => {
    if (except && (m === except || m.contains(except))) return;
    if (m.classList.contains("ws-source-drop")) m.remove();
    else m.classList.add("hidden");
  });
}

/** A drop-UP must fit the space ABOVE its anchor — unclamped it runs past the
 *  top of the page. */
/** The box a drop actually has to live in: the intersection of every CLIPPING
 *  ancestor, not the viewport. A chip on the landing sits inside a card whose
 *  top edge is far below y=0, so measuring against the window let a drop-up
 *  run straight off the top of that card. */
function clipBoxFor(anchor: HTMLElement): { top: number; bottom: number; left: number; right: number } {
  let top = 0;
  let bottom = window.innerHeight;
  let left = 0;
  let right = window.innerWidth;
  for (let p = anchor.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/hidden|clip|auto|scroll/.test(s.overflow + s.overflowX + s.overflowY)) {
      const r = p.getBoundingClientRect();
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
      left = Math.max(left, r.left);
      right = Math.min(right, r.right);
    }
  }
  return { top, bottom, left, right };
}

/** The clip box as the placement box menu-place.ts reads. */
function placeBoxFor(anchor: HTMLElement): PlaceBox {
  const c = clipBoxFor(anchor);
  return { left: c.left, top: c.top, width: Math.max(0, c.right - c.left), height: Math.max(0, c.bottom - c.top) };
}

/**
 * Hang a drop from its chip and keep it inside its clip box — ONE rule
 * (menu-place.ts placeMenu), shared with the recents dropdown and the filter
 * menu. The chip's edge that faces the middle of its row is the preferred
 * edge (chips on the left hang left-to-left, chips on the right hang
 * right-to-right); when that runs off the box the menu FLIPS to the other
 * edge, and when neither fits it is clamped and its width capped. A chip
 * drop is a drop-UP and never flips below (it would cover the input): it
 * caps its height to the room above and scrolls.
 */
export function clampDropX(menu: HTMLElement, anchor: HTMLElement): void {
  const a = anchor.getBoundingClientRect();
  const wrap = (anchor.parentElement || anchor).getBoundingClientRect();
  const row = anchor.closest<HTMLElement>(".code-composer-bar, .dash-wd-chips, .code-source-slot, .code-chips");
  const rowRect = row?.getBoundingClientRect();
  const onRight = !!rowRect && a.left + a.width / 2 > rowRect.left + rowRect.width / 2;
  const m = menu.getBoundingClientRect();
  const p = placeMenu(
    { left: a.left, top: a.top, width: a.width, height: a.height },
    { width: m.width, height: m.height },
    placeBoxFor(anchor),
    { align: onRight ? "right" : "left", side: "above", gap: 8 },
  );
  // The drop is absolutely positioned inside its wrap: viewport → wrap coordinates.
  menu.style.right = "auto";
  menu.style.left = `${Math.round(p.left - wrap.left)}px`;
  menu.style.maxWidth = `${p.maxWidth}px`;
}

/** The tallest any chip drop may be — the folder picker's height. Every drop
 *  shares it so the source menu can never out-grow the files menu and spill
 *  past the top of the surface it opens in. */
const DROP_MAX_PX = 320;

/** Size a drop-UP to the room ABOVE its chip (never below — a menu that
 *  drops down covers the input the user is about to type in). When the room
 *  is short the menu gets short and SCROLLS; it never overflows. */
export function clampDropUp(menu: HTMLElement, anchor: HTMLElement, maxPx: number = DROP_MAX_PX): void {
  const a = anchor.getBoundingClientRect();
  const p = placeMenu(
    { left: a.left, top: a.top, width: a.width, height: a.height },
    { width: menu.offsetWidth, height: maxPx },
    placeBoxFor(anchor),
    { side: "above", gap: 8 },
  );
  menu.style.bottom = "";
  menu.style.top = "";
  menu.style.maxHeight = `${Math.min(maxPx, p.maxHeight)}px`;
  menu.style.overflowY = "auto";
}


// ── Root view: CLOUD + LOCAL sections ────────────────────────────────────

// ── Reachability ──────────────────────────────────────────────────────────
//
// A session has to START by connecting somewhere. An option you cannot reach
// is not a choice — offering it just moves the failure to the first send, so
// each one is probed and DISABLED with the reason when it is down.

/** `null` = NOT YET KNOWN (the transport isn't up), which is different from
 *  `false` = tried and failed. Conflating them made a still-booting bridge
 *  read as "Cloud unavailable". */
export interface SourceReach {
  local: boolean | null;
  cloud: boolean | null;
  /** Why the cloud is down, when it is — the failure's own words, so a
   *  greyed row can say more than "can't reach". */
  cloudWhy?: string;
}
let reachCache: { at: number; value: SourceReach } | null = null;
const REACH_TTL_MS = 15_000;

/** Did the server ANSWER? An HTTP status — 401, 403, 404, 500, anything —
 *  means we reached it. Only a transport-level failure (DNS, refused,
 *  offline, CORS) means unreachable. Treating an expired token as "the cloud
 *  is down" told the user to switch runtimes when all they needed was a
 *  refresh.
 *
 *  THE SDK'S OWN ERROR (core/errors.ts ApiError) carries the status as
 *  `httpStatus` — this read `status`/`statusCode` only, so every answered
 *  request the SDK made looked like an outage (his report, 2026-10-04: the
 *  cloud rows all greyed out on the web). */
function answered(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; httpStatus?: number; response?: { status?: number }; message?: string };
  if (typeof e?.status === "number" || typeof e?.statusCode === "number" || typeof e?.httpStatus === "number") return true;
  if (typeof e?.response?.status === "number") return true;
  return /\b(4\d{2}|5\d{2})\b/.test(String(e?.message ?? ""));
}
const errorText = (err: unknown): string => {
  const m = (err as { message?: unknown })?.message;
  return typeof m === "string" && m.trim() ? m.trim() : String(err ?? "no answer");
};

/** Can we reach an attached machine? Web asks the relay; on the desktop the
 *  machine is this process, so the only question is whether it can list. */
async function probeLocal(): Promise<boolean | null> {
  if (!isWeb()) return !!wbh()?.listDir;
  // Call it ON its resource — `const f = sdk().attach.status; f()` detaches the
  // method and the SDK reaches for `this.http`, which throws a TypeError that
  // looks exactly like an outage. Third time this bug has bitten today.
  const attach = sdk()?.attach;
  if (!attach?.status) return null;   // SDK bridge not up yet
  // Only a SUCCESSFUL status call can say whether a machine is attached.
  // `attached: false` is a real answer; a thrown error is not — a 401 or a
  // dropped connection tells us nothing about the user's desktop, so it stays
  // UNKNOWN rather than accusing a machine that may be sitting right there.
  try { return !!(await attach.status())?.attached; } catch { return null; }
}

/**
 * Can we reach the cloud runtime surface?
 *
 * On WEB the probe is THE CALL THE CLOUD ROWS ARE MADE OF: the harness front
 * door's `fsSpaces` (GET /api/harness/fs/spaces — the member's cloud folders).
 * It used to be `sessions.list()` (GET /api/sessions), a control-plane route
 * the server no longer serves: its 404 carried no `status` field this code
 * read, so the cloud read as DOWN on every web open and every cloud row
 * greyed out (his report, 2026-10-04). Reaching the front door — any HTTP
 * answer — is reachable; only a transport failure is not. The probe goes
 * through the SDK handle and nothing else: `window.glyphh` on web is a Proxy
 * that fabricates a function for ANY name, so a desktop-style fallback looks
 * present, gets called, and fails.
 *
 * On the DESKTOP main's thread list is the cheapest authenticated call that
 * proves the same path (auth + control plane).
 */
async function probeCloud(): Promise<{ ok: boolean | null; why?: string }> {
  if (isWeb()) {
    const h = (sdk() as { harnessViaApi?: () => { fsSpaces: () => Promise<unknown> } } | undefined)?.harnessViaApi;
    if (typeof h !== "function") return { ok: null };   // bridge not up yet — unknown, not down
    try { await h().fsSpaces(); return { ok: true }; }
    catch (err) { return answered(err) ? { ok: true } : { ok: false, why: `Can't reach the cloud runtime right now (${errorText(err)})` }; }
  }
  const g = (window as unknown as { glyphh?: { threadsList?: () => Promise<unknown> } }).glyphh;
  if (typeof g?.threadsList !== "function") return { ok: null };
  try { await g.threadsList(); return { ok: true }; }
  catch (err) { return answered(err) ? { ok: true } : { ok: false, why: `Can't reach the cloud runtime right now (${errorText(err)})` }; }
}

/** Probe both, cached briefly so opening the menu twice is not two round trips.
 *  An UNKNOWN result is never cached — the next paint asks again. */
export async function probeSources(force = false): Promise<SourceReach> {
  if (!force && reachCache && Date.now() - reachCache.at < REACH_TTL_MS) return reachCache.value;
  if (force) reachCache = null;
  const [local, cloud] = await Promise.all([probeLocal(), probeCloud()]);
  const value: SourceReach = { local, cloud: cloud.ok, ...(cloud.why ? { cloudWhy: cloud.why } : {}) };
  if (local !== null && cloud.ok !== null) reachCache = { at: Date.now(), value };
  return value;
}
/** Mark a row unreachable: not clickable, and it says why. */
export function markUnreachable(row: HTMLElement, why: string): void {
  row.classList.add("ws-unreachable");
  row.setAttribute("aria-disabled", "true");
  row.setAttribute("title", why);
  const sub = row.querySelector<HTMLElement>(".drop-lines span:last-child");
  if (sub) sub.textContent = why;
}

function renderRoot(
  menu: HTMLElement,
  opts: { getSource: () => Source },
  pick: (s: Source) => void,
  onView: (v: ViewName, m?: AttachedMachine) => void,
): void {
  const s = opts.getSource();
  const isNew = s.kind === "cloud-new";
  const isRepo = s.kind === "cloud-repo";
  const isLocal = s.kind === "local";

  menu.insertAdjacentHTML("beforeend", `<div class="code-drop-head"><span>Workspace source</span></div>`);
  menu.insertAdjacentHTML("beforeend", `<div class="ws-sec-label">Cloud runtime</div>`);

  // The cloud runtime itself — the chip's label and this row read the same.
  const np = drillItem("Cloud", "Git-init'd in the cloud — no GitHub needed", isNew ? CHECK : "");
  np.addEventListener("click", () => { if (!np.classList.contains("ws-unreachable")) pick({ kind: "cloud-new" }); });
  menu.appendChild(np);
  void probeSources().then((reach) => {
    if (reach.cloud === false) markUnreachable(np, reach.cloudWhy || "Can't reach the cloud runtime right now");
  });

  // ── Your existing cloud SPACES — pick one to open a session back INSIDE
  // that workspace. Labeled by the session that made it when we still have
  // it, else by what's in the folder (an orphaned space stays reachable).
  const spacesHost = document.createElement("div");
  menu.appendChild(spacesHost);
  void listSpaces().then((spaces) => {
    if (!spaces.length) return;
    spacesHost.insertAdjacentHTML("beforeend", `<div class="ws-sec-label">Your spaces</div>`);
    const titleFor = (window as unknown as { __glyphhSessionTitleFor?: (id: string) => string }).__glyphhSessionTitleFor;
    for (const sp of spaces.slice(0, 8)) {
      const label = (titleFor?.(sp.id) || "").trim() || (sp.top.length ? sp.top.join(" · ") : `space ${shortId(sp.id)}`);
      const when = sp.updatedAt ? new Date(sp.updatedAt).toLocaleDateString() : "";
      const sel = s.kind === "cloud-space" && s.space === sp.id;
      const row = drillItem(label, when ? `Cloud workspace · ${when}` : "Cloud workspace", sel ? CHECK : "");
      if (sel) row.classList.add("selected");
      row.addEventListener("click", () => pick({ kind: "cloud-space", space: sp.id, label }));
      spacesHost.appendChild(row);
    }
  }).catch(() => { /* runtime unreachable — the section simply doesn't render */ });

  menu.insertAdjacentHTML("beforeend", `<div class="ws-sec-label">Connected machines</div>`);
  const machinesHost = document.createElement("div");
  machinesHost.insertAdjacentHTML("beforeend", `<div class="drop-empty">Checking your machines…</div>`);
  menu.appendChild(machinesHost);

  void listMachines().then((machines) => {
    machinesHost.textContent = "";
    if (!machines.length) {
      const install = drillItem("No machines connected", "Open the Glyphh desktop to run in a folder on the machine", "");
      install.classList.add("ws-install");
      // On desktop the app IS the machine — offer the local folder picker directly.
      if (!isWeb() && wbh()?.pickCwd) {
        install.addEventListener("click", () => {
          void wbh()!.pickCwd!({ nullOnCancel: true }).then((dir) => { if (dir) pick({ kind: "local", path: dir }); });
        });
      }
      machinesHost.appendChild(install);
      return;
    }
    void probeSources().then((reach) => {
      if (reach.local !== false) return;
      machinesHost.querySelectorAll<HTMLElement>(".code-drop-item")
        .forEach((row) => markUnreachable(row, "This machine isn't connected right now"));
    });
    machines.forEach((m) => {
      const name = m.name || m.app || "Glyphh desktop";
      const selected = isLocal && (s.machineId === m.id || s.machineId === undefined);
      // The source chip picks WHERE only — the folder chip beside it owns the
      // folder (no browsing in here). Picking a machine keeps a folder already
      // chosen on it; otherwise the session runs from Home.
      const row = drillItem(name, "Runs sessions on this machine", selected ? CHECK : "");
      if (selected) row.classList.add("selected");
      row.addEventListener("click", () => {
        const keep = isLocal && s.machineId === m.id && s.path ? s.path : "";
        pick({ kind: "local", path: keep, ...(m.id ? { machineId: m.id } : {}) });
      });
      machinesHost.appendChild(row);
    });
  });
}

/** The caller's existing cloud workspaces. Web reaches the SDK's harness
 *  surface directly; desktop asks the main process (cloud-spaces-list). */
async function listSpaces(): Promise<Array<{ id: string; updatedAt: number; top: string[] }>> {
  try {
    if (isWeb()) {
      const h = (sdk() as { harnessViaApi?: () => { fsSpaces: () => Promise<{ spaces: Array<{ id: string; updatedAt: number; top: string[] }> }> } })?.harnessViaApi;
      if (!h) return [];
      return (await h().fsSpaces()).spaces ?? [];
    }
    const g = (window as unknown as { glyphh?: { cloudSpacesList?: () => Promise<{ spaces?: Array<{ id: string; updatedAt: number; top: string[] }> }> } }).glyphh;
    if (typeof g?.cloudSpacesList !== "function") return [];
    return (await g.cloudSpacesList())?.spaces ?? [];
  } catch { return []; }
}

/** Connected machines: the SDK attach surface (web), or the local desktop
 *  itself (desktop, synthesized from wb). */
async function listMachines(): Promise<AttachedMachine[]> {
  const s = sdk();
  if (s?.attach?.status) {
    try { const st = await s.attach.status(); return st?.attached && Array.isArray(st.machines) ? st.machines : []; }
    catch { return []; }
  }
  // Desktop with no SDK attach: the running machine IS the local one.
  if (!isWeb() && wbh()?.pickCwd) return [{ id: "local", name: "This machine", capabilities: [] }];
  return [];
}

/** The DESKTOP's git bridge (preload IPC) — the renderer has no SDK handle
 *  there. Present ⇒ the picker runs on it and a pick CLONES into the local
 *  folder ("create from git locally", his spec 2026-08-27). */
type DesktopGit = {
  gitStatus?: () => Promise<{ ok: boolean; status?: { connected: boolean }; error?: string }>;
  gitRepos?: () => Promise<{ ok: boolean; repos?: Repo[]; error?: string }>;
  gitConnect?: () => Promise<{ ok: boolean; error?: string }>;
  gitCloneInto?: (repo: string, dir: string) => Promise<{ ok: boolean; error?: string }>;
};
const desktopGit = (): DesktopGit | null => {
  // hostHas, not typeof: the web bridge fabricates a function for any name.
  if (!hostHas("gitCloneInto")) return null;
  return (window as unknown as { glyphh?: DesktopGit }).glyphh ?? null;
};

// ── Cloud → GitHub repo picker ───────────────────────────────────────────
function renderRepos(
  menu: HTMLElement,
  opts: { getSource: () => Source },
  pick: (s: Source) => void,
  onBack: () => void,
): void {
  backHead(menu, "GitHub repo", onBack);
  const body = document.createElement("div");
  menu.appendChild(body);
  body.insertAdjacentHTML("beforeend", `<div class="drop-empty">Loading…</div>`);

  const s = sdk();
  const dg = s?.git?.status ? null : desktopGit();
  if (!s?.git?.status && !dg) {
    body.textContent = "";
    body.insertAdjacentHTML("beforeend",
      `<div class="ws-note"><div class="ws-note-title">GitHub needs an update</div><div class="ws-note-body">This build can't reach GitHub yet — update the Glyphh desktop app.</div></div>`);
    return;
  }

  const current = opts.getSource().kind === "cloud-repo" ? (opts.getSource() as { repo: string }).repo : "";
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const paintRepos = (repos: Repo[]): void => {
    body.textContent = "";
    const list = document.createElement("div");
    list.className = "code-repo-drop-list";
    // Search is ALWAYS present (not just past 8 repos) and stays pinned while
    // the LIST scrolls beneath it.
    const search = document.createElement("input");
    search.type = "text";
    search.className = "loop-drop-search repo-drop-search";
    search.placeholder = "Search repositories…";
    search.spellcheck = false;
    search.autocomplete = "off";
    search.addEventListener("mousedown", (ev) => ev.stopPropagation());
    // Search at the TOP, like every other popup (his call, 2026-08-27 —
    // replacing the bottom seat this drop-up experimented with).
    body.appendChild(search);
    body.appendChild(list);
    const draw = (): void => {
      list.textContent = "";
      const q = (search?.value || "").trim().toLowerCase();
      const shown = q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos;
      if (!shown.length) {
        list.insertAdjacentHTML("beforeend", `<div class="drop-empty">${repos.length ? "No repositories match." : "No repositories found."}</div>`);
        return;
      }
      for (const r of shown) {
        const it = drillItem(r.fullName, `${r.private ? "private" : "public"} · ${r.defaultBranch}`, r.fullName === current ? CHECK : "");
        if (r.fullName === current) it.classList.add("selected");
        it.addEventListener("click", () => {
          // THE PICK HONORS THE SESSION'S LOCUS (his rule, 2026-08-28: "they
          // should be able to do this from anywhere"). A CLOUD session gets
          // the repo as its cloud checkout — desktop and web identically; the
          // desktop-only extra is that a LOCAL session clones the repo into
          // the working folder instead.
          const locus = opts.getSource().kind;
          if (!dg || locus !== "local") { pick({ kind: "cloud-repo", repo: r.fullName }); return; }
          // LOCAL: clone into the current working folder — the empty-folder
          // check lives in main; a non-empty folder answers with exactly why.
          void (async () => {
            it.classList.add("busy");
            const cwd = String(await (window as unknown as { wb?: { getCwd?: () => Promise<string> } }).wb?.getCwd?.() ?? "");
            if (!cwd) { paintNote("Pick a working folder first — the repo clones into it."); return; }
            const res = await dg.gitCloneInto!(r.fullName, cwd);
            if (!res.ok) { paintNote(res.error || "Clone failed."); return; }
            onBack();
            // The folder just became a repo — the workbench repaints the
            // workdir bar + git dot off this event.
            window.dispatchEvent(new CustomEvent("glyphh:cwd-content-changed"));
          })();
        });
        list.appendChild(it);
      }
    };
    search.addEventListener("input", draw);
    draw();
    requestAnimationFrame(() => search.focus());
  };

  const paintNote = (msg: string): void => {
    body.querySelector(".ws-clone-note")?.remove();
    body.insertAdjacentHTML("beforeend", `<div class="ws-note ws-clone-note"><div class="ws-note-body"></div></div>`);
    (body.querySelector(".ws-clone-note .ws-note-body") as HTMLElement).textContent = msg;
  };
  const load = async (): Promise<boolean> => {
    try {
      const st = dg ? (await dg.gitStatus!()).status : await s!.git!.status!();
      if (!st?.connected) return false;
      const repos = dg ? ((await dg.gitRepos!()).repos ?? []) : (s!.git!.repos ? await s!.git!.repos!() : []);
      paintRepos(Array.isArray(repos) ? repos : []);
      // ── account rows under the list ─────────────────────────────────────
      // A GitHub App only lists repos its INSTALLATION was granted — a short
      // list is a grant question, not a bug, so say where to widen it. And
      // the connection needs a door OUT (there was none anywhere).
      const manage = drillItem("Manage repository access…", "Grant the Glyphh app more repositories on GitHub", "");
      manage.addEventListener("click", () => { window.open("https://github.com/settings/installations", "_blank", "noopener"); });
      body.appendChild(manage);
      const disc = drillItem("Disconnect GitHub", "Unlink this account (repos stop listing here)", "");
      disc.addEventListener("click", () => {
        if (!s?.git?.disconnect) return;
        void s.git.disconnect()
          .then(() => { body.textContent = ""; connectRow(); })
          .catch(() => { /* the row stays; a failed unlink changes nothing */ });
      });
      body.appendChild(disc);
      return true;
    } catch { return false; }
  };

  const connectRow = (): void => {
    body.textContent = "";
    const row = drillItem("Connect GitHub…", "Link your account to clone a repository", "");
    row.addEventListener("click", () => {
      const arm = (): void => {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(() => {
          void load().then((ok) => { if (ok && pollTimer) { clearInterval(pollTimer); pollTimer = null; } });
        }, 2500);
        setTimeout(() => { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }, 180000);
      };
      if (dg) {
        // Desktop: main opens the OAuth link in the default browser; the
        // callback's self-closing page ends there, and the poll picks the
        // fresh connection up here.
        void dg.gitConnect!().then((r) => { if (r.ok) arm(); });
        return;
      }
      if (!s?.git?.connect) return;
      void s.git.connect().then((link) => {
        if (!link?.url) return;
        window.open(link.url, "glyphh-git-oauth", "width=600,height=760");
        arm();
      });
    });
    body.appendChild(row);
  };

  void load().then((connected) => { if (!connected) connectRow(); });
}

// ── Local → attached-machine folder browser ──────────────────────────────
function renderLocal(
  menu: HTMLElement,
  opts: { getSource: () => Source },
  machine: AttachedMachine | null,
  pick: (s: Source) => void,
  onBack: () => void,
  /** Where the walk starts; defaults to the source's own folder. The locus
   *  picker hands the current folder or a granted root here. */
  startAt?: string,
  /** The ceiling of the walk — the granted root on the web. Without one the
   *  listing's own root (or the first folder listed) is the ceiling. */
  capAt?: string,
): void {
  backHead(menu, machine?.name ? `On ${machine.name}` : "Local folder", onBack);
  const body = document.createElement("div");
  body.className = "ws-drop-body";
  menu.appendChild(body);
  body.insertAdjacentHTML("beforeend", `<div class="drop-empty">Checking your desktop…</div>`);

  const s = sdk();
  const startPath = startAt || (opts.getSource().kind === "local" ? (opts.getSource() as { path: string }).path : undefined);
  let root: string | null = capAt || null;

  const paintListing = (listing: FsListing): void => {
    body.textContent = "";
    const path = document.createElement("div");
    path.className = "ws-path";
    path.title = listing.path;
    path.textContent = listing.path;
    body.appendChild(path);
    const list = document.createElement("div");
    list.className = "code-repo-drop-list ws-fs-list";
    body.appendChild(list);
    // The MACHINE's root wins whenever the listing states it — pinning root to
    // the first path listed capped the walk at wherever the picker happened to
    // open, so a session already set deep in the tree could never go up.
    if (listing.root) root = listing.root;
    else if (!root) root = listing.path;
    if (canWalkUp(listing, root)) {
      const up = drillItem("‹ up", "", "");
      up.classList.add("ws-fs-up");
      up.addEventListener("click", () => walk(listing.parent!));
      list.appendChild(up);
    }
    const dirs = listing.entries.filter((e) => e.dir);
    for (const e of dirs) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "code-drop-item ws-fs-row";
      row.innerHTML = `${FOLDER}<span class="drop-lines"><span></span></span>${e.git ? `<span class="ws-gitdot" title="git repository"></span>` : ""}`;
      (row.querySelector(".drop-lines span") as HTMLElement).textContent = e.name;
      row.addEventListener("click", () => walk(e.path));
      list.appendChild(row);
    }
    if (!dirs.length) list.insertAdjacentHTML("beforeend", `<div class="drop-empty">No sub-folders here.</div>`);
    // Browse + pick ONLY: making a folder is the folder picker's New folder….
    const use = document.createElement("button");
    use.type = "button";
    use.className = "action-btn primary ws-use-folder";
    use.textContent = "Use this folder";
    use.addEventListener("click", () => pick({ kind: "local", path: listing.path, ...(machine?.id ? { machineId: machine.id } : {}) }));
    body.appendChild(use);
  };

  const walk = (path?: string): void => {
    // Web: the SDK attach fsList. Desktop-local: wb.listDir synthesized into a listing.
    // ANOTHER DESKTOP from this one: main asks that machine over the relay.
    const remoteId = machine?.id && machine.id !== "local" ? machine.id : "";
    const g = window as unknown as { glyphh?: { attachFsList?: (p: string | undefined, id: string) => Promise<FsListing> } };
    if (!isWeb() && remoteId && hostHas("attachFsList")) {
      void g.glyphh!.attachFsList!(path, remoteId).then((res) => {
        if (res && Array.isArray(res.entries)) paintListing(res);
        else unsupported();
      }).catch(() => unsupported());
      return;
    }
    if (s?.attach?.fsList) {
      void s.attach.fsList(path, remoteId ? { machineId: remoteId } : {}).then((res) => {
        if (res && Array.isArray(res.entries)) paintListing(res);
        else unsupported();
      }).catch(() => unsupported());
      return;
    }
    if (!isWeb() && wbh()?.listDir) void walkLocal(path);
    else unsupported();
  };

  // Desktop-local folder walk over wb.listDir/gitInfo — capped at the picked root.
  const walkLocal = async (path?: string): Promise<void> => {
    const w = wbh()!;
    let dir = path;
    if (!dir) dir = (await w.getCwdExplicit?.().catch(() => null)) || undefined;
    if (!dir) {
      // No current folder — offer the OS picker to establish the root.
      const picked = await w.pickCwd?.({ nullOnCancel: true }).catch(() => null);
      if (!picked) { unsupported("Pick a working folder to run a local session in."); return; }
      dir = picked;
    }
    try {
      const rows = await w.listDir!(dir);
      const parent = dir.replace(/\/[^/]+\/?$/, "") || "/";
      const entries: FsEntry[] = await Promise.all(
        rows.filter((r) => r.isDir && !r.name.startsWith(".")).map(async (r) => {
          const p = `${dir!.replace(/\/$/, "")}/${r.name}`;
          const gi = await w.gitInfo?.(p).catch(() => null);
          return { name: r.name, path: p, dir: true, git: !!gi?.isRepo };
        }),
      );
      paintListing({ path: dir, parent: parent === dir ? null : parent, root: root || dir, entries });
    } catch { unsupported(); }
  };

  const unsupported = (msg?: string): void => {
    body.textContent = "";
    body.insertAdjacentHTML("beforeend",
      `<div class="ws-note"><div class="ws-note-title">Folder browsing needs a desktop update</div><div class="ws-note-body">${msg || "This build can't list folders on the attached machine yet. Update the Glyphh desktop app to pick a local folder."}</div></div>`);
  };

  // Prime: confirm attachment (web) then walk.
  if (s?.attach?.status) {
    void s.attach.status().then((st) => {
      if (!st?.attached) {
        body.textContent = "";
        body.insertAdjacentHTML("beforeend",
          `<div class="ws-note"><div class="ws-note-title">Install the desktop app</div><div class="ws-note-body">Local sessions need your Glyphh desktop attached.</div></div>`);
        return;
      }
      walk(startPath);
    }).catch(() => walk(startPath));
  } else {
    walk(startPath);
  }
}

// ── small builders ────────────────────────────────────────────────────────
export function drillItem(main: string, hint: string, trailingSvg: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "code-drop-item";
  b.innerHTML = `<span class="drop-lines"><span class="ws-main"></span>${hint ? `<span class="drop-hint"></span>` : ""}</span>${trailingSvg}`;
  (b.querySelector(".ws-main") as HTMLElement).textContent = main;
  if (hint) (b.querySelector(".drop-hint") as HTMLElement).textContent = hint;
  return b;
}

export function backHead(menu: HTMLElement, title: string, onBack: () => void): void {
  const head = document.createElement("div");
  head.className = "code-drop-head ws-back-head";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "ws-back";
  back.title = "Back";
  back.textContent = "‹";
  back.addEventListener("click", (e) => { e.stopPropagation(); onBack(); });
  const label = document.createElement("span");
  label.textContent = title;
  head.append(back, label);
  menu.appendChild(head);
}
