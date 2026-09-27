/**
 * agent-live.ts — the app's live-run ledger, wired to Electron.
 *
 * Every renderer (the shell, the home view, every solo agent panel) hears the
 * whole list on `glyphh-agent:live` and can ask for it cold with
 * `glyphh-agent-live-list`. The rail's session rows pulse by it, and a click on
 * a running session finds the panel that hosts the run (senderId).
 *
 * `agent-panel-open` is the solo panel's way to ask the shell for ANOTHER agent
 * panel — a webview must not nest a webview, so the request goes up to main
 * and back down to the host document as `agent-panel:open`.
 */

import { ipcMain } from "electron";
import { broadcast } from "./broadcast.js";
import { createAgentLiveRegistry } from "./agent-live-registry.js";

export type { LiveAgentRun } from "./agent-live-registry.js";

export const agentLive = createAgentLiveRegistry((runs) => broadcast("glyphh-agent:live", runs));

export function registerAgentLiveIpc(): void {
  ipcMain.handle("glyphh-agent-live-list", () => agentLive.list());
  ipcMain.handle("agent-panel-open", (_e, p: { loop?: string } | undefined) => {
    broadcast("agent-panel:open", { loop: String(p?.loop ?? "") });
    return true;
  });
}
