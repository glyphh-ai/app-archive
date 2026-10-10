/**
 * net-ask.ts — the member answers the shell's network asks (net-proxy.ts) in the
 * session's own panel: Allow once, Always, Deny. No panel showing the session,
 * no ask: the answer is Deny.
 */

import { app, ipcMain } from "electron";
import { loopSenderOf } from "./glyphh-loop.js";
import { ensureNetProxy, setNetAsker, type NetChoice } from "./net-proxy.js";
import { setAppDataDirs } from "./shell-fence.js";

const waiting = new Map<string, (c: NetChoice) => void>();
let seq = 0;

export function registerNetAskIpc(): void {
  setAppDataDirs([app.getPath("userData")]);
  setNetAsker((chatId, host) => new Promise<NetChoice>((resolve) => {
    const panel = loopSenderOf(chatId);
    if (!panel) { resolve("deny"); return; }
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
  void ensureNetProxy().catch((err: unknown) => console.warn("[net-proxy] not started; sessions have no network:", err instanceof Error ? err.message : err));
}
