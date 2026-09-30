/**
 * remote-control.ts — REMOTE CONTROL on the desktop (his order, 2026-09-30):
 * this machine takes turns from mobile.glyphh.ai only when its member turned
 * it on in Settings → Remote control, and only inside the folders granted there.
 *
 * THE SETTING is this device's, kept in the member's server prefs map under
 * `remoteControl:<hostname>` ({enabled, folders}) — it survives a restart and
 * nothing is stored on the machine (zero-local law). Off → no socket at all.
 *
 * THE TABLE the socket serves is the remote-safe list the server also enforces
 * (attach.py REMOTE_METHODS), wrapped here so every path stays inside a granted
 * folder: the phone's folder picker starts at the granted roots, a turn's
 * folder must be one of them, and a chat the phone names cannot claim another.
 * The registry's own handlers (and the loopback MCP that shares them) are
 * untouched — this is the remote door only.
 *
 * THE ORG'S SWITCH: attach.status says whether remote control is allowed; a
 * 4403 at the socket says it was turned off while on. Either way the page says
 * so and nothing attaches.
 */

import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { BrowserWindow, dialog, ipcMain } from "electron";
import { dispatchRelayMethod } from "./relay-client.js";
import { gitStateOf } from "./attach-handlers.js";
import { getClient } from "./glyphh-client.js";
import { broadcast } from "./broadcast.js";
import { getPreference, loadPreferences, setPreference } from "./stores/preferences-db.js";

export interface RemoteControlSetting { enabled: boolean; folders: string[] }

/** What the page shows: the setting, whether the org allows it, and the socket. */
export interface RemoteControlView extends RemoteControlSetting {
  device: string;
  allowed: boolean;
  attached: boolean;
  /** Why the server refused this machine, when it did. */
  refused?: string;
}

/** Everything a phone may call — the server's REMOTE_METHODS, no more. */
const PASS_THROUGH = [
  "relay.ping",
  "sessions.list", "sessions.get", "sessions.delete",
  "agent.answer", "agent.stop", "agent.permission", "agent.frames",
] as const;

const key = (): string => `remoteControl:${hostname()}`;
let refused: string | undefined;
let running = false;

function readSetting(): RemoteControlSetting {
  const v = getPreference(key(), null) as Partial<RemoteControlSetting> | null;
  return {
    enabled: v?.enabled === true,
    folders: Array.isArray(v?.folders) ? v.folders.filter((f): f is string => typeof f === "string" && !!f) : [],
  };
}

function writeSetting(s: RemoteControlSetting): void {
  setPreference(key(), { enabled: s.enabled, folders: s.folders });
}

// ── folders ──────────────────────────────────────────────────────────────────

function realOr(p: string): string {
  try { return realpathSync(p); } catch { return p; }
}

/** Inside a granted folder, symlinks resolved (a link out of the folder is outside it). */
export function inGranted(path: string, folders: string[]): boolean {
  if (!path) return false;
  const abs = resolve(path);
  const real = existsSync(abs) ? realOr(abs) : join(realOr(dirname(abs)), basename(abs));
  return folders.map(realOr).some((f) => real === f || real.startsWith(f.endsWith(sep) ? f : f + sep));
}

const str = (p: unknown, k: string): string => {
  const v = (p as Record<string, unknown> | null)?.[k];
  return typeof v === "string" ? v : "";
};

/** The table the socket serves, bounded to `folders()`. Exported for tests. */
export function remoteTable(folders: () => string[], dispatch: (m: string, p: unknown) => Promise<unknown> = dispatchRelayMethod): Record<string, (params: unknown) => Promise<unknown>> {
  const guard = (path: string): string => {
    if (!inGranted(path, folders())) throw new Error("that folder is not one this machine granted for remote control");
    return realOr(resolve(path));
  };
  const table: Record<string, (params: unknown) => Promise<unknown>> = {};
  for (const m of PASS_THROUGH) table[m] = (p) => dispatch(m, p);

  table["sessions.put"] = async (p) => {
    const workdir = str(p, "workdir");
    return dispatch("sessions.put", { ...(p as object), ...(workdir ? { workdir: guard(workdir) } : {}) });
  };
  table["agent.run"] = async (p) => {
    const workdir = str(p, "workdir");
    return dispatch("agent.run", { ...(p as object), ...(workdir ? { workdir: guard(workdir) } : {}) });
  };
  table["fs.list"] = async (p) => {
    const path = str(p, "path");
    if (!path) {
      // The granted folders ARE the roots — nothing above them is browsable.
      return { path: "", parent: null, entries: folders().map((f) => ({ name: basename(f) || f, path: f, dir: true, git: gitStateOf(f).isRepo })) };
    }
    const dir = guard(path);
    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => { const full = join(dir, d.name); return { name: d.name, path: full, dir: true, git: existsSync(join(full, ".git")) }; })
      .sort((a, b) => a.name.localeCompare(b.name));
    const up = dirname(dir);
    const roots = folders().map(realOr);
    return { path: dir, parent: roots.includes(dir) || !inGranted(up, folders()) ? null : up, entries };
  };
  table["fs.gitInfo"] = async (p) => gitStateOf(guard(str(p, "path")));
  table["fs.mkdir"] = async (p) => {
    const name = str(p, "name").trim();
    if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") throw new Error("a folder name, not a path");
    const parent = guard(str(p, "path") || folders()[0] || "");
    const full = join(parent, name);
    mkdirSync(full);
    return { path: full };
  };
  return table;
}

// ── on / off ─────────────────────────────────────────────────────────────────

async function orgAllows(): Promise<boolean> {
  const st = await getClient().attach.status().catch(() => null);
  return st?.allowed !== false;
}

function changed(): void {
  void remoteControlView().then((v) => broadcast("remote-control:changed", v)).catch(() => undefined);
}

async function start(): Promise<void> {
  const { folders, enabled } = readSetting();
  if (!enabled || !folders.length || running) return;
  if (!(await orgAllows())) { refused = "remote control is off for your organization"; changed(); return; }
  refused = undefined;
  const m = await import("./attach-host.js");
  m.startAttach({
    handlers: () => remoteTable(() => readSetting().folders),
    folders: () => readSetting().folders,
    onRefused: (reason) => { running = false; refused = reason; changed(); },
  });
  running = true;
  changed();
}

async function stop(): Promise<void> {
  if (!running) return;
  running = false;
  const m = await import("./attach-host.js");
  m.stopAttach();
  changed();
}

/** Signed in: attach if this device has remote control on (auth.ts). */
export async function remoteControlBoot(): Promise<void> {
  await loadPreferences().catch(() => undefined);
  await start();
}

/** Signed out: nothing stays attached. */
export function remoteControlStop(): void {
  refused = undefined;
  void stop();
}

export async function remoteControlView(): Promise<RemoteControlView> {
  const s = readSetting();
  const allowed = await orgAllows();
  const { attachStatus } = await import("./attach-host.js");
  return { ...s, device: hostname(), allowed, attached: attachStatus().attached, ...(refused ? { refused } : {}) };
}

async function apply(next: RemoteControlSetting): Promise<RemoteControlView> {
  writeSetting(next);
  await stop();
  if (next.enabled && next.folders.length) await start();
  return remoteControlView();
}

export function registerRemoteControlIpc(): void {
  ipcMain.handle("remote-control:get", () => remoteControlView());
  ipcMain.handle("remote-control:set-enabled", (_e, enabled: boolean) => apply({ ...readSetting(), enabled: enabled === true }));
  ipcMain.handle("remote-control:add-folder", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const r = await (win ? dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], title: "Grant a folder to remote control" }) : dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] }));
    const picked = r.canceled ? "" : realOr(r.filePaths[0] ?? "");
    const cur = readSetting();
    if (!picked || cur.folders.includes(picked)) return remoteControlView();
    return apply({ ...cur, folders: [...cur.folders, picked] });
  });
  ipcMain.handle("remote-control:remove-folder", (_e, folder: string) => {
    const cur = readSetting();
    return apply({ ...cur, folders: cur.folders.filter((f) => f !== folder) });
  });
}
