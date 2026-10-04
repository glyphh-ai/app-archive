/**
 * cloud-fs.ts — THE DESKTOP'S CLOUD FS/GIT LANE (his report, 2026-10-04: "the
 * workpanels like files, diff etc. are not adjusting to the cloud directories").
 *
 * A session whose locus is "In the cloud" keeps its files in the worker's
 * per-thread workspace (rrotor harness/fs-routes.ts, mirrored to R2), not on
 * this machine. The web's Files / Diff / Editor panels already read that
 * workspace through the SDK's harness client (web/src/wb-pod.js); this is the
 * same lane for the desktop, where the SDK client lives in main
 * (glyphh-client.ts) and the renderer reaches it over IPC:
 *
 *   cloud-fs-info     (scope)                → { root, isRepo, branch? }
 *   cloud-fs-list     (scope, dir?)          → { entries, error? }
 *   cloud-fs-read     (scope, path)          → { content, error? }
 *   cloud-fs-write    (scope, path, content) → { ok, error? }   (the pod mirrors to R2 after)
 *   cloud-fs-search   (scope, query)         → { entries, truncated?, error? }
 *   cloud-fs-events   (scope, from)          → { seq, root?, events }  (cursor poll)
 *   cloud-git-info    (scope)                → { isRepo, branch? }
 *   cloud-git-diff    (scope)                → { text, error? }
 *
 * `scope` is the SESSION's workspace key — the thread id, or a re-entered
 * space's id (remote-run.ts runThreadId / terminal-target.ts cloudScope: the
 * exact key the run executes under). The renderer decides the scope from the
 * session's source (help/panel-fs-route.ts); a local session never calls here.
 *
 * WHAT THE POD DOES NOT SERVE (fs-routes.ts, 2026-10-04): mkdir, delete,
 * rename, stat, git status and git log. There is no IPC for a verb nobody
 * answers — the renderer's cloud wb (help/wb-cloud.ts) says so in one line.
 *
 * Every fs-level failure rides IN the returned shape (the pod replicates the
 * desktop's error shapes); a transport/auth failure becomes the same shape
 * with its message, so a panel never sees a rejected invoke. Signed out, or
 * no scope, answers the same way. Nothing here touches the local disk.
 *
 * The core is injectable (`createCloudFsLane`) so it is tested against a fake
 * harness client; `registerCloudFsIpc` wires Electron.
 */

import { ipcMain } from "electron";
import { getClient } from "./glyphh-client.js";
import { isAuthenticated } from "./auth.js";

export interface CloudFsEntry { name: string; path: string; kind: string }
export interface CloudFsSearchEntry { name: string; rel: string; path: string; kind: string }
export interface CloudFsInfo { root: string; isRepo?: boolean; branch?: string }
export interface CloudFsEvent { type: string; path?: string }
export interface CloudFsEventsPage {
  seq: number;
  root?: string;
  events: CloudFsEvent[];
}

/** The slice of `@glyphh/sdk`'s harness client (`client.harnessViaApi()`) the lane drives. */
export interface CloudFsHarness {
  fsInfo(opts: { scope?: string }): Promise<CloudFsInfo>;
  fsList(opts: { dir?: string; scope?: string }): Promise<{ entries: CloudFsEntry[]; error?: string }>;
  fsRead(opts: { path: string; scope?: string }): Promise<{ content: string; error?: string }>;
  fsWrite(opts: { path: string; content: string; scope?: string }): Promise<{ ok: boolean; error?: string }>;
  fsDiff(opts: { scope?: string }): Promise<{ text: string; error?: string }>;
  fsSearch(opts: { query: string; scope?: string }): Promise<{ entries: CloudFsSearchEntry[]; truncated?: boolean; error?: string }>;
  fsEvents(opts: { from?: number; scope?: string }): Promise<CloudFsEventsPage>;
}

export interface CloudFsClient { harnessViaApi(): CloudFsHarness }

export interface CloudFsLaneDeps {
  client: () => CloudFsClient;
  signedIn: () => boolean;
  log?: (msg: string) => void;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const CLOUD_FS_SIGNED_OUT = "signed out";
export const CLOUD_FS_NO_SCOPE = "no cloud session";

export function createCloudFsLane(deps: CloudFsLaneDeps) {
  const log = deps.log ?? (() => undefined);

  /** The gate every verb passes: signed in, and a scope to key the workspace. */
  const refuse = (scope: string): string | null => {
    if (!deps.signedIn()) return CLOUD_FS_SIGNED_OUT;
    if (!scope) return CLOUD_FS_NO_SCOPE;
    return null;
  };

  /** Run one harness call; a refusal or a transport failure becomes `onError`'s shape. */
  async function call<T>(scope: string, what: string, run: (hc: CloudFsHarness) => Promise<T>, onError: (error: string) => T): Promise<T> {
    const why = refuse(scope);
    if (why) return onError(why);
    try { return await run(deps.client().harnessViaApi()); }
    catch (err) { log(`cloud ${what} failed: ${errorText(err)}`); return onError(errorText(err)); }
  }

  const s = (v: unknown): string => String(v ?? "").trim();

  return {
    /** The workspace root + git identity. */
    info: (scope: string): Promise<CloudFsInfo & { error?: string }> =>
      call(s(scope), "fs-info", async (hc) => {
        const r = await hc.fsInfo({ scope: s(scope) });
        return { root: String(r?.root ?? ""), isRepo: !!r?.isRepo, ...(r?.branch ? { branch: String(r.branch) } : {}) };
      }, (error) => ({ root: "", isRepo: false, error })),

    /** Immediate children of `dir` (absent = the workspace root). */
    list: (scope: string, dir?: string): Promise<{ entries: CloudFsEntry[]; error?: string }> =>
      call(s(scope), "fs-list", async (hc) => {
        const r = await hc.fsList({ scope: s(scope), ...(dir ? { dir: String(dir) } : {}) });
        return { entries: Array.isArray(r?.entries) ? r.entries : [], ...(r?.error ? { error: r.error } : {}) };
      }, (error) => ({ entries: [], error })),

    read: (scope: string, path: string): Promise<{ content: string; error?: string }> =>
      call(s(scope), "fs-read", async (hc) => {
        if (!s(path)) return { content: "", error: "missing path" };
        const r = await hc.fsRead({ scope: s(scope), path: String(path) });
        return { content: typeof r?.content === "string" ? r.content : "", ...(r?.error ? { error: r.error } : {}) };
      }, (error) => ({ content: "", error })),

    /** Write a text file; the pod creates parents and mirrors the workspace to R2 after. */
    write: (scope: string, path: string, content: string): Promise<{ ok: boolean; error?: string }> =>
      call(s(scope), "fs-write", async (hc) => {
        if (!s(path)) return { ok: false, error: "missing path" };
        const r = await hc.fsWrite({ scope: s(scope), path: String(path), content: typeof content === "string" ? content : "" });
        return { ok: !!r?.ok, ...(r?.error ? { error: r.error } : {}) };
      }, (error) => ({ ok: false, error })),

    search: (scope: string, query: string): Promise<{ entries: CloudFsSearchEntry[]; truncated?: boolean; error?: string }> =>
      call(s(scope), "fs-search", async (hc) => {
        const q = s(query);
        if (!q) return { entries: [] };
        const r = await hc.fsSearch({ scope: s(scope), query: q });
        return { entries: Array.isArray(r?.entries) ? r.entries : [], ...(r?.truncated ? { truncated: true } : {}), ...(r?.error ? { error: r.error } : {}) };
      }, (error) => ({ entries: [], error })),

    /** One page of workspace change events after `from` (< 0 = establish the cursor). */
    events: (scope: string, from?: number): Promise<CloudFsEventsPage & { error?: string }> =>
      call(s(scope), "fs-events", async (hc) => {
        const r = await hc.fsEvents({ scope: s(scope), from: typeof from === "number" ? from : -1 });
        return { seq: typeof r?.seq === "number" ? r.seq : -1, ...(r?.root ? { root: String(r.root) } : {}), events: Array.isArray(r?.events) ? r.events : [] };
      }, (error) => ({ seq: -1, events: [], error })),

    /** Repo probe + branch — the desktop's files:git-info, for the pod workspace. */
    gitInfo: (scope: string): Promise<{ isRepo: boolean; branch?: string; error?: string }> =>
      call(s(scope), "git-info", async (hc) => {
        const r = await hc.fsInfo({ scope: s(scope) });
        return { isRepo: !!r?.isRepo, ...(r?.branch ? { branch: String(r.branch) } : {}) };
      }, (error) => ({ isRepo: false, error })),

    /** Unified working-tree diff (staged + unstaged + untracked) — the desktop's files:git-diff. */
    gitDiff: (scope: string): Promise<{ text: string; error?: string }> =>
      call(s(scope), "git-diff", async (hc) => {
        const r = await hc.fsDiff({ scope: s(scope) });
        return { text: typeof r?.text === "string" ? r.text : "", ...(r?.error ? { error: r.error } : {}) };
      }, (error) => ({ text: "", error })),
  };
}

export type CloudFsLane = ReturnType<typeof createCloudFsLane>;

let lane: CloudFsLane | null = null;
function live(): CloudFsLane {
  return (lane ??= createCloudFsLane({
    client: () => getClient(),
    signedIn: isAuthenticated,
    log: (msg) => console.warn(`[cloud-fs] ${msg}`),
  }));
}

export function registerCloudFsIpc(): void {
  ipcMain.handle("cloud-fs-info", (_e, scope: string) => live().info(scope));
  ipcMain.handle("cloud-fs-list", (_e, scope: string, dir?: string) => live().list(scope, dir));
  ipcMain.handle("cloud-fs-read", (_e, scope: string, path: string) => live().read(scope, path));
  ipcMain.handle("cloud-fs-write", (_e, scope: string, path: string, content: string) => live().write(scope, path, content));
  ipcMain.handle("cloud-fs-search", (_e, scope: string, query: string) => live().search(scope, query));
  ipcMain.handle("cloud-fs-events", (_e, scope: string, from?: number) => live().events(scope, from));
  ipcMain.handle("cloud-git-info", (_e, scope: string) => live().gitInfo(scope));
  ipcMain.handle("cloud-git-diff", (_e, scope: string) => live().gitDiff(scope));
}
