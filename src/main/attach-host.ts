/**
 * attach-host.ts — this machine's OUTBOUND socket to the server (RELAY-RESEARCH.md
 * §4): one authenticated WebSocket the server dispatches method calls down and
 * we push frames up. Nothing dials in. The SDK's attach host does the wire;
 * this file binds it to the app: the signed-in client, the capability
 * registry, the local push bus, and the pty teardown when the socket drops.
 *
 * REMOTE CONTROL (his order, 2026-09-30): the socket is up only while the
 * member has remote control on (remote-control.ts decides, and hands over the
 * table — the remote-safe methods, bounded to the granted folders — and the
 * folders every hello names). Stops on sign-out and when it is turned off.
 * Re-advertises the table once main.ts has installed every handler
 * (refreshHello), so the first hello never lists a partial method table.
 */

import { hostname } from "node:os";
import { app } from "electron";
import { startAttachHost, type AttachHost } from "@glyphh/sdk/runtime";
import { getClient, SERVER_URL } from "./glyphh-client.js";
import { notifyAttachTable } from "./notify.js";

let host: AttachHost | null = null;

export interface AttachStartOptions {
  /** What the server may call — read on every hello. */
  handlers: () => Record<string, (params: unknown) => Promise<unknown>>;
  /** The granted folders — read on every hello. */
  folders: () => string[];
  /** The org turned remote control off: the host has stopped for good. */
  onRefused: (reason: string) => void;
}

export function startAttach(opts: AttachStartOptions): void {
  if (host) return;
  host = startAttachHost({
    client: getClient(),
    server: SERVER_URL,
    app: "glyphh-desktop",
    version: app.getVersion(),
    name: hostname(),
    // The remote table, and beside it what the server may always call on an
    // attached desktop: a cloud app's notification for this member (notify.ts).
    handlers: () => ({ ...opts.handlers(), ...notifyAttachTable() }),
    folders: opts.folders,
    onRefused: (reason) => { stopAttach(); opts.onRefused(reason); },
  });
  // A relayed run's frames (attach-run.ts) and a web terminal's pty output
  // (relay-pty.ts, through remote-control.ts's pty.* door) go up; the fs
  // watchers stay on the local bus — nothing reaches them remotely.
  console.info("[attach] host started", { server: SERVER_URL });
}

export function stopAttach(): void {
  host?.stop();
  host = null;
  console.info("[attach] host stopped");
}

/** Send a frame up the socket; false (and dropped) while it is down. */
export function pushToAttach(channel: string, data: unknown): boolean {
  return host?.push(channel, data) ?? false;
}

/** Re-advertise the capability table after handlers were installed. */
export function attachRefreshHello(): void {
  host?.refreshHello();
}

export function attachStatus(): { attached: boolean; server: string } {
  return { attached: host?.attached() ?? false, server: SERVER_URL };
}
