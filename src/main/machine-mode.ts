/**
 * machine-mode.ts — THE DESKTOP APP ON A GLYPHH MACHINE (his call,
 * 2026-10-09/10: "Do the app on the machine first... the most foundational
 * thing we can do"). A Glyphh machine is a desktop with remote control on and
 * nobody at it: this same app, on the machine's virtual display, started by
 * its supervisor (rrotor machine mode) with the machine's token.
 *
 * At boot, before anything reads a session:
 *   · the token is taken out of the environment, so no shell or program the
 *     loop runs can read it, and kept here alone;
 *   · the app signs in as the machine's owner (POST /api/machines/session: a
 *     session tied to this machine, held to a member's rights) and writes the
 *     session file the client reads;
 *   · it is named by the machine's readable name (its device name everywhere:
 *     the attach hello, remote control, memory, projects);
 *   · remote control is on with the workspace as the only granted folder.
 * While a turn runs it tells the supervisor, so the meter keeps it awake.
 * Any other launch is untouched: no token, no machine mode.
 */

import fs from "node:fs";
import { hostname } from "node:os";
import path from "node:path";

const TOKEN_ENV = "GLYPHH_MACHINE_TOKEN";
const token = process.env[TOKEN_ENV] ?? "";
delete process.env[TOKEN_ENV];

let deviceNameNow = "";

/** Is this app a Glyphh machine's? */
export function onMachine(): boolean { return !!token; }

/** The workspace: the machine's one granted folder. */
export function machineWorkspace(): string { return process.env.GLYPHH_WORKSPACE || "/data/workspace"; }

/** This device's name: the machine's readable name on a machine, else the hostname. */
export function deviceName(): string { return deviceNameNow || hostname(); }

/** What a shell on a machine never reads: the machine's own data on its volume. */
export function machineDenied(): string[] {
  if (!onMachine()) return [];
  const data = process.env.GLYPHH_DATA_DIR || "/data";
  return ["pg", "neo4j", "apps", "browser", "build", "app"].map((d) => path.join(data, d));
}

export interface MachineSession { accessToken: string; refreshToken: string; expiresIn: number; machine?: { id?: string; name?: string } }

/** Sign in as the machine's owner and write the session file. Answers the machine's name. */
export async function machineSignIn(serverUrl: string, sessionFile: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!token) throw new Error("not a machine");
  const res = await fetcher(`${serverUrl.replace(/\/$/, "")}/api/machines/session`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}",
  });
  if (!res.ok) throw new Error(`the server refused the machine's sign-in (${res.status})`);
  const s = ((await res.json()) as { data?: MachineSession }).data;
  if (!s?.accessToken || !s.refreshToken) throw new Error("the server answered no session");
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(sessionFile, JSON.stringify({ accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: Date.now() + Math.max(60, s.expiresIn) * 1000 }), { encoding: "utf-8", mode: 0o600 });
  deviceNameNow = String(s.machine?.name || "").trim() || deviceNameNow;
  return deviceName();
}

/** Tell the supervisor this machine is working (a turn in flight): it keeps the meter awake. */
export function markMachineActive(fetcher: typeof fetch = fetch): void {
  if (!token) return;
  const url = `${process.env.GLYPHH_SUPERVISOR_URL || "http://127.0.0.1:8080"}/machine/active`;
  void fetcher(url, { method: "POST" }).catch(() => undefined);
}
