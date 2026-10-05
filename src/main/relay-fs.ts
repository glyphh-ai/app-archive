/**
 * relay-fs.ts — the WEB workbench's filesystem and git, served by THIS
 * attached desktop over the attach relay (the same transport the web
 * terminal's relay-pty rides).
 *
 * The web Files tree / Diff / Monaco panels have no local machine; their
 * window.wb (web/src/wb-relay.js) dispatches these methods to the user's own
 * attached desktop:
 *
 *   fs.cwd     {}                → { cwd, explicit }  the machine's working folder
 *   fs.listDir {dir}             → { entries, error? }   the file tree's lazy listing
 *   fs.read    {path}            → { content, error? }   text only; a binary is refused
 *   fs.write   {path, content}   → { ok, error? }        2 MB cap
 *   fs.delete  {path}            → { ok, error? }        to the OS trash
 *   fs.rename  {path, to}        → { ok, error? }
 *   fs.search  {dir, query}      → { entries, truncated?, error? }
 *   fs.gitDiff {root, file?}     → { text, error? }      the Diff panel's unified diff
 *   fs.r2Diff  {root}            → the R2 lane twin (drift + history + head→local)
 *   git.status {path}            → { branch?, entries:[{status,path}], error? }
 *   fs.watch   {channel}         → forward the debounced workdir watcher's
 *                                  events upstream as pushes on `channel`:
 *                                  {type:"fs-changed",path} / {type:"git-changed"}
 *                                  / {type:"cwd-changed",cwd}
 *   fs.unwatch {channel}         → stop forwarding on that channel
 *
 * (`fs.gitInfo`, `fs.list` and `fs.mkdir` are the web folder PICKER's surface,
 * registered by attach-handlers.ts with the shapes the picker consumes, so they
 * are deliberately NOT re-registered here: different semantics, not clobbered.)
 *
 * Every implementation is the EXACT function the desktop's files:* IPC
 * handlers call (working-directory.ts) — one behavior, two transports.
 *
 * SECURITY — ONE TABLE, TWO FENCES. `relayFsTable(contain)` builds the
 * handlers around a path fence the caller supplies:
 *   · the loopback registry (installRelayFs) fences to the CURRENT working
 *     folder — the web workbench operates on the working folder and nothing
 *     else on this machine is its business;
 *   · the remote-control door (remote-control.ts) fences to the GRANTED
 *     folders — the folder is the sandbox, reads included (his report,
 *     2026-10-05: the web's Files / Diff / Editor could not read a desktop
 *     session's files). A path outside is refused before any disk access.
 *
 * Lifecycle mirrors relay-pty: watches die with the attach socket
 * (onAttachDown), and pushes are dropped when the socket is down.
 */

import path from "path";
import { registerRelayHandler } from "./relay-client.js";
import { pushLocal as pushToAttach } from "./relay-client.js";
import {
  getWorkingDirectory,
  getExplicitWorkingDirectory,
  listWorkdirDir,
  searchWorkdirFiles,
  readWorkdirFile,
  writeWorkdirFile,
  deleteWorkdirPath,
  renameWorkdirPath,
  gitDiffWorkdir,
  gitStatusWorkdir,
  onWorkdirEvent,
  type WorkdirEvent,
} from "./working-directory.js";
import { r2DiffWorkdir, appDirInWorkdir } from "./glyphh-app-builder.js";

/** Watch channels a browser bug must not grow unboundedly. */
const MAX_WATCH_CHANNELS = 8;
/** Push payload cap on fs.write — matches the read cap's order of magnitude. */
export const MAX_WRITE_BYTES = 2_000_000;

/** Live watch channels — pushes fan out to each. */
const watchChannels = new Set<string>();
let workdirUnsubscribe: (() => void) | null = null;

function forwardEvent(ev: WorkdirEvent): void {
  if (watchChannels.size === 0) return;
  const data =
    ev.type === "file-changed" ? { type: "fs-changed", path: ev.path } :
    ev.type === "git-changed" ? { type: "git-changed" } :
    { type: "cwd-changed", cwd: ev.cwd };
  for (const channel of watchChannels) pushToAttach(channel, data);
}

function ensureSubscribed(): void {
  if (workdirUnsubscribe) return;
  workdirUnsubscribe = onWorkdirEvent(forwardEvent);
}

/** Drop every watch — the attach socket died or the app is quitting. */
export function clearAllRelayFsWatches(): void {
  watchChannels.clear();
  if (workdirUnsubscribe) { workdirUnsubscribe(); workdirUnsubscribe = null; }
}

/** A required string param, validated. */
function str(params: unknown, key: string): string {
  const v = (params as Record<string, unknown> | null)?.[key];
  if (typeof v !== "string" || !v) throw new Error(`fs.* requires a string { ${key} }`);
  return v;
}

/**
 * Resolve a caller path and require it inside the CURRENT working-directory
 * tree (the root itself included) — the loopback fence.
 */
export function containedInWorkdir(p: string): string {
  const root = path.resolve(getWorkingDirectory());
  const abs = path.resolve(p);
  const rel = path.relative(root, abs);
  if (rel.split(path.sep)[0] === ".." || path.isAbsolute(rel)) {
    throw new Error("path is outside the working folder");
  }
  return abs;
}

export type RelayFsTable = Record<string, (params: unknown) => Promise<unknown> | unknown>;

/**
 * The fs/git handlers, fenced by `contain` (a path in → the absolute path to
 * serve, or a throw). `cwd` answers fs.cwd — the loopback reports the working
 * folder; the door narrows it to the grants.
 */
export function relayFsTable(contain: (p: string) => string, cwd: () => { cwd: string; explicit: string | null } = () => ({ cwd: getWorkingDirectory(), explicit: getExplicitWorkingDirectory() })): RelayFsTable {
  const fenced = (params: unknown, key: string): string => contain(str(params, key));
  return {
    "fs.cwd": () => cwd(),
    "fs.listDir": (params) => listWorkdirDir(fenced(params, "dir")),
    "fs.read": async (params) => {
      const r = await readWorkdirFile(fenced(params, "path"));
      // A NUL byte survives the utf8 decode: that is a binary, and the Editor
      // has no business with it. Honest refusal over garbage.
      if (!r.error && r.content.includes("\u0000")) return { content: "", error: "binary file — open it on your desktop" };
      return r;
    },
    "fs.write": (params) => {
      const abs = fenced(params, "path");
      const content = (params as Record<string, unknown> | null)?.content;
      if (typeof content !== "string") throw new Error("fs.write requires a string { content }");
      if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
        throw new Error("fs.write content too large");
      }
      return writeWorkdirFile(abs, content);
    },
    "fs.delete": (params) => deleteWorkdirPath(fenced(params, "path")),
    "fs.rename": (params) => renameWorkdirPath(fenced(params, "path"), fenced(params, "to")),
    "fs.gitDiff": (params) => {
      const root = fenced(params, "root");
      const file = (params as Record<string, unknown> | null)?.file;
      // A file rides as a path relative to the root; one outside it is refused.
      const rel = typeof file === "string" && file ? path.relative(root, contain(path.resolve(root, file))) : "";
      return gitDiffWorkdir(root, rel || undefined);
    },
    // The R2 lane twin (web = desktop tooling): drift + history + head→local diff.
    "fs.r2Diff": (params) => r2DiffWorkdir(appDirInWorkdir(fenced(params, "root"))),
    "git.status": (params) => gitStatusWorkdir(fenced(params, "path")),
    "fs.search": (params) => {
      const dir = fenced(params, "dir");
      const query = (params as Record<string, unknown> | null)?.query;
      if (typeof query !== "string") throw new Error("fs.search requires a string { query }");
      return searchWorkdirFiles(dir, query.slice(0, 200));
    },
    "fs.watch": (params) => {
      const channel = str(params, "channel");
      if (!/^[\w.:-]{1,80}$/.test(channel)) throw new Error("fs.watch channel must be a short token");
      if (!watchChannels.has(channel) && watchChannels.size >= MAX_WATCH_CHANNELS) {
        throw new Error(`fs.watch limit reached (${MAX_WATCH_CHANNELS})`);
      }
      watchChannels.add(channel);
      ensureSubscribed();
      // The current folder travels with the ack so the web can point its panels
      // without a second round trip.
      return { watching: true, cwd: cwd().cwd };
    },
    // Idempotent — the web page may unwatch after the attach socket already
    // swept everything.
    "fs.unwatch": (params) => {
      const channel = str(params, "channel");
      const had = watchChannels.delete(channel);
      if (watchChannels.size === 0 && workdirUnsubscribe) {
        workdirUnsubscribe();
        workdirUnsubscribe = null;
      }
      return { watching: false, had };
    },
  };
}

/** Register the fs relay methods on the loopback registry, fenced to the
 *  working folder. Call once at boot. */
export function installRelayFs(): void {
  // THE PURGE: no transport to drop — cleanup is app-quit's (main.ts kills all).
  for (const [method, handler] of Object.entries(relayFsTable(containedInWorkdir))) registerRelayHandler(method, handler);
}
