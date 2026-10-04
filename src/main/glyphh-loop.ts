/**
 * glyphh-loop.ts — THE GLYPHH LOOP in the desktop (his order, 2026-09-21): our
 * own agent loop, a supported loop beside claude/codex/gemini, on ANY model the
 * gateway serves. The ENGINE is the SDK's (`@glyphh/sdk/loop`, one loop for
 * every host — the `glyphh` CLI runs the same class); this file is the
 * desktop's seat: the member's gateway credential, the app's local MCP server
 * and the gateway's connection tools lent as MCP servers, memory read and
 * written natively (memory.ts, since the bridge went), and the loop's events
 * sent to the Agent panel on the renderer channels it listens to
 * (glyphh-agent:setup/delta/tool/approval/progress/permission/done/error).
 *
 * State is process memory (nothing of ours on disk); the chat re-seeds from the
 * renderer's stored turns after a restart and is forgotten on sign-out.
 */

import type { WebContents } from "electron";
import { GlyphhLoop, LOOP_EFFORTS, type LoopAgentDef, type LoopCatalogEntry, type LoopEvent, type LoopMcpServer, type LoopPermission, type LoopSkill, type SeedTurn } from "@glyphh/sdk/loop";
import { createHash } from "node:crypto";
import { listSkills } from "./skills-fs.js";
import { callAppTool, listInstalledAppTools } from "./glyphh-app-host.js";
import { callConnectionTool, listConnRows, listConnectionTools } from "./mcp-connections.js";
import { gatewayCreds, mcpCreds } from "./gateway-token.js";
import { memoryFacts, memoryCapture } from "./memory.js";
import { startLocalMcpServer, localMcpStatus, localMcpGenToken } from "./local-mcp-server.js";
import { bareModel, connectionsAvailable, orgHasPlan, orgRequiredModel, refreshOrgModels } from "./org-models.js";
import { listAgents, onAgentsChanged } from "./local-agents.js";
import { onModelStateChanged } from "./model-watch.js";
import * as subagents from "./subagent-ledger.js";
import { agentLive, noteRunDelta, registerRunRebinder } from "./agent-live.js";
import { frameTargets } from "./attach-run-frames.js";
import { attachmentImageRefs, attachmentInlineText, attachmentPromptBlock, validAttachments, type AttachRef } from "./glyphh-agent-attachments.js";
import { commitBackgroundTurn } from "./agent-ipc.js";
import { lendSplit } from "./mcp-lend.js";

export type { LoopPermission };

export interface LoopRunPayload {
  chatId: string;
  permission?: LoopPermission;
  model?: string;
  /** The composer's effort dial (his order, 2026-10-04). Any name the SDK
   *  does not know is ignored, and the turn runs on the chat's last effort. */
  effort?: string;
  workdir?: string;
  workspace?: string;
  /** The chat's stored turns, to seed a conversation this process has not seen. */
  history?: SeedTurn[];
  /** What the composer attached: images ride as vision blocks, files and
   *  folders as a manifest the loop's read tools open. */
  attachments?: AttachRef[];
  /** THE THREAD'S TYPE (his order, 2026-09-29): Work or Code. It decides the
   *  fixed belt the engine puts on the wire (CORE below; Code adds the file and
   *  shell builtins). Everything else is found with find_tools in both. */
  space?: "work" | "code";
}

/**
 * THE FIXED BELTS (his order, 2026-09-29: "this list of tools can get massive
 * with connections also. So how should we handle this for scale?").
 *
 * What rides every message is the SAME SIZE however much is installed or
 * connected: the file and shell builtins (Code), these few Glyphh tools, and
 * the engine's find_tools / call_tool pair. Everything else — tasks,
 * schedules, memory, layouts, tabs, agents, each installed app's tools, the
 * member's own MCP connections, every connected account — is in the catalog,
 * found by search and run by name (@glyphh/sdk/loop catalog.ts). It is the
 * desktop's design before the rebuild (per-mode packs, 8802425b; the
 * find_tools escape hatch, 095dcf48; search-first connectors, aef8d0f6).
 */
const CORE: Readonly<{ work: ReadonlySet<string>; code: ReadonlySet<string> }> = {
  work: new Set(["panels_open", "panels_list", "panels_close", "panels_available", "rpa_read", "rpa_screenshot", "settings_open", "skill_get"]),
  code: new Set(["panels_open", "panels_list", "panels_close", "rpa_screenshot", "settings_open", "skill_get"]),
};

const safe = (s: string): string => s.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
const asText = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

/** Each installed app's tools, and each of the member's own MCP connections'
 *  tools, as catalog entries. A connection that will not answer in a few
 *  seconds simply has no entries this time. */
async function catalogEntries(): Promise<LoopCatalogEntry[]> {
  const out: LoopCatalogEntry[] = [];
  const apps = await listInstalledAppTools().catch(() => []);
  for (const a of apps) {
    for (const t of a.tools) {
      out.push({
        name: safe(`${a.app}_${t.name}`), description: (t.description || `${a.name}: ${t.name}`).slice(0, 1000), family: `app: ${a.name}`,
        ...(t.inputSchema ? { inputSchema: t.inputSchema } : {}),
        run: async (args) => {
          try { return { text: asText(await callAppTool(a.app, t.name, args)), failed: false }; }
          catch (err) { return { text: err instanceof Error ? err.message : String(err), failed: true }; }
        },
      });
    }
  }
  if (connectionsAvailable()) {
    const conns = await Promise.race([
      listConnectionTools().catch(() => []),
      new Promise<[]>((res) => setTimeout(() => res([]), 5000)),
    ]);
    for (const t of conns) {
      out.push({
        name: safe(`${t.connection}_${t.name}`), description: (t.description || t.name).slice(0, 1000), family: `connection: ${t.connection}`,
        ...(t.inputSchema && typeof t.inputSchema === "object" ? { inputSchema: t.inputSchema as Record<string, unknown> } : {}),
        run: async (args) => {
          try {
            const r = await callConnectionTool(t.connection, t.name, args) as { isError?: boolean };
            return { text: asText(r), failed: r?.isError === true };
          } catch (err) { return { text: err instanceof Error ? err.message : String(err), failed: true }; }
        },
      });
    }
  }
  return out;
}

/** The member's enabled skills, for the prompt's index (read with skill_get). */
async function skillIndex(): Promise<LoopSkill[]> {
  try {
    return listSkills("skill")
      // Not the house "glyphh" skill: it is written for OUTSIDE clients over MCP
      // (relay_ping, app_list_tools, connector_call) and would steer the loop to
      // tools it no longer carries. The loop's own prompt says how Glyphh works.
      .filter((sk) => sk.enabled && sk.id.slice(sk.id.indexOf(":") + 1) !== "glyphh")
      .map((sk) => ({ slug: sk.id.slice(sk.id.indexOf(":") + 1), name: sk.name, description: sk.description }));
  } catch { return []; }
}

/** WHAT IS INSTALLED, as one fingerprint: a skill, app, task or plugin added,
 *  removed, edited or switched, or a connection added or turned off, changes
 *  it, and the next turn of every chat rebuilds its belt and catalog. Read at
 *  each turn, so every way in (Discover, skill_save, a folder dropped in,
 *  the Skills page) is covered by the same check. */
let lastLibrary = "";
function libraryChanged(): boolean {
  let sig = "";
  try {
    const skills = listSkills(["skill", "app", "task", "plugin"]).map((sk) => `${sk.id}:${sk.updatedAt}:${sk.enabled ? 1 : 0}`).sort();
    const conns = listConnRows().map((c) => `${c.slug}:${c.enabled ? 1 : 0}:${c.hiddenTools.join(",")}`).sort();
    sig = createHash("sha1").update([...skills, "|", ...conns].join("\n")).digest("hex");
  } catch { return false; }
  if (sig === lastLibrary) return false;
  const first = lastLibrary === "";
  lastLibrary = sig;
  return !first;
}

/** The servers this desktop lends a run: the app's own local MCP (this
 *  machine's windows, folders and loopback apps) and the gateway's /mcp (the
 *  member's library, the cloud clock, the app instances on the farm, the
 *  connected accounts' lookup pair). The names collide by design and
 *  mcp-lend.ts says who answers which; with the connections lane off neither
 *  side lends anything that bills through Pipedream. */
async function mcpServers(): Promise<LoopMcpServer[]> {
  const out: LoopMcpServer[] = [];
  const connections = connectionsAvailable();
  const local = await startLocalMcpServer().then(() => localMcpStatus().port).catch((err) => {
    console.warn("[glyphh-loop] local MCP unavailable:", err instanceof Error ? err.message : err);
    return 0;
  });
  const creds = await mcpCreds().catch(() => null);
  const split = lendSplit({ localUp: local > 0, gatewayUp: !!creds, connections, belt: new Set([...CORE.work, ...CORE.code]) });
  if (local > 0) {
    const token = localMcpGenToken("glyphh-loop", 365).token;
    out.push({
      name: "glyphh-app", url: `http://127.0.0.1:${local}/mcp`,
      headers: { Authorization: `Bearer ${token}` }, tag: "Glyphh", core: CORE, allow: split.local,
    });
  }
  if (creds) out.push({ name: "glyphh-gateway", url: `${creds.baseUrl.replace(/\/$/, "")}/mcp`, headers: { Authorization: `Bearer ${creds.token}` }, tag: "connection", allow: split.gateway });
  if (!connections) console.warn("[glyphh-loop] connections lane off for this org — no connector tools lent");
  return out;
}

/**
 * THE MEMBER'S OWN AGENTS, as definitions the loop can spawn (his order,
 * 2026-09-29: "I just want the local agent to spawn sub-agents for now based on
 * definitions the user can create with model slots running our full agent
 * loop").
 *
 * These are the agent records that already exist — a name, a standing prompt
 * and a model slot (local-agents.ts) — so a member defines a sub-agent where
 * they always defined an agent, and nothing new has to be invented or stored.
 * An agent with no prompt is not a brief, and the engine drops it; a member
 * with no agents gets no spawn tool at all.
 */
async function agentDefs(): Promise<LoopAgentDef[]> {
  try {
    return listAgents()
      .filter((a) => String(a.prompt || "").trim())
      .map((a) => ({
        slug: a.slug,
        name: a.name || a.slug,
        description: a.description || "",
        prompt: a.prompt,
        // Its own model, bare (records hold catalog ids); empty runs it on the
        // parent's model, which is the honest default for "no slot chosen".
        ...(bareModel(a.model ?? "") ? { model: bareModel(a.model) } : {}),
      }));
  } catch (err) {
    console.warn("[glyphh-loop] agent roster unreadable:", err instanceof Error ? err.message : err);
    return [];
  }
}

const loop = new GlyphhLoop({
  host: "desktop",
  gateway: gatewayCreds,
  mcpServers,
  agents: agentDefs,
  catalog: catalogEntries,
  skills: skillIndex,
  facts: memoryFacts,
  capture: memoryCapture,
  warn: (m) => console.warn(m),
});
// An agent made or removed anywhere is on the next turn of every open chat.
onAgentsChanged(() => loop.invalidateTools());
// THE CONNECTIONS LANE MOVED on the server (the org's Pipedream switch): the
// next run lends, or withholds, the connector tools accordingly.
let connectionsLent = connectionsAvailable();
onModelStateChanged((c) => {
  if (c.connectionsOn === connectionsLent) return;
  connectionsLent = c.connectionsOn;
  loop.invalidateTools();
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
  // refuses in its own words when neither names one. With neither (or no plan
  // on record) the org's answer is read fresh first: a person who just signed
  // up, or just bought a plan, must not be judged on the last account's gates.
  const picked = bareModel(p.model ?? "");
  if ((!picked && !orgRequiredModel()) || !orgHasPlan()) await refreshOrgModels().catch(() => undefined);
  const model = picked || orgRequiredModel();
  const n = p.history?.length ?? 0;
  const prev = seenTurns.get(p.chatId);
  if (prev !== undefined && n - prev > 2) loop.forget(p.chatId);
  seenTurns.set(p.chatId, n);
  // THE LEDGER IS MARKED FROM THE STREAM (his report, 2026-09-29: "the left
  // rail should show the flashing green dot"). It used to be marked AFTER
  // `await loop.run(...)` — but the engine's run resolves when the turn is
  // OVER, so a running turn was never on the ledger at all and no other
  // surface could show it. The engine's own events are the truth:
  //
  //   setup    → working (green): the turn has a model and is on the wire
  //   approval → waiting (yellow): it is on the person now
  //   delta    → working: the person answered and it is moving again
  //   error    → error (red): kept after done, so an idle row can still say so
  //   done     → clear (grey), unless the turn failed
  loopSenders.set(p.chatId, sender);
  const mark = (status: "working" | "waiting" | "error", runId: string): void => {
    if (status === "working" && !agentLive.list().some((r) => r.chatId === p.chatId && r.status !== "error")) {
      agentLive.start({ chatId: p.chatId, cliSessionId: p.chatId, cli: "glyphh", runId, senderId: sender.id });
      return;
    }
    agentLive.update(p.chatId, { status, runId, senderId: sender.id });
  };
  // The turn's own words, for a done nobody is listening to (below).
  let answer = "";
  const emit = (ev: LoopEvent & { runId: string; agent?: { childId: string; slug: string; name: string; model: string } }): void => {
    const { type, ...payload } = ev;
    // A SUB-AGENT'S WORDS ARE NOT THE ANSWER (his order, 2026-09-29): a child's
    // deltas are its own feed, so they must never join the parent's reply or
    // the turn's committed text — the person would read the swarm's thinking
    // spliced into one answer. They still reach the panel, tagged, and the
    // Agents panel renders them under the child that said them.
    const child = !!ev.agent;
    // THE AGENTS PANEL'S FEED (his order, 2026-09-29): every sub-agent frame is
    // written to main's ledger as well as sent on, because the panel that shows
    // the swarm is not the panel that started the turn.
    if (ev.agent) {
      if (type === "agent") {
        const a = ev as unknown as { phase: "start" | "done"; task?: string; failed?: boolean; summary?: string };
        if (a.phase === "start") subagents.start(ev.agent, p.chatId, ev.runId, String(a.task ?? ""));
        else subagents.finish(ev.agent, !!a.failed, String(a.summary ?? ""));
      } else if (type === "delta") {
        subagents.text(ev.agent, String((payload as { delta?: string }).delta ?? ""));
      } else if (type === "tool") {
        const t = payload as { phase: "start" | "done"; name?: string; title?: string; failed?: boolean; preview?: string; detail?: unknown; input?: string; output?: string };
        subagents.tool(ev.agent, t.phase, String(t.name ?? ""), String(t.title ?? t.name ?? ""), t.failed, t.preview, { detail: t.detail, input: t.input, output: t.output });
      } else if (type === "approval") {
        subagents.approval(ev.agent, String((payload as { title?: string }).title ?? ""));
      }
    }
    if (type === "setup") mark("working", ev.runId);
    else if (type === "approval") mark("waiting", ev.runId);
    else if (type === "error" && !child) mark("error", ev.runId);
    if (type === "done") {
      agentLive.done(p.chatId, ev.runId);
      // The Agents panel shows a swarm while its parent works (his order,
      // 2026-09-29): the parent's turn is over, so its sub-agents go.
      if (!child) subagents.endRun(ev.runId);
    }
    else if (type === "delta" && !child) {
      const d = String((payload as { delta?: string }).delta ?? "");
      answer += d;
      noteRunDelta(p.chatId, d);
      mark("working", ev.runId);
    }
    const to = loopSenders.get(p.chatId) ?? sender;
    // NOBODY IS LISTENING (his order, 2026-09-29): the panel that started this
    // turn is gone, so the renderer that would have committed the answer on
    // `done` no longer exists. Main writes it into the shared store instead —
    // the thread kept working and the conversation shows it.
    if (type === "done" && (!to || to.isDestroyed())) commitBackgroundTurn(p.chatId, answer);
    if (type === "done") loopSenders.delete(p.chatId);
    // The chat id IS the terminal's session id: the panel binds it per CLI, and
    // the >_ hop opens `glyphh --resume <id>` on the same conversation.
    const extra = type === "setup" ? { cliSessionId: p.chatId } : {};
    // A relayed turn's originator (the web, the phone) keeps its frames even
    // after a desktop panel adopts the thread (attach-run-frames.ts frameTargets).
    for (const target of frameTargets(sender, to)) {
      try { if (!target.isDestroyed()) target.send(`glyphh-agent:${type}`, { ...payload, ...extra }); } catch { /* window closed */ }
    }
  };
  // ATTACHMENTS (the composer's paperclip, paste and drop). Images always
  // become real vision blocks. A file reaches the turn one of two ways, and the
  // thread's TYPE decides which (his push-back, 2026-09-29):
  //   CODE — a path manifest: its read tools open the file themselves, which
  //          beats pouring a large file into every turn of the conversation.
  //   WORK — the content, inlined: that belt has no read tools, so a path would
  //          be a promise it cannot keep.
  // A FREE ORG RUNS TOO (his order, 2026-10-04): the server lists only the
  // free-plan models for it, and the gateway refuses any other with a 402 the
  // panel draws as the plan card. Nothing is judged here before the model.
  // Something installed or removed since the last turn: every chat rebuilds its belt.
  if (libraryChanged()) loop.invalidateTools();
  const atts = validAttachments(p.attachments);
  const files = atts.filter((a) => a.kind !== "image");
  const manifest = p.space === "work" ? attachmentInlineText(files) : attachmentPromptBlock(files);
  const images = attachmentImageRefs(atts).map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.mediaType, data: im.data } }));
  const effort = LOOP_EFFORTS.find((e) => e === p.effort);
  const started = await loop.run({
    chatId: p.chatId, text: [text, manifest].filter(Boolean).join("\n\n"), model,
    ...(images.length ? { images } : {}),
    ...(effort ? { effort } : {}),
    ...(p.space ? { space: p.space } : {}),
    ...(p.permission ? { permission: p.permission } : {}),
    ...(p.workdir ? { workdir: p.workdir } : {}),
    ...(p.workspace ? { workspace: p.workspace } : {}),
    ...(p.history ? { history: p.history } : {}),
  }, emit);
  return started;
}

/**
 * A TURN WITH NO PANEL — a schedule firing, a skill run, a task's slot (his
 * order, 2026-09-28: unattended work used to shell out to a vendor CLI; now it
 * rides the same loop the panel does). The answer comes back as text.
 *
 * Unattended means no one can answer an approval, so the run is `auto`: the
 * user put this program on a clock, and a prompt nobody can see would just
 * hang it. The thread is forgotten as soon as it answers.
 */
export async function runGlyphhHeadless(
  prompt: string,
  opts: { model?: string; workdir?: string } = {},
): Promise<{ ok: boolean; text: string; error?: string }> {
  const chatId = `headless-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let text = "";
  let error = "";
  try {
    await loop.run({
      chatId, text: prompt, model: bareModel(opts.model ?? "") || orgRequiredModel(), permission: "auto",
      ...(opts.workdir ? { workdir: opts.workdir } : {}),
    }, (ev) => {
      if (ev.type === "delta") text += String((ev as { delta?: string }).delta ?? "");
      else if (ev.type === "error") error = String((ev as { error?: string }).error ?? "");
    });
  } finally {
    loop.forget(chatId);
  }
  return error ? { ok: false, text, error } : { ok: true, text };
}

export function stopGlyphhLoop(chatId: string): boolean { return loop.stop(chatId); }
/** The chat's spend so far, for the composer's context meter. */
export function glyphhLoopUsage(chatId: string): { inTokens: number; outTokens: number; cacheRead: number } { return loop.usage(chatId); }
/** /compact from the composer: the model summarizes and the chat continues. */
export function compactGlyphhLoop(chatId: string): Promise<{ ok: boolean; error?: string }> { return loop.compactNow(chatId); }
export function setGlyphhLoopPermission(chatId: string, permission: LoopPermission): boolean { return loop.setPermission(chatId, permission); }
export function respondGlyphhApproval(id: string, allow: boolean): boolean { return loop.respondApproval(id, allow); }

/** Sign-out: nothing of the last member's conversations stays in memory. */
export function forgetGlyphhLoops(): void { loop.forgetAll(); seenTurns.clear(); }
