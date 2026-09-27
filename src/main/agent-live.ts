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
import { activateAgentPanel } from "./working-directory.js";

export type { LiveAgentRun } from "./agent-live-registry.js";

export const agentLive = createAgentLiveRegistry((runs) => broadcast("glyphh-agent:live", runs));

export function registerAgentLiveIpc(): void {
  ipcMain.handle("glyphh-agent-live-list", () => agentLive.list());
  ipcMain.handle("agent-panel-open", (_e, p: { loop?: string } | undefined) => {
    broadcast("agent-panel:open", { loop: String(p?.loop ?? "") });
    return true;
  });
  // A panel's ⋮ tools (Files, Terminal, Editor, …) open in the SHELL's grid,
  // beside the panel — never inside it (his report, 2026-09-26).
  ipcMain.handle("agent-panel-open-tool", (e, p: { view?: string; cwd?: string } | undefined) => {
    // THE SHELL FOLLOWS THE AGENT YOU'RE WORKING IN (his decision, 2026-09-27):
    // opening a tool from a panel makes that panel the active one first, so the
    // tool comes up rooted in ITS folder (the folder change lands before the open).
    activateAgentPanel(e.sender.id);
    broadcast("agent-panel:open-tool", { view: String(p?.view ?? ""), cwd: String(p?.cwd ?? "") });
    return true;
  });
  // A panel became the one being worked in — a click or focus inside it (the
  // panel says so itself), or the shell fronting it (with the panel's id).
  ipcMain.handle("agent-panel-activate", (e, p: { wcId?: number } | undefined) => {
    activateAgentPanel(typeof p?.wcId === "number" ? p.wcId : e.sender.id);
    return true;
  });
}
