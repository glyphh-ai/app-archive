/**
 * machine-boot.ts — a Glyphh machine's start (machine-mode.ts): its owner's
 * session before anything reads one, its workspace granted for remote
 * control, a fresh sign-in whenever the session cannot be refreshed, and the
 * supervisor told while a turn runs. Nothing here runs off a machine.
 */

import fs from "node:fs";
import { machineSignIn, machineWorkspace, markMachineActive, onMachine } from "./machine-mode.js";
import { SERVER_URL, SESSION_FILE, resetClient } from "./glyphh-client.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function signInWithRetry(): Promise<boolean> {
  for (let i = 0; i < 6; i++) {
    try {
      const name = await machineSignIn(SERVER_URL, SESSION_FILE);
      console.warn("[machine] signed in as its owner:", name);
      return true;
    } catch (err) {
      console.warn(`[machine] sign-in failed (attempt ${i + 1}):`, err instanceof Error ? err.message : String(err));
      await sleep(2_000 * 2 ** i);
    }
  }
  return false;
}

/** Before the app reads its session: the owner's session, the workspace, remote control on. */
export async function machineBoot(): Promise<void> {
  if (!onMachine()) return;
  fs.mkdirSync(machineWorkspace(), { recursive: true });
  await signInWithRetry();
  const { armMachineRemoteControl } = await import("./remote-control.js");
  armMachineRemoteControl(machineWorkspace());
  // A session the server will not refresh is replaced, never prompted for: nobody is at this screen.
  const { setReauthHandler } = await import("./auth.js");
  setReauthHandler(() => { void signInWithRetry().then((ok) => { if (ok) resetClient(); }); });
  // A turn in flight keeps the machine awake (the supervisor's activity flag, read by the heartbeat).
  const { agentLive } = await import("./agent-live.js");
  setInterval(() => { if (agentLive.list().some((r) => r.status === "working" || r.status === "waiting")) markMachineActive(); }, 30_000).unref();
}
