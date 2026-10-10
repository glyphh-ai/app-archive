/**
 * net-ask.ts — the member answers the shell's network asks (net-proxy.ts) in the
 * session's own panel: Allow once, Always, Deny. No panel showing the session,
 * no ask: the answer is Deny.
 */

import { app, ipcMain } from "electron";
import { loopSenderOf } from "./glyphh-loop.js";
import { isRelaySink } from "./attach-run-frames.js";
import { ensureNetProxy, setNetAsker, type NetChoice } from "./net-proxy.js";
import { setAppDataDirs } from "./shell-fence.js";

const waiting = new Map<string, (c: NetChoice) => void>();
const outside = new Map<string, (run: boolean) => void>();
let seq = 0;

/** Ask the member, in the session's panel, to run ONE command outside the sandbox. No panel, no. */
export function askOutsideSandbox(chatId: string, command: string, reason: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const panel = loopSenderOf(chatId);
    // A relayed turn (the web, the phone) is never approved over the relay: remote control is the perimeter.
    if (!panel || isRelaySink(panel)) { resolve(false); return; }
    const id = `out-${Date.now().toString(36)}-${++seq}`;
    const timer = setTimeout(() => { if (outside.delete(id)) resolve(false); }, 10 * 60_000);
    outside.set(id, (run) => { clearTimeout(timer); resolve(run); });
    try { panel.send("glyphh-agent:outside-ask", { id, chatId, command, reason }); }
    catch { outside.delete(id); clearTimeout(timer); resolve(false); }
  });
}

export function registerNetAskIpc(): void {
  setAppDataDirs([app.getPath("userData")]);
  setNetAsker((chatId, host) => new Promise<NetChoice>((resolve) => {
    const panel = loopSenderOf(chatId);
    if (!panel || isRelaySink(panel)) { resolve("deny"); return; }
    const id = `net-${Date.now().toString(36)}-${++seq}`;
    waiting.set(id, resolve);
    try { panel.send("glyphh-agent:net-ask", { id, chatId, host }); }
    catch { waiting.delete(id); resolve("deny"); }
  }));
  ipcMain.handle("glyphh-net-answer", (_e, id: string, choice: NetChoice) => {
    const r = waiting.get(String(id));
    if (!r) return false;
    waiting.delete(String(id));
    r(choice === "once" || choice === "always" ? choice : "deny");
    return true;
  });
  ipcMain.handle("glyphh-outside-answer", (_e, id: string, run: boolean) => {
    const r = outside.get(String(id));
    if (!r) return false;
    outside.delete(String(id));
    r(run === true);
    return true;
  });
  void ensureNetProxy().catch((err: unknown) => console.warn("[net-proxy] not started; sessions have no network:", err instanceof Error ? err.message : err));
}
