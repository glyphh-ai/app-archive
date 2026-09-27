/**
 * glyphh-loop.ts — THE GLYPHH LOOP in the desktop (his order, 2026-09-21): our
 * own agent loop, a supported loop beside claude/codex/gemini, on ANY model the
 * gateway serves. The ENGINE is the SDK's (`@glyphh/sdk/loop`, one loop for
 * every host — the `glyphh` CLI runs the same class); this file is the
 * desktop's seat: the member's gateway credential, the app's local MCP server
 * and the gateway's connection tools lent as MCP servers, the memory bridge
 * re-pointing the Messages base URL, and the loop's events sent to the Agent
 * panel on the SAME renderer channels the CLI bridge speaks
 * (glyphh-agent:setup/delta/tool/approval/progress/permission/done/error).
 *
 * State is process memory (nothing of ours on disk); the chat re-seeds from the
 * renderer's stored turns after a restart and is forgotten on sign-out.
 */

import type { WebContents } from "electron";
import { GlyphhLoop, type LoopEvent, type LoopMcpServer, type LoopPermission, type SeedTurn } from "@glyphh/sdk/loop";
import { gatewayCreds, mcpCreds } from "./gateway-token.js";
import { bridgeWrap } from "./memory-bridge.js";
import { startLocalMcpServer, localMcpStatus, localMcpGenToken } from "./local-mcp-server.js";
import { bareModel, orgRequiredModel } from "./cli-agents.js";
import { agentLive, noteRunDelta, registerRunRebinder } from "./agent-live.js";

export type { LoopPermission };

export interface LoopRunPayload {
  chatId: string;
  permission?: LoopPermission;
  model?: string;
  workdir?: string;
  workspace?: string;
  /** The chat's stored turns, to seed a conversation this process has not seen. */
  history?: SeedTurn[];
}

/** The servers this desktop lends a run: the app's own local MCP (glyphh_*
 *  tools) and the gateway's connection tools (mcp_tool_search / mcp_tool_call). */
async function mcpServers(): Promise<LoopMcpServer[]> {
  const out: LoopMcpServer[] = [];
  try {
    await startLocalMcpServer().catch(() => undefined);
    const { port } = localMcpStatus();
    if (port) {
      const token = localMcpGenToken("glyphh-loop", 365).token;
      out.push({ name: "glyphh-app", url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` }, tag: "Glyphh" });
    }
  } catch (err) {
    console.warn("[glyphh-loop] local MCP unavailable:", err instanceof Error ? err.message : err);
  }
  const creds = await mcpCreds();
  if (creds) out.push({ name: "glyphh-gateway", url: `${creds.baseUrl.replace(/\/$/, "")}/mcp`, headers: { Authorization: `Bearer ${creds.token}` }, tag: "connection" });
  return out;
}

const loop = new GlyphhLoop({
  host: "desktop",
  gateway: gatewayCreds,
  mcpServers,
  baseUrlFor: (gw, scope) => bridgeWrap(gw.baseUrl, scope),
  warn: (m) => console.warn(m),
});

/** The stored-turn count the engine last seeded from, per chat: a jump of more
 *  than one exchange means another host (the terminal) wrote turns into the
 *  shared store, so the engine's copy is stale and re-seeds from the history. */
const seenTurns = new Map<string, number>();
/** Where each chat's frames go — the panel that started the turn, until
 *  another panel adopts the run (agent-live.ts re-points it here). */
const loopSenders = new Map<string, WebContents>();
registerRunRebinder((chatId, sender) => {
  if (!loop.has(chatId)) return { rebound: false, previous: null };
  const previous = loopSenders.get(chatId) ?? null;
  loopSenders.set(chatId, sender);
  return { rebound: true, previous };
});

export function glyphhLoopHas(chatId: string): boolean { return loop.has(chatId); }
export const isGlyphhApproval = (id: string): boolean => GlyphhLoop.isApproval(id);

export async function runGlyphhLoopTurn(sender: WebContents, p: LoopRunPayload, text: string): Promise<{ runId: string }> {
  // The model the panel picked, else the one the org requires; the engine
  // refuses in its own words when neither names one.
  const model = bareModel(p.model ?? "") || orgRequiredModel();
  const n = p.history?.length ?? 0;
  const prev = seenTurns.get(p.chatId);
  if (prev !== undefined && n - prev > 2) loop.forget(p.chatId);
  seenTurns.set(p.chatId, n);
  // The live-run ledger (agent-live.ts): marked running once the engine has
  // taken the turn, cleared on its done — and a turn that settled before run()
  // even returned is never marked at all.
  let finished = false;
  loopSenders.set(p.chatId, sender);
  const emit = (ev: LoopEvent & { runId: string }): void => {
    const { type, ...payload } = ev;
    if (type === "done") { finished = true; agentLive.done(p.chatId, ev.runId); loopSenders.delete(p.chatId); }
    else if (type === "delta") noteRunDelta(p.chatId, String((payload as { delta?: string }).delta ?? ""));
    const to = loopSenders.get(p.chatId) ?? sender;
    // The chat id IS the terminal's session id: the panel binds it per CLI, and
    // the >_ hop opens `glyphh --resume <id>` on the same conversation.
    const extra = type === "setup" ? { cliSessionId: p.chatId } : {};
    try { if (!to.isDestroyed()) to.send(`glyphh-agent:${type}`, { ...payload, ...extra }); } catch { /* window closed */ }
  };
  const started = await loop.run({
    chatId: p.chatId, text, model,
    ...(p.permission ? { permission: p.permission } : {}),
    ...(p.workdir ? { workdir: p.workdir } : {}),
    ...(p.workspace ? { workspace: p.workspace } : {}),
    ...(p.history ? { history: p.history } : {}),
  }, emit);
  if (!finished) agentLive.start({ chatId: p.chatId, cliSessionId: p.chatId, cli: "glyphh", runId: started.runId, senderId: sender.id });
  return started;
}

export function stopGlyphhLoop(chatId: string): boolean { return loop.stop(chatId); }
export function setGlyphhLoopPermission(chatId: string, permission: LoopPermission): boolean { return loop.setPermission(chatId, permission); }
export function respondGlyphhApproval(id: string, allow: boolean): boolean { return loop.respondApproval(id, allow); }

/** Sign-out: nothing of the last member's conversations stays in memory. */
export function forgetGlyphhLoops(): void { loop.forgetAll(); seenTurns.clear(); }
