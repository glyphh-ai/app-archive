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
import { killAllRelayPtys } from "./relay-pty.js";
import { gitStateOf } from "./attach-handlers.js";
import { relayFsTable } from "./relay-fs.js";
import { getWorkingDirectory } from "./working-directory.js";
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

/** Everything the web may call — the server's REMOTE_METHODS, no more. The
 *  relay DRIVES A SESSION on this machine and carries no data (his order,
 *  2026-10-06): no thread, app or workspace list is read off it; every record
 *  is the server's. The CLIs' own sessions are the one read it carries (his
 *  order, 2026-10-07): they live on this machine and nowhere else. The web terminal's pty.input/resize/close
 *  name a pty this door opened (relay-pty.ts keys them by id); only pty.open
 *  takes a path, guarded below. The fs and git doors are NOT here: they take
 *  paths, so remoteTable builds them around the grant guard (relay-fs.ts). */
const PASS_THROUGH = [
  "relay.ping",
  // THE GATEWAY'S WINDOW TOOLS (his order, 2026-10-04: both surfaces drive each
  // other's panels through the relay). panels_* / layouts_open / settings_open
  // on the gateway's /mcp dispatch these to this machine; they are the SAME
  // registry handlers the local MCP's tools call, so one open is one open.
  "panels.open", "panels.list", "panels.switch", "panels.close", "layouts.open", "settings.open",
  "agent.answer", "agent.stop", "agent.permission", "agent.frames",
  "pty.input", "pty.resize", "pty.close",
  // A STREAMED PANEL on this machine for the web (panel-host.ts): the panel
  // broker refuses `panel.open` on a machine whose hello does not advertise
  // these, so they ride the door. A panel takes an http(s) url, no path.
  "panel.open", "panel.input", "panel.nav", "panel.clipboard", "panel.close", "panel.stats", "panel.webrtc",
] as const;

const key = (): string => `remoteControl:${hostname()}`;
let refused: string | undefined;
let running = false;

/** The server's words when the org's admin turned remote control off. */
export const ORG_OFF = "remote control is off for your organization";

/**
 * WHAT A 4403 MEANS HERE (his order, 2026-10-04). The server refuses this
 * host for good in two cases, and the SDK's attach host has already stopped
 * reconnecting by the time `onRefused` runs:
 *   · the ORG turned remote control off — the setting stays as it was (when
 *     the admin allows it again, the next boot or toggle attaches);
 *   · a DISCONNECT FROM THE WEB (Settings → Devices → Disconnect, or an
 *     unknown refusal) — this device's switch goes OFF, so the page says what
 *     the server said and "turn remote control on" is the way back.
 * Pure: the new setting and the line the Remote control page shows.
 */
export function afterRefusal(reason: string, setting: RemoteControlSetting): { setting: RemoteControlSetting; refused: string } {
  const why = (reason || "").trim();
  if (why === ORG_OFF) return { setting, refused: why };
  return {
    setting: { ...setting, enabled: false },
    refused: why ? `${why} (disconnected from the web — turn remote control on to attach again)` : "disconnected from the web — turn remote control on to attach again",
  };
}

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

  // THE FILE AND GIT DOORS (his report, 2026-10-05: "neither is the file
  // system, or diff data"): the web's Files / Diff / Editor read and write a
  // desktop session through relay-fs.ts's table — the desktop's own files:*
  // implementations — fenced HERE to the granted folders, reads included: the
  // folder is the sandbox. fs.cwd never names a folder outside the grants.
  const fsDoor = relayFsTable(guard, () => {
    const wd = realOr(resolve(getWorkingDirectory()));
    const cwd = inGranted(wd, folders()) ? wd : (folders().map(realOr)[0] ?? "");
    return { cwd, explicit: cwd || null };
  });
  for (const [m, h] of Object.entries(fsDoor)) table[m] = async (p) => h(p);

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
  // A WEB TERMINAL on this machine (his order, 2026-10-04: a CLI tile on
  // app.glyphh.ai opens the desktop's shell for a desktop-bound session). The
  // shell starts inside a granted folder — the one asked for, else the first
  // grant — exactly the rule a turn's workdir follows; no grant, no shell.
  table["pty.open"] = async (p) => {
    const cwd = str(p, "cwd") || folders()[0] || "";
    return dispatch("pty.open", { ...(p as object), cwd: guard(cwd) });
  };
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

const remoteOn = (s: RemoteControlSetting): boolean => s.enabled && s.folders.length > 0;

async function start(): Promise<void> {
  if (!remoteOn(readSetting()) || running) return;
  if (!(await orgAllows())) { refused = "remote control is off for your organization"; changed(); return; }
  refused = undefined;
  const m = await import("./attach-host.js");
  m.startAttach({
    handlers: () => (remoteOn(readSetting()) ? remoteTable(() => readSetting().folders) : {}),
    folders: () => (remoteOn(readSetting()) ? readSetting().folders : []),
    onRefused: (reason) => {
      running = false;
      const r = afterRefusal(reason, readSetting());
      writeSetting(r.setting);
      refused = r.refused;
      killAllRelayPtys();
      changed();
    },
  });
  running = true;
  changed();
}

async function stop(): Promise<void> {
  if (!running) return;
  running = false;
  const m = await import("./attach-host.js");
  m.stopAttach();
  // The door closed: every shell the web opened through it dies with it.
  killAllRelayPtys();
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
  await start();
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
  // SETTINGS → DEVICES (his order, 2026-10-04): the member's attached
  // machines and the ones disconnected from the web, through the main
  // process's SDK client (the renderer holds no client on the desktop).
  ipcMain.handle("attach-devices:list", () => listAttachedDevices());
  ipcMain.handle("attach-devices:disconnect", (_e, machineId: string) => disconnectAttachedDevice(machineId));
  ipcMain.handle("attach-devices:allow", (_e, device: string) => allowAttachedDevice(device));
}

// ── Settings → Devices (the server's /api/attach/devices) ───────────────────
//
//   GET  /api/attach/devices                     → { allowed, devices: [{ id, app, version, name, since,
//                                                   capabilities, folders, inst, device, remote }],
//                                                   blocked: [{ device, app, name, disconnectedAt }] }
//   POST /api/attach/devices/{machineId}/disconnect → { disconnected, device, hours }
//   POST /api/attach/devices/{device}/allow         → { allowed }   (`device` = the STABLE key, not the machine id)
//
// A server without the routes yet (404) answers with attach.status's machines
// instead, so the page lists what it can. Pure shapes; the renderer's
// settings-devices.ts normalizes both answers.

export interface AttachDevicesAnswer {
  source: "devices" | "status";
  allowed?: boolean;
  devices: Array<Record<string, unknown>>;
  blocked: Array<Record<string, unknown>>;
}

const notFound = (err: unknown): boolean => Number((err as { httpStatus?: unknown } | null)?.httpStatus) === 404;

export async function listAttachedDevices(): Promise<AttachDevicesAnswer> {
  const client = getClient();
  try {
    const r = await client.http.get<{ allowed?: boolean; devices?: Array<Record<string, unknown>>; blocked?: Array<Record<string, unknown>> }>("/api/attach/devices");
    return { source: "devices", ...(typeof r?.allowed === "boolean" ? { allowed: r.allowed } : {}), devices: Array.isArray(r?.devices) ? r.devices : [], blocked: Array.isArray(r?.blocked) ? r.blocked : [] };
  } catch (err) {
    if (!notFound(err)) throw err;
    const st = await client.attach.status();
    return { source: "status", ...(typeof st?.allowed === "boolean" ? { allowed: st.allowed } : {}), devices: (st?.machines ?? []) as unknown as Array<Record<string, unknown>>, blocked: [] };
  }
}

export async function disconnectAttachedDevice(machineId: string): Promise<{ disconnected: boolean; device?: string; hours?: number }> {
  const id = String(machineId || "").trim();
  if (!id) throw new Error("a machine id is required");
  return getClient().http.post<{ disconnected: boolean; device?: string; hours?: number }>(`/api/attach/devices/${encodeURIComponent(id)}/disconnect`);
}

export async function allowAttachedDevice(device: string): Promise<{ allowed: boolean }> {
  const id = String(device || "").trim();
  if (!id) throw new Error("a device key is required");
  return getClient().http.post<{ allowed: boolean }>(`/api/attach/devices/${encodeURIComponent(id)}/allow`);
}
