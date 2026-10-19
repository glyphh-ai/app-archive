/**
 * subagent-feed.ts — THE SWARM VIEW BUILT FROM WIRE FRAMES (his report,
 * 2026-10-05: "on the web the agents stream is not coming through to the
 * Agents work panel").
 *
 * On the desktop a local turn's sub-agents live in main's ledger
 * (main/subagent-ledger.ts) and the Agents panel reads them over IPC. A turn
 * that reaches this renderer as RELAY FRAMES — the web driving the attached
 * desktop, a cloud run, a run observed from elsewhere — has no main to ask, so
 * this feed keeps the same rows (the ledger's SubAgentRun shape, the same
 * rules) from the `agent` start/done frames and the child-tagged delta /
 * thinking / tool / approval frames remote-run.ts hands onAgentFrame. The
 * Agents panel (agents-panel.ts) merges both sources into one list.
 *
 * Same life as the ledger: a child lives from its start until its PARENT'S
 * TURN ends (endParent); a finished child stays readable while its siblings
 * work. Process memory only, bounded per agent.
 */

import type { SubAgentRef, SubAgentWireFrame } from "./run-frames.js";

export type SubAgentStatus = "working" | "waiting" | "done" | "failed";

export type SubAgentFeedEntry =
  | { at: number; kind: "text"; text: string }
  | { at: number; kind: "tool"; title: string; name: string; state: "running" | "done" | "failed"; preview?: string; detail?: unknown; input?: string; output?: string; endedAt?: number }
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
const ANNOUNCE_MS = 150;

export interface SubAgentFeed {
  /** One frame of the swarm under `parentChatId` (the chat the turn runs on). */
  apply(parentChatId: string, frame: SubAgentWireFrame): void;
  /** The parent's turn is over: its swarm leaves. */
  endParent(parentChatId: string): void;
  /** Oldest first — the order the main agent handed work out. */
  list(): SubAgentRun[];
  /** Repaints, throttled to a frame rather than a token. */
  subscribe(cb: (runs: SubAgentRun[]) => void): () => void;
}

export function createSubAgentFeed(now: () => number = Date.now, schedule: (fn: () => void, ms: number) => void = (fn, ms) => { setTimeout(fn, ms); }): SubAgentFeed {
  const runs = new Map<string, SubAgentRun>();
  const subs = new Set<(runs: SubAgentRun[]) => void>();
  let pending = false;

  const list = (): SubAgentRun[] => [...runs.values()].sort((a, b) => a.startedAt - b.startedAt);
  const announce = (): void => {
    if (pending || !subs.size) return;
    pending = true;
    schedule(() => { pending = false; const rows = list(); for (const cb of [...subs]) { try { cb(rows); } catch { /* subscriber's problem */ } } }, ANNOUNCE_MS);
  };
  const push = (r: SubAgentRun, e: SubAgentFeedEntry): void => {
    r.feed.push(e);
    if (r.feed.length > MAX_FEED) r.feed.splice(0, r.feed.length - MAX_FEED);
  };
  const working = (r: SubAgentRun): void => { if (r.status === "waiting") r.status = "working"; };

  const start = (ref: SubAgentRef, parentChatId: string, runId: string, task: string): void => {
    runs.set(ref.childId, {
      childId: ref.childId, parentChatId, runId, slug: ref.slug, name: ref.name, model: ref.model,
      task, status: "working", startedAt: now(), endedAt: null, summary: null, feed: [],
    });
  };
  const finish = (r: SubAgentRun, failed: boolean, summary: string): void => {
    r.status = failed ? "failed" : "done";
    r.endedAt = now();
    r.summary = summary;
    // A step still marked running when its agent is over did not finish.
    for (const e of r.feed) if (e.kind === "tool" && e.state === "running") e.state = "failed";
  };
  const text = (r: SubAgentRun, delta: string): void => {
    if (!delta) return;
    const last = r.feed[r.feed.length - 1];
    // Streamed words join the agent's last text entry, not one entry per token.
    if (last?.kind === "text") last.text += delta;
    else push(r, { at: now(), kind: "text", text: delta });
    working(r);
  };
  const tool = (r: SubAgentRun, f: Extract<SubAgentWireFrame, { type: "tool" }>): void => {
    const name = String(f.name ?? "");
    const title = String(f.title ?? name);
    if (f.phase === "start") {
      push(r, { at: now(), kind: "tool", title, name, state: "running" });
    } else {
      // The matching open step, OLDEST first: several tools run at once and
      // finish in any order (the ledger's rule).
      const open = r.feed.find((e): e is Extract<SubAgentFeedEntry, { kind: "tool" }> => e.kind === "tool" && e.state === "running" && e.title === title);
      const failed = !!(f.failed || f.denied);
      const more = {
        ...(f.detail ? { detail: f.detail } : {}),
        ...(f.input ? { input: f.input } : {}),
        ...(f.output ? { output: f.output } : {}),
        ...(f.preview ? { preview: String(f.preview) } : {}),
      };
      if (open) Object.assign(open, { state: failed ? "failed" : "done", endedAt: now() }, more);
      else push(r, { at: now(), endedAt: now(), kind: "tool", title, name, state: failed ? "failed" : "done", ...more });
    }
    working(r);
  };

  return {
    apply(parentChatId, frame) {
      if (frame.type === "agent") {
        if (frame.phase === "start") start(frame.agent, parentChatId, frame.runId, String(frame.task ?? ""));
        else { const r = runs.get(frame.agent.childId); if (r) finish(r, !!frame.failed, String(frame.summary ?? "")); }
        announce();
        return;
      }
      const r = runs.get(frame.agent.childId);
      if (!r) return;
      if (frame.type === "delta") text(r, String(frame.delta ?? ""));
      else if (frame.type === "tool") tool(r, frame);
      else if (frame.type === "approval") { r.status = "waiting"; push(r, { at: now(), kind: "approval", title: String(frame.title ?? "") }); }
      else return; // thinking and the rest: not drawn in the feed
      announce();
    },
    endParent(parentChatId) {
      let gone = false;
      for (const [id, r] of runs) if (r.parentChatId === parentChatId) { runs.delete(id); gone = true; }
      if (gone) announce();
    },
    list,
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
  };
}

/** The renderer's one feed — code.ts writes it, agents-panel.ts reads it. */
export const subAgentFeed: SubAgentFeed = createSubAgentFeed();
