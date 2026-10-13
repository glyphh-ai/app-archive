/**
 * subagent-ledger.ts — WHAT EVERY SUB-AGENT IS DOING, in one place (his order,
 * 2026-09-29: "I want a work panel for these like Files, Plans, etc. Agents.
 * Each agent is an expandable div with its feed under the div as it works…
 * listing tool calls etc.").
 *
 * The engine's frames go to ONE renderer: the agent panel that started the
 * turn. The Agents work panel lives in the workbench, a different document,
 * and a second agent panel may be showing another thread's swarm — so the feed
 * cannot live in whoever happened to hear it. Main keeps it, and every surface
 * reads the same answer.
 *
 * WHAT IT HOLDS IS WHAT IS HAPPENING (his correction, 2026-09-29: "the Agents
 * panel you made is just the list of agents running at any given time tied to
 * an active glyphh agent panel as the parent id"). A sub-agent lives here from
 * its start until its PARENT'S TURN ends: a child that finished while the rest
 * of the swarm works stays, so its answer can still be read, and the whole
 * set goes the moment the parent is done. No history, nothing to clear.
 *
 * Process memory only (the zero-local-storage law). Bounded by the engine's
 * per-run spawn cap and the feed cap per agent.
 */

import { ipcMain } from "electron";
import { broadcast } from "./broadcast.js";

export interface SubAgentRef { childId: string; slug: string; name: string; model: string }

export type SubAgentStatus = "working" | "waiting" | "done" | "failed";

export type SubAgentFeedEntry =
  | { at: number; kind: "text"; text: string }
  | {
      at: number; kind: "tool"; title: string; name: string; state: "running" | "done" | "failed"; preview?: string;
      /** What the step did (the engine's ToolDetail) and a lent tool's I/O —
       *  the Agents panel draws a child's steps the way the thread draws the
       *  main agent's. */
      detail?: unknown; input?: string; output?: string; endedAt?: number;
    }
  | { at: number; kind: "approval"; title: string };

export interface SubAgentRun {
  childId: string;
  parentChatId: string;
  runId: string;
  slug: string;
  name: string;
  model: string;
  task: string;
  status: SubAgentStatus;
  startedAt: number;
  endedAt: number | null;
  summary: string | null;
  feed: SubAgentFeedEntry[];
}

const MAX_FEED = 400;
const BROADCAST_MS = 150;

const runs = new Map<string, SubAgentRun>();

let timer: ReturnType<typeof setTimeout> | null = null;
/** Deltas arrive per token; the panel needs a frame, not a firehose. */
function announce(): void {
  if (timer) return;
  timer = setTimeout(() => { timer = null; broadcast("subagents:update", list()); }, BROADCAST_MS);
}

function push(r: SubAgentRun, e: SubAgentFeedEntry): void {
  r.feed.push(e);
  if (r.feed.length > MAX_FEED) r.feed.splice(0, r.feed.length - MAX_FEED);
}

/** Oldest first within a parent — the order the main agent handed work out. */
export function list(): SubAgentRun[] {
  return [...runs.values()].sort((a, b) => a.startedAt - b.startedAt);
}

export function start(ref: SubAgentRef, parentChatId: string, runId: string, task: string): void {
  runs.set(ref.childId, {
    childId: ref.childId, parentChatId, runId, slug: ref.slug, name: ref.name, model: ref.model,
    task, status: "working", startedAt: Date.now(), endedAt: null, summary: null, feed: [],
  });
  announce();
}

/** The parent's turn is over: its swarm leaves the panel with it. */
export function endRun(runId: string): void {
  let gone = false;
  for (const [id, r] of runs) if (r.runId === runId) { runs.delete(id); gone = true; }
  if (gone) announce();
}

export function finish(ref: SubAgentRef, failed: boolean, summary: string): void {
  const r = runs.get(ref.childId);
  if (!r) return;
  r.status = failed ? "failed" : "done";
  r.endedAt = Date.now();
  r.summary = summary;
  // A step still marked running when its agent is over did not finish.
  for (const e of r.feed) if (e.kind === "tool" && e.state === "running") e.state = "failed";
  announce();
}

/** Streamed words join the agent's last text entry rather than becoming one
 *  entry per token. */
export function text(ref: SubAgentRef, delta: string): void {
  const r = runs.get(ref.childId);
  if (!r || !delta) return;
  const last = r.feed[r.feed.length - 1];
  if (last?.kind === "text") last.text += delta;
  else push(r, { at: Date.now(), kind: "text", text: delta });
  if (r.status === "waiting") r.status = "working";
  announce();
}

export function tool(
  ref: SubAgentRef, phase: "start" | "done", name: string, title: string, failed?: boolean, preview?: string,
  extra?: { detail?: unknown; input?: string; output?: string },
): void {
  const r = runs.get(ref.childId);
  if (!r) return;
  if (phase === "start") {
    push(r, { at: Date.now(), kind: "tool", title, name, state: "running" });
  } else {
    // The matching open step, newest first: several tools run at once.
    const open = [...r.feed].reverse().find((e): e is Extract<SubAgentFeedEntry, { kind: "tool" }> =>
      e.kind === "tool" && e.state === "running" && e.title === title);
    const more = {
      ...(extra?.detail ? { detail: extra.detail } : {}),
      ...(extra?.input ? { input: extra.input } : {}),
      ...(extra?.output ? { output: extra.output } : {}),
    };
    if (open) {
      open.state = failed ? "failed" : "done";
      open.endedAt = Date.now();
      if (preview) open.preview = preview;
      Object.assign(open, more);
    } else {
      push(r, { at: Date.now(), endedAt: Date.now(), kind: "tool", title, name, state: failed ? "failed" : "done", ...(preview ? { preview } : {}), ...more });
    }
  }
  if (r.status === "waiting") r.status = "working";
  announce();
}

export function approval(ref: SubAgentRef, title: string): void {
  const r = runs.get(ref.childId);
  if (!r) return;
  r.status = "waiting";
  push(r, { at: Date.now(), kind: "approval", title });
  announce();
}

export function registerSubAgentIpc(): void {
  ipcMain.handle("subagents-list", () => list());
}
