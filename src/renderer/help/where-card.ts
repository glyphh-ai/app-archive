/**
 * where-card.ts — THE ONE CHIP above the composer and its card (his decision,
 * 2026-10-10: "make this all a single chip that is a tad more dynamic"). The
 * chip reads `machine · project · branch`; a click opens one card, "Where
 * Glyphh works", with three rows: Machine, Project, Branch, each changing in
 * place. A machine that is asleep says so on the chip with a Wake, and waking
 * shows on the chip until the machine is up. The Branch row switches branches,
 * starts a new one, or turns git on ("Track changes") without git words.
 *
 * The Machine and Project rows hand off to the pickers that already exist
 * (code-source-chip.ts openMachinePicker / openFolderPicker). Git runs where
 * the folder is: this desktop over files:git-*, another machine (a desktop or
 * the Glyphh machine) over the relay, the web through window.wb (wb-relay).
 */

import { hostHas } from "./web-surface.js";
import { CHECK, CHEV, backHead, chipDrop, clampDropUp, clampDropX, drillItem, dropHead, glyphhMachineState, loadMachines, markUnreachable, wakeGlyphhMachine, type Source } from "./code-source-chip.js";
import { GLYPHH_MACHINE_WORKSPACE, machineOfSource, onOtherDesktop } from "./session-locus.js";
import { deviceRowsOf, type DevicesAnswer } from "./devices-rows.js";

// ── The words ───────────────────────────────────────────────────────────────

/** What the chip calls a project before it exists (his pick, 2026-10-10). */
export const NEW_PROJECT = "New project";

/** The project's name on the chip: the folder's own name; the Glyphh
 *  machine's bare workspace, or a cloud folder not made yet, is a New project. */
export function projectLabel(src: Source, folder: string): string {
  if (src.kind !== "local") {
    const dir = (src as { dir?: string }).dir || "";
    if (dir) return dir.split("/").filter(Boolean).pop() || dir;
    if (src.kind === "cloud-space") return src.label || NEW_PROJECT;
    if (src.kind === "cloud-repo" && src.repo) return src.repo.split("/").pop() || src.repo;
    return NEW_PROJECT;
  }
  const f = (folder || src.path || "").replace(/\/+$/, "");
  if (!f || f === GLYPHH_MACHINE_WORKSPACE) return onOtherDesktop(src) ? NEW_PROJECT : "Home";
  return f.split("/").filter(Boolean).pop() || f;
}

/** Where the session's machine stands right now. */
export type MachineState = "ready" | "asleep" | "starting" | "waking" | "gone";

/** The chip's state from what the machines list says (pure, for the tests). */
export function machineStateOf(row: { kind: string } | null, serverState: string, waking: boolean): MachineState {
  if (!row) return "gone";
  if (row.kind !== "glyphh") return "ready";
  if (waking) return "waking";
  return serverState === "starting" || serverState === "running" ? "starting" : "asleep";
}

// ── Git, wherever the folder is ─────────────────────────────────────────────

export interface GitBranches { isRepo: boolean; current?: string; branches: string[]; error?: string }
export interface GitLane {
  info(): Promise<{ isRepo: boolean; branch?: string } | null>;
  branches(): Promise<GitBranches>;
  switchTo(branch: string): Promise<GitBranches>;
  create(name: string): Promise<GitBranches>;
  init(): Promise<GitBranches>;
}

interface WbGit {
  gitInfo?: (root: string) => Promise<{ isRepo: boolean; branch?: string }>;
  gitBranches?: (root: string) => Promise<GitBranches>;
  gitSwitch?: (root: string, branch: string) => Promise<GitBranches>;
  gitCreateBranch?: (root: string, name: string) => Promise<GitBranches>;
  gitInit?: (root: string) => Promise<GitBranches>;
}
const wbGit = (): WbGit | undefined => (window as unknown as { wb?: WbGit }).wb;
const isWeb = (): boolean =>
  !!(window as unknown as { __GLYPHH_WEB__?: boolean }).__GLYPHH_WEB__
  || document.documentElement.classList.contains("glyphh-web");
/** An Electron IPC refusal reads "Error invoking remote method '…': Error: <why>" — keep the why. */
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");

/** The attached machine a source names, now (the socket id changes per reconnect). */
async function attachedId(src: Source): Promise<string | null> {
  if (src.kind !== "local") return null;
  const read = (window as unknown as { glyphh?: { attachDevicesList?: () => Promise<DevicesAnswer> } }).glyphh?.attachDevicesList;
  const a = read && hostHas("attachDevicesList") ? await read().catch(() => null) : null;
  const rows = a ? deviceRowsOf(a).devices : [];
  const hit = rows.find((d) => !!src.machineId && d.machineId === src.machineId) ?? (src.machine ? rows.find((d) => d.name === src.machine) : undefined);
  return hit?.machineId ?? null;
}

/** The lane git takes for this source's folder, or why there is none. */
export function gitLaneFor(src: Source, folder: string): { lane: GitLane | null; why?: string } {
  if (src.kind !== "local") return { lane: null, why: "A cloud copy is on the branch its repo was opened at." };
  const dir = folder || src.path || "";
  if (!dir) return { lane: null, why: "Pick a project first." };
  // Another machine, seen from this desktop: that machine runs git, over the relay.
  if (!isWeb() && onOtherDesktop(src)) {
    const call = (window as unknown as { glyphh?: { attachGitCall?: (m: string, p: Record<string, unknown>, id: string) => Promise<unknown> } }).glyphh?.attachGitCall;
    if (!call || !hostHas("attachGitCall")) return { lane: null, why: "Update Glyphh to change branches on another machine." };
    const on = async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
      const id = await attachedId(src);
      if (!id) throw new Error(`${src.machine || "That machine"} isn't connected right now.`);
      try { return await call(method, { path: dir, ...params }, id) as T; } catch (e) { throw new Error(why(e)); }
    };
    return {
      lane: {
        info: () => on<{ isRepo: boolean; branch?: string }>("fs.gitInfo", {}).catch(() => null),
        branches: () => on<GitBranches>("git.branches", {}),
        switchTo: (branch) => on<GitBranches>("git.switch", { branch }),
        create: (name) => on<GitBranches>("git.createBranch", { name }),
        init: () => on<GitBranches>("git.init", {}),
      },
    };
  }
  // This desktop's own folder, or (web) the attached machine's through wb-relay.
  const w = wbGit();
  if (!w?.gitBranches) return { lane: null, why: "Update Glyphh to change branches here." };
  const run = async <T>(f: () => Promise<T>): Promise<T> => { try { return await f(); } catch (e) { throw new Error(why(e)); } };
  return {
    lane: {
      info: () => (w.gitInfo ? w.gitInfo(dir).catch(() => null) : Promise.resolve(null)),
      branches: () => run(() => w.gitBranches!(dir)),
      switchTo: (branch) => run(() => w.gitSwitch!(dir, branch)),
      create: (name) => run(() => w.gitCreateBranch!(dir, name)),
      init: () => run(() => w.gitInit!(dir)),
    },
  };
}

// ── Waking the Glyphh machine ───────────────────────────────────────────────

const WAKE_POLL_MS = 4000;
const WAKE_GIVE_UP_MS = 6 * 60_000;
/** Machines being woken, by name, and the one painter told when that changes. */
const waking = new Map<string, number>();
const wakeFailed = new Map<string, string>();
let onWakeChange: () => void = () => {};
export function onWhereChange(cb: () => void): void { onWakeChange = cb; }
export const isWaking = (name: string): boolean => waking.has(name);
export const wakeError = (name: string): string => wakeFailed.get(name) ?? "";

/** Wake the session's Glyphh machine and watch it until it attaches: the chip
 *  shows "Waking …" the whole time, and the machine's folders once it is up. */
export async function wakeAndWatch(src: Source): Promise<void> {
  const name = src.kind === "local" ? src.machine || "" : "";
  if (!name || waking.has(name)) return;
  const model = await loadMachines().catch(() => null);
  const row = model ? machineOfSource(model, src) : null;
  if (!row || row.kind !== "glyphh") { onWakeChange(); return; }
  waking.set(name, Date.now());
  wakeFailed.delete(name);
  onWakeChange();
  const started = await wakeGlyphhMachine(row.glyphhId ?? "");
  if (!started) {
    waking.delete(name);
    wakeFailed.set(name, `Couldn't wake ${name}. Try again in a moment.`);
    onWakeChange();
    return;
  }
  const since = Date.now();
  const tick = async (): Promise<void> => {
    modelRead = null;
    const m = await machinesNow().catch(() => null);
    const r = m ? machineOfSource(m, src) : null;
    if (r && r.kind !== "glyphh") { waking.delete(name); onWakeChange(); return; }
    if (Date.now() - since > WAKE_GIVE_UP_MS) {
      waking.delete(name);
      wakeFailed.set(name, `${name} is taking longer than usual to start. Try Wake again.`);
      onWakeChange();
      return;
    }
    window.setTimeout(() => { void tick(); }, WAKE_POLL_MS);
  };
  window.setTimeout(() => { void tick(); }, WAKE_POLL_MS);
}

/** The machines list, shared by every paint for a few seconds: the chip
 *  repaints often and each read is three calls. A wake reads fresh. */
const MODEL_TTL_MS = 5000;
let modelAt = 0;
let modelRead: ReturnType<typeof loadMachines> | null = null;
function machinesNow(): ReturnType<typeof loadMachines> {
  if (!modelRead || Date.now() - modelAt > MODEL_TTL_MS) {
    modelAt = Date.now();
    modelRead = loadMachines();
    modelRead.catch(() => { modelRead = null; });
  }
  return modelRead;
}

/** The session's machine, as the chip paints it. */
export async function machineStateFor(src: Source): Promise<MachineState> {
  const name = src.kind === "local" ? src.machine || "" : "";
  // A cloud session or this desktop needs no list: it is ready.
  if (src.kind !== "local" || !onOtherDesktop(src)) return "ready";
  const model = await machinesNow().catch(() => null);
  if (!model) return "ready";
  const row = machineOfSource(model, src);
  return machineStateOf(row, row?.glyphhId ? glyphhMachineState(row.glyphhId) : "", !!name && waking.has(name));
}

// ── The card ────────────────────────────────────────────────────────────────

export interface WhereCardOpts {
  getSource: () => Source;
  /** The folder the session works in (threadFolder() for a local source). */
  folder: () => string;
  machineName: () => string;
  /** Once a session has a turn its machine and project are fixed; why, when they are. */
  locked: () => string | null;
  openMachine: () => void;
  openProject: () => void;
  /** Git changed (a switch, a new branch, git turned on): repaint the chip. */
  onGitChanged: () => void;
}

/** One row of the card: what it is, what it is now, and its action. */
function whereRow(key: string, value: string, action: string, onClick: (() => void) | null, lockedWhy?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "code-drop-item where-row";
  b.innerHTML = `<span class="where-key"></span><span class="where-val"></span><span class="where-act"></span>`;
  (b.querySelector(".where-key") as HTMLElement).textContent = key;
  (b.querySelector(".where-val") as HTMLElement).textContent = value;
  const act = b.querySelector(".where-act") as HTMLElement;
  if (lockedWhy) {
    b.classList.add("where-locked");
    b.title = lockedWhy;
    b.setAttribute("aria-disabled", "true");
  } else if (onClick) {
    act.innerHTML = `<span></span>${action === "Change" ? CHEV : ""}`;
    (act.firstElementChild as HTMLElement).textContent = action;
    b.addEventListener("click", onClick);
  }
  return b;
}

/** The card under the chip: Machine, Project, Branch. */
export function openWhereCard(anchor: HTMLElement, opts: WhereCardOpts): void {
  const { menu, close } = chipDrop(anchor);
  menu.classList.add("where-card");
  const err = (host: HTMLElement, text: string): void => {
    host.querySelector(".where-err")?.remove();
    if (!text) return;
    const e = document.createElement("div");
    e.className = "where-err";
    e.textContent = text;
    host.appendChild(e);
  };
  const place = (): void => { clampDropUp(menu, anchor); clampDropX(menu, anchor); };

  /** The three rows. */
  const paintMain = async (): Promise<void> => {
    const src = opts.getSource();
    const folder = opts.folder();
    const lockedWhy = opts.locked() ?? undefined;
    menu.textContent = "";
    dropHead(menu, "Where Glyphh works");
    const state = await machineStateFor(src);
    if (!menu.isConnected) return;
    const machineName = opts.machineName();
    const asleep = state === "asleep" || state === "waking" || state === "starting";
    const m = asleep
      ? whereRow("Machine", `${machineName} · ${state === "asleep" ? "asleep" : "starting…"}`, state === "asleep" ? "Wake" : "", state === "asleep" ? () => { void wakeAndWatch(src); close(); } : null)
      : whereRow("Machine", machineName, "Change", () => { close(); opts.openMachine(); }, lockedWhy);
    menu.appendChild(m);
    menu.appendChild(whereRow("Project", projectLabel(src, folder), "Change", asleep ? null : () => { close(); opts.openProject(); }, asleep ? undefined : lockedWhy));
    // The Branch row: read where the folder is.
    const { lane, why: noLane } = gitLaneFor(src, folder);
    const branchRow = whereRow("Branch", asleep ? "—" : "Checking…", "", null);
    menu.appendChild(branchRow);
    place();
    if (asleep) { branchRow.title = `${machineName} is asleep.`; return; }
    if (!lane) {
      (branchRow.querySelector(".where-val") as HTMLElement).textContent = "—";
      markUnreachable(branchRow, noLane || "");
      return;
    }
    const info = await lane.info();
    if (!menu.isConnected) return;
    const next = info?.isRepo
      ? whereRow("Branch", info.branch || "—", "Change", () => { void paintBranches(lane); })
      : whereRow("Branch", "Not tracking changes", "Track changes", () => { void trackChanges(lane, next); });
    if (!info?.isRepo) next.title = "Track changes keeps a history of this project, so you can try things on a branch and switch back";
    branchRow.replaceWith(next);
    place();
  };

  /** Turn git on, then show the branch it is on. */
  const trackChanges = async (lane: GitLane, row: HTMLElement): Promise<void> => {
    const act = row.querySelector(".where-act") as HTMLElement;
    act.innerHTML = `<span class="where-spin" aria-hidden="true"></span><span>Turning on…</span>`;
    row.setAttribute("aria-disabled", "true");
    try {
      await lane.init();
      opts.onGitChanged();
      await paintMain();
    } catch (e) {
      row.removeAttribute("aria-disabled");
      act.innerHTML = "<span>Track changes</span>";
      err(menu, why(e));
    }
  };

  /** The branch list: ✓ the current one, a click switches, + New branch… starts one. */
  const paintBranches = async (lane: GitLane): Promise<void> => {
    menu.textContent = "";
    backHead(menu, "Branch", () => { void paintMain(); });
    const list = document.createElement("div");
    list.className = "ws-locus-list";
    list.innerHTML = `<div class="drop-empty">Reading branches…</div>`;
    menu.appendChild(list);
    place();
    let b: GitBranches;
    try { b = await lane.branches(); } catch (e) { list.textContent = ""; err(menu, why(e)); return; }
    if (!menu.isConnected) return;
    list.textContent = "";
    for (const name of b.branches) {
      const sel = name === b.current;
      const r = drillItem(name, sel ? "You're on this branch" : "", sel ? CHECK : "");
      if (sel) r.classList.add("selected");
      r.addEventListener("click", () => {
        if (sel) { void paintMain(); return; }
        void (async () => {
          r.setAttribute("aria-disabled", "true");
          const hint = r.querySelector(".drop-lines") as HTMLElement;
          hint.insertAdjacentHTML("beforeend", `<span class="drop-hint">Switching…</span>`);
          try {
            await lane.switchTo(name);
            opts.onGitChanged();
            await paintMain();
          } catch (e) {
            r.removeAttribute("aria-disabled");
            hint.lastElementChild?.remove();
            err(menu, why(e));
          }
        })();
      });
      list.appendChild(r);
    }
    const fresh = drillItem("New branch…", "Try something without touching this one", CHEV);
    fresh.addEventListener("click", () => paintNewBranch(lane));
    list.appendChild(fresh);
    if (b.error) err(menu, b.error);
    place();
  };

  /** Name it, Create: it is made from where the project is now, and switched to. */
  const paintNewBranch = (lane: GitLane): void => {
    menu.textContent = "";
    backHead(menu, "New branch", () => { void paintBranches(lane); });
    const row = document.createElement("div");
    row.className = "ws-fs-newfolder";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "loop-drop-search repo-drop-search";
    input.placeholder = "Branch name, e.g. try-new-header";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.addEventListener("mousedown", (ev) => ev.stopPropagation());
    const create = document.createElement("button");
    create.type = "button";
    create.className = "action-btn primary";
    create.textContent = "Create";
    row.append(input, create);
    menu.appendChild(row);
    const note = document.createElement("div");
    note.className = "where-note";
    note.textContent = "Your project switches to it. The branch you were on stays as it is.";
    menu.appendChild(note);
    const go = async (): Promise<void> => {
      const name = input.value.trim();
      if (!name || create.disabled) return;
      create.disabled = true;
      err(menu, "");
      try {
        await lane.create(name);
        opts.onGitChanged();
        await paintMain();
      } catch (e) {
        create.disabled = false;
        err(menu, why(e));
      }
    };
    create.addEventListener("click", () => { void go(); });
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void go(); });
    place();
    requestAnimationFrame(() => input.focus());
  };

  void paintMain();
}
