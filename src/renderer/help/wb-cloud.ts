/**
 * wb-cloud.ts — the DESKTOP's cloud-session implementation of the workbench
 * bridge (window.wb), plus the ROUTER that picks which bridge answers the
 * Files / Diff / Editor panels. The desktop twin of web/src/wb-pod.js
 * (createWbPod + createWbSelector): same contract, same error shapes, same
 * decision — the SESSION's locus, through help/panel-fs-route.ts.
 *
 * A cloud session's files live in its worker workspace. Here the bridge drives
 * main's cloud lane (main/cloud-fs.ts, preload cloudFs* / cloudGit*), scoped to
 * the session's workspace key; a LOCAL session's calls go to the untouched
 * window.wb (preload → files:* on this disk). Verbs the pod does not serve
 * (mkdir / delete / rename) answer with one honest line.
 *
 * WATCHING: the pod exposes cursor-polled change events; while any panel
 * subscribes, one ~2s poll maps them onto onFileChanged / onGitChanged, and a
 * scope switch re-roots through onCwdChanged — exactly the web's pipeline.
 *
 * THE ROUTER owns the live on* subscriptions and re-binds them on a locus
 * change (`glyphh:wb-locus-changed`, dispatched by code.ts on the desktop and
 * by web-contract.js on the web), then announces the new far side's root so
 * the workbench re-roots its panels in place (its existing onCwdChanged path).
 */

import { CLOUD_FS_NOT_YET, CLOUD_FS_NO_MKDIR, type PanelFsRoute } from "./panel-fs-route.js";

const noop = (): void => undefined;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export interface CloudFsEntry { name: string; path: string; kind: string }

/** The preload's slice of the lane (window.glyphh.cloudFs* / cloudGit*). */
export interface CloudFsLaneApi {
  cloudFsInfo(scope: string): Promise<{ root: string; isRepo?: boolean; branch?: string; error?: string }>;
  cloudFsList(scope: string, dir?: string): Promise<{ entries: CloudFsEntry[]; error?: string }>;
  cloudFsRead(scope: string, path: string): Promise<{ content: string; error?: string }>;
  cloudFsWrite(scope: string, path: string, content: string): Promise<{ ok: boolean; error?: string }>;
  cloudFsSearch(scope: string, query: string): Promise<{ entries: Array<{ name: string; rel: string; path: string; kind: string }>; truncated?: boolean; error?: string }>;
  cloudFsEvents(scope: string, from?: number): Promise<{ seq: number; root?: string; events: Array<{ type: string; path?: string }>; error?: string }>;
  cloudGitInfo(scope: string): Promise<{ isRepo: boolean; branch?: string; error?: string }>;
  cloudGitDiff(scope: string): Promise<{ text: string; error?: string }>;
}

/** The slice of the workbench bridge the panels route (code-workbench.ts WbApi). */
export interface PanelWb {
  getCwd(): Promise<string>;
  getCwdExplicit?(): Promise<string | null>;
  setCwd(dir: string): Promise<string>;
  getCwdRecents(): Promise<string[]>;
  pickCwd(opts?: unknown): Promise<string | null>;
  pickFile(): Promise<string | null>;
  gitInfo(root: string): Promise<{ isRepo: boolean; branch?: string }>;
  listDir(dir: string): Promise<{ entries: CloudFsEntry[]; error?: string }>;
  searchFiles(dir: string, query: string): Promise<{ entries: Array<{ name: string; rel: string; path: string; kind: string }>; truncated?: boolean; error?: string }>;
  readFile(path: string): Promise<{ content: string; error?: string }>;
  writeFile(path: string, content: string): Promise<{ ok: boolean; error?: string }>;
  gitDiff(root: string): Promise<{ text: string; error?: string }>;
  mkdir(dirPath: string): Promise<{ ok: boolean; error?: string }>;
  deletePath(target: string): Promise<{ ok: boolean; error?: string }>;
  renamePath(oldPath: string, newPath: string): Promise<{ ok: boolean; error?: string }>;
  previewNative(path: string): Promise<{ ok: boolean; method?: string; error?: string }>;
  convertPreview(path: string): Promise<{ pdfPath?: string; error?: string }>;
  onCwdChanged(cb: (dir: string | null) => void): () => void;
  onFileChanged(cb: (absPath: string) => void): () => void;
  onGitChanged?(cb: () => void): () => void;
}

export interface CloudWbOptions {
  lane: CloudFsLaneApi;
  /** The current session's workspace key; "" when the session is not a cloud one. */
  getScope: () => string;
  /** Test seam: the poll's clock. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export const CLOUD_FS_POLL_MS = 2000;
export const CLOUD_FS_RETRY_MS = 6000;

/** The cloud session's wb over main's lane. Every call is scoped at CALL time
 *  (the session may switch between a panel's paints). */
export function createCloudWb(opts: CloudWbOptions): PanelWb {
  const { lane, getScope } = opts;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  const scoped = (): string => {
    const scope = getScope();
    if (!scope) throw new Error("no cloud session selected");
    return scope;
  };
  // The root is deterministic per scope — cached after first sight so getCwd
  // does not re-fetch per panel paint.
  const roots = new Map<string, string>();
  const rootFor = async (scope: string): Promise<string> => {
    const known = roots.get(scope);
    if (known) return known;
    const info = await lane.cloudFsInfo(scope);
    if (info.error && !info.root) throw new Error(info.error);
    if (info.root) roots.set(scope, info.root);
    return info.root || "";
  };

  // ── watch pipeline: one cursor poll while any panel subscribes ────────────
  const fileSubs = new Set<(p: string) => void>();
  const gitSubs = new Set<() => void>();
  const cwdSubs = new Set<(c: string) => void>();
  let pollTimer: unknown = null;
  let polling = false;
  let cursor = -1;
  let watchScope = "";
  let lastCwd: string | null = null;

  const anySubs = (): boolean => fileSubs.size + gitSubs.size + cwdSubs.size > 0;
  const emit = <A extends unknown[]>(subs: Set<(...a: A) => void>, ...args: A): void => {
    for (const cb of [...subs]) { try { cb(...args); } catch { /* subscriber's problem */ } }
  };
  function schedule(ms: number): void {
    if (pollTimer || !anySubs()) return;
    pollTimer = setTimer(() => { pollTimer = null; void poll(); }, ms);
  }
  async function poll(): Promise<void> {
    if (!anySubs() || polling) return;
    polling = true;
    try {
      const scope = getScope();
      if (!scope) { schedule(CLOUD_FS_RETRY_MS); return; } // no cloud session — idle until one arrives
      if (scope !== watchScope) { watchScope = scope; cursor = -1; } // session switch → fresh cursor
      const page = await lane.cloudFsEvents(scope, cursor);
      if (page.error) throw new Error(page.error);
      cursor = typeof page.seq === "number" ? page.seq : cursor;
      if (page.root && page.root !== lastCwd) {
        lastCwd = page.root;
        roots.set(scope, page.root);
        emit(cwdSubs, page.root);
      }
      for (const ev of page.events || []) {
        if (ev.type === "file-changed" && typeof ev.path === "string") emit(fileSubs, ev.path);
        else if (ev.type === "git-changed") emit(gitSubs);
      }
      schedule(CLOUD_FS_POLL_MS);
    } catch {
      schedule(CLOUD_FS_RETRY_MS); // pod asleep — keep trying quietly
    } finally {
      polling = false;
    }
  }
  function subscribe<F>(subs: Set<F>, cb: F): () => void {
    subs.add(cb);
    void poll();
    return () => {
      subs.delete(cb);
      if (!anySubs() && pollTimer) { clearTimer(pollTimer); pollTimer = null; }
    };
  }

  return {
    // Machine-only dialogs — honest no-ops for a cloud session.
    pickCwd: async () => null,
    pickFile: async () => null,
    previewNative: async () => ({ ok: false, error: CLOUD_FS_NOT_YET }),
    convertPreview: async () => ({ error: "no-converter" }),

    getCwd: async () => {
      try { const cwd = await rootFor(scoped()); if (cwd) lastCwd = cwd; return cwd; }
      catch { return ""; }
    },
    // The workspace is session-bound BY DESIGN — it IS the explicit folder.
    getCwdExplicit: async () => { try { return (await rootFor(scoped())) || null; } catch { return null; } },
    setCwd: async () => { try { return (await rootFor(scoped())) || ""; } catch { return ""; } },
    getCwdRecents: async () => [],

    gitInfo: async () => {
      try {
        const r = await lane.cloudGitInfo(scoped());
        return { isRepo: !!r.isRepo, ...(r.branch ? { branch: r.branch } : {}) };
      } catch { return { isRepo: false }; }
    },
    listDir: async (dir) => {
      try { return await lane.cloudFsList(scoped(), dir || undefined); }
      catch (e) { return { entries: [], error: msg(e) }; }
    },
    searchFiles: async (_dir, query) => {
      try { return await lane.cloudFsSearch(scoped(), String(query ?? "")); }
      catch (e) { return { entries: [], error: msg(e) }; }
    },
    readFile: async (path) => {
      try { return await lane.cloudFsRead(scoped(), path); }
      catch (e) { return { content: "", error: msg(e) }; }
    },
    writeFile: async (path, content) => {
      try { return await lane.cloudFsWrite(scoped(), path, typeof content === "string" ? content : ""); }
      catch (e) { return { ok: false, error: msg(e) }; }
    },
    gitDiff: async () => {
      try { return await lane.cloudGitDiff(scoped()); }
      catch (e) { return { text: "", error: msg(e) }; }
    },
    // Not on the pod's fs surface (yet) — say so, never pretend.
    mkdir: async () => ({ ok: false, error: CLOUD_FS_NO_MKDIR }),
    deletePath: async () => ({ ok: false, error: CLOUD_FS_NOT_YET }),
    renamePath: async () => ({ ok: false, error: CLOUD_FS_NOT_YET }),

    onCwdChanged: (cb) => subscribe(cwdSubs, cb as (c: string) => void),
    onFileChanged: (cb) => subscribe(fileSubs, cb),
    onGitChanged: (cb) => subscribe(gitSubs, cb),
  };
}

export interface WbRouterOptions<T extends PanelWb> {
  /** The machine's bridge (the preload's window.wb). */
  local: T;
  /** The cloud session's bridge (createCloudWb). */
  cloud: T;
  /** The current session's route, read at CALL time. */
  route: () => PanelFsRoute;
  /** Test seam: where the locus-changed event arrives (window by default). */
  target?: { addEventListener(type: string, cb: () => void): void } | null;
}

export const WB_LOCUS_EVENT = "glyphh:wb-locus-changed";

/** The key a locus resolves to — a cloud session re-roots on its SCOPE, not just its kind. */
export function routeKey(r: PanelFsRoute): string {
  return r.route === "cloud" ? `cloud:${r.scope}` : r.route;
}

/**
 * One wb that routes by the session's locus: a cloud session → `cloud`,
 * everything else → `local` (the desktop's own disk, untouched). Live on*
 * subscriptions are owned HERE and re-bound on a locus flip; the new far
 * side's root is then announced so the workbench re-roots in place.
 */
export function createWbRouter<T extends PanelWb>(opts: WbRouterOptions<T>): T {
  const { local, cloud, route } = opts;
  const subs = { file: new Set<(p: string) => void>(), git: new Set<() => void>(), cwd: new Set<(c: string | null) => void>() };
  const total = (): number => subs.file.size + subs.git.size + subs.cwd.size;
  const pick = (r: PanelFsRoute): T => (r.route === "cloud" ? cloud : local);
  let activeKey = routeKey(route());
  const active = (): T => pick(route());
  let unbinds: Array<() => void> = [];

  const emit = <A extends unknown[]>(set: Set<(...a: A) => void>, ...args: A): void => {
    for (const cb of [...set]) { try { cb(...args); } catch { /* subscriber's problem */ } }
  };
  // One root announcement per change, whichever side says it first: the
  // re-root below and the cloud wb's own poll both learn the pod root.
  let lastCwd: string | null | undefined;
  const emitCwd = (c: string | null): void => {
    if (c === lastCwd) return;
    lastCwd = c;
    emit(subs.cwd, c);
  };
  function bind(): void {
    const a = active();
    unbinds = [
      a.onFileChanged((p) => emit(subs.file, p)),
      a.onGitChanged ? a.onGitChanged(() => emit(subs.git)) : noop,
      a.onCwdChanged((c) => emitCwd(c)),
    ];
  }
  function unbind(): void {
    for (const u of unbinds) { try { u(); } catch { /* already gone */ } }
    unbinds = [];
  }

  function onLocusChanged(): void {
    const next = route();
    const key = routeKey(next);
    if (key === activeKey) return;
    const flipped = key.split(":")[0] !== activeKey.split(":")[0];
    activeKey = key;
    if (total() === 0) return;
    if (flipped) { unbind(); bind(); }
    // Re-root the workbench onto the new far side's folder — its cwd-changed
    // path re-lists Files / re-fetches Diff in place. Announced for BOTH
    // directions (the web's selector does the same): a cloud session has no
    // folder push of its own, and a local one's setCwd → working-dir-changed
    // never fires when the machine's folder did not change.
    void pick(next).getCwd().then((cwd) => { if (cwd) emitCwd(cwd); }).catch(() => undefined);
  }
  const target = opts.target === undefined ? (typeof window !== "undefined" ? window : null) : opts.target;
  try { target?.addEventListener(WB_LOCUS_EVENT, onLocusChanged); } catch { /* bare test stubs */ }

  const subscribe = <F>(set: Set<F>, cb: F): (() => void) => {
    const wasIdle = total() === 0;
    set.add(cb);
    if (wasIdle) bind();
    return () => {
      set.delete(cb);
      if (total() === 0) unbind();
    };
  };

  const own: Partial<PanelWb> = {
    onFileChanged: (cb) => subscribe(subs.file, cb),
    onGitChanged: (cb) => subscribe(subs.git, cb),
    onCwdChanged: (cb) => subscribe(subs.cwd, cb),
  };

  // Everything else routes to the ACTIVE bridge at call time.
  return new Proxy(own as T, {
    get(t, prop) {
      if (prop === "then") return undefined;
      if (prop in t) return (t as unknown as Record<PropertyKey, unknown>)[prop];
      const a = active() as unknown as Record<PropertyKey, unknown>;
      const v = a[prop];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(a) : v;
    },
  });
}
