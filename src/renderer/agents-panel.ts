/**
 * agents-panel.ts — THE AGENTS WORK PANEL (his order, 2026-09-29: "I want a
 * work panel for these like Files, Plans, etc. Agents. Each agent is an
 * expandable div with its feed under the div as it works. For now that will
 * work. Listing tool calls etc.").
 *
 * The agents running under a LIVE Glyphh session, grouped by that session —
 * its parent (his correction, 2026-09-29: "just the list of agents running at
 * any given time tied to an active glyphh agent panel as the parent id"). Each
 * row: its state dot, its name, the model it runs on, what it was asked, and —
 * expanded — its own feed as it works, every tool it runs with the result. A
 * swarm leaves with its parent's turn. The definitions are Settings → Build →
 * Agents (help/settings-agents.ts). TWO SOURCES, one list: main's ledger (a
 * local turn on this desktop, over IPC) and the renderer's own feed
 * (help/subagent-feed.ts — a turn that arrives as relay frames: the web
 * driving the attached desktop, a cloud run, an observed run).
 *
 * A working agent opens itself; one that finished folds unless the person
 * opened it. The person's own open/closed choice always wins over that rule.
 */

import { formatMarkdown } from "./format-markdown.js";
import { stepEl, type ToolDetail } from "./help/tool-view.js";
import { subAgentFeed } from "./help/subagent-feed.js";

interface FeedText { at: number; kind: "text"; text: string }
interface FeedTool {
  at: number; kind: "tool"; title: string; name: string; state: "running" | "done" | "failed"; preview?: string;
  detail?: ToolDetail; input?: string; output?: string; endedAt?: number;
}
interface FeedApproval { at: number; kind: "approval"; title: string }
type FeedEntry = FeedText | FeedTool | FeedApproval;

interface SubAgentRun {
  childId: string;
  parentChatId: string;
  runId: string;
  slug: string;
  name: string;
  model: string;
  task: string;
  status: "working" | "waiting" | "done" | "failed";
  startedAt: number;
  endedAt: number | null;
  summary: string | null;
  feed: FeedEntry[];
}

interface LedgerApi {
  subAgentsList?: () => Promise<unknown[]>;
  onSubAgentsUpdate?: (cb: (runs: unknown[]) => void) => () => void;
}
const api = (): LedgerApi => ((window as unknown as { glyphh?: LedgerApi }).glyphh ?? {});

const STATUS_TITLE: Record<SubAgentRun["status"], string> = {
  working: "Working",
  waiting: "Waiting on you",
  done: "Done",
  failed: "Failed",
};

const CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>`;
const asRuns = (raw: unknown[]): SubAgentRun[] =>
  raw.filter((r): r is SubAgentRun => !!r && typeof r === "object" && typeof (r as SubAgentRun).childId === "string");

function elapsed(r: SubAgentRun): string {
  const ms = (r.endedAt ?? Date.now()) - r.startedAt;
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function steps(r: SubAgentRun): number {
  return r.feed.filter((e) => e.kind === "tool").length;
}

function metaText(r: SubAgentRun): string {
  const n = steps(r);
  return `${n ? `${n} step${n === 1 ? "" : "s"} · ` : ""}${elapsed(r)}`;
}

function feedEl(r: SubAgentRun, stepOpen: Map<string, boolean>, repaint: () => void): HTMLElement {
  const box = document.createElement("div");
  box.className = "agp-feed";
  const ask = document.createElement("div");
  ask.className = "agp-task";
  ask.textContent = r.task || "(no task given)";
  box.appendChild(ask);
  r.feed.forEach((e, idx) => {
    if (e.kind === "text") {
      const t = document.createElement("div");
      t.className = "agp-text code-agent-text";
      t.innerHTML = formatMarkdown(e.text);
      box.appendChild(t);
    } else if (e.kind === "tool") {
      // A CHILD'S STEPS DRAW LIKE THE MAIN AGENT'S (tool-view.ts): the same
      // foldable rows, the same diffs and command output. Consecutive steps
      // share one bordered list.
      let list = box.lastElementChild as HTMLElement | null;
      if (!list?.classList.contains("tv-steps")) {
        list = document.createElement("div");
        list.className = "tv-steps";
        box.appendChild(list);
      }
      const key = `${r.childId}:${idx}`;
      const open = stepOpen.get(key) ?? e.state === "failed";
      list.appendChild(stepEl({
        name: e.name, title: e.title || e.name, state: e.state, startedAt: e.at,
        ...(e.endedAt ? { endedAt: e.endedAt } : {}),
        ...(e.detail ? { detail: e.detail } : {}),
        ...(e.input ? { input: e.input } : {}),
        ...(e.output ? { output: e.output } : {}),
        ...(e.preview ? { preview: e.preview } : {}),
      }, open, () => { stepOpen.set(key, !open); repaint(); }));
    } else {
      const a = document.createElement("div");
      a.className = "agp-approval";
      a.textContent = `Asked to ${e.title}`;
      box.appendChild(a);
    }
  });
  if (r.status === "working" && !r.feed.length) {
    const w = document.createElement("div");
    w.className = "agp-starting";
    w.textContent = "Starting…";
    box.appendChild(w);
  }
  return box;
}

/** Mount the panel into a work-panel body. Returns an unmount. */
export function mountAgentsPanel(body: HTMLElement): () => void {
  body.classList.add("agp-body");
  body.innerHTML = "";

  // JUST THE SWARM (his correction, 2026-09-29): the agents running under a
  // live Glyphh session, grouped by the session that asked. Making agents is
  // Settings → Build → Agents; nothing here edits them.
  const head = document.createElement("div");
  head.className = "agp-head";
  const count = document.createElement("span");
  count.className = "agp-count";
  head.appendChild(count);
  const list = document.createElement("div");
  list.className = "agp-list";
  body.append(head, list);

  let runs: SubAgentRun[] = [];
  // The person's own open/closed choice, per agent and per step — it outranks
  // the rules (a working agent opens itself, a failed step shows its output).
  const chosen = new Map<string, boolean>();
  const stepOpen = new Map<string, boolean>();
  const isOpen = (r: SubAgentRun): boolean => chosen.get(r.childId) ?? (r.status === "working" || r.status === "waiting");

  // The parent's NAME is the session's title, read from the shared store; an
  // id the store has not seen yet is fetched again on the next paint.
  const titles = new Map<string, string>();
  let fetching = false;
  const learnTitles = (): void => {
    if (fetching || runs.every((r) => titles.has(r.parentChatId))) return;
    fetching = true;
    const g = (window as unknown as { glyphh?: { glyphhSessionsLoad?: () => Promise<{ chats?: Array<{ id?: string; title?: string }> } | null> } }).glyphh;
    void (g?.glyphhSessionsLoad?.() ?? Promise.resolve(null)).then((snap) => {
      for (const c of snap?.chats ?? []) if (c?.id) titles.set(c.id, String(c.title || "Untitled session"));
      for (const r of runs) if (!titles.has(r.parentChatId)) titles.set(r.parentChatId, "This session");
    }).catch(() => undefined).finally(() => { fetching = false; if (body.isConnected) paint(); });
  };

  const rowEl = (r: SubAgentRun, scrolled: Map<string, number>): HTMLElement => {
    const open = isOpen(r);
    const row = document.createElement("div");
    row.className = `agp-row ${r.status}${open ? " open" : ""}`;
    row.dataset.id = r.childId;
    const bar = document.createElement("button");
    bar.type = "button";
    bar.className = "agp-bar";
    bar.setAttribute("aria-expanded", open ? "true" : "false");
    bar.innerHTML = `<span class="agp-chev">${CHEVRON}</span>`;
    const dot = document.createElement("span");
    dot.className = `code-chat-dot agp-dot ${r.status === "working" ? "working" : r.status === "waiting" ? "waiting" : r.status === "failed" ? "failed" : ""}`;
    dot.title = STATUS_TITLE[r.status];
    const name = document.createElement("span");
    name.className = "agp-name";
    name.textContent = r.name;
    const model = document.createElement("span");
    model.className = "agp-model";
    model.textContent = r.model;
    const task = document.createElement("span");
    task.className = "agp-bar-task";
    // A finished agent's bar says how it ended — what it found, or why it
    // could not — which is what a person scanning the swarm wants to know.
    task.textContent = (r.status === "done" || r.status === "failed") && r.summary ? r.summary : r.task;
    const meta = document.createElement("span");
    meta.className = "agp-meta";
    meta.textContent = metaText(r);
    bar.append(dot, name, model, task, meta);
    bar.addEventListener("click", () => { chosen.set(r.childId, !open); paint(); });
    row.appendChild(bar);
    if (open) {
      const feed = feedEl(r, stepOpen, paint);
      row.appendChild(feed);
      const prev = scrolled.get(r.childId);
      // A working feed follows its newest line; one the person scrolled keeps its place.
      requestAnimationFrame(() => { feed.scrollTop = prev !== undefined && r.status !== "working" ? prev : feed.scrollHeight; });
    }
    return row;
  };

  const paint = (): void => {
    const live = runs.filter((r) => r.status === "working" || r.status === "waiting").length;
    const parents = new Set(runs.map((r) => r.parentChatId));
    count.textContent = runs.length
      ? `${live ? `${live} working` : "All done"} · ${runs.length} agent${runs.length === 1 ? "" : "s"}${parents.size > 1 ? ` under ${parents.size} sessions` : ""}`
      : "";
    // Keep each open feed's scroll: repaint replaces the rows.
    const scrolled = new Map<string, number>();
    list.querySelectorAll<HTMLElement>(".agp-row").forEach((row) => {
      const f = row.querySelector<HTMLElement>(".agp-feed");
      if (f && row.dataset.id) scrolled.set(row.dataset.id, f.scrollTop);
    });
    list.textContent = "";
    if (!runs.length) {
      const empty = document.createElement("div");
      empty.className = "agp-empty";
      empty.innerHTML = "<strong>No agents working.</strong><span>When Glyphh hands part of a job to one of your agents, it shows up here under the session that asked, with its own feed, while that session works.</span>";
      const make = document.createElement("button");
      make.type = "button";
      make.className = "agp-make";
      make.textContent = "Your agents in Settings → Build";
      make.addEventListener("click", () => {
        (window as unknown as { __glyphhOpenSettings?: (sub?: string) => void }).__glyphhOpenSettings?.("agents");
      });
      empty.appendChild(make);
      list.appendChild(empty);
      return;
    }
    learnTitles();
    // ONE GROUP PER PARENT, in the order their first agent started.
    const order = [...parents];
    for (const parentId of order) {
      const kids = runs.filter((r) => r.parentChatId === parentId);
      const group = document.createElement("div");
      group.className = "agp-group";
      const gh = document.createElement("div");
      gh.className = "agp-group-head";
      const t = document.createElement("span");
      t.className = "agp-group-title";
      t.textContent = titles.get(parentId) ?? "…";
      const n = document.createElement("span");
      n.className = "agp-group-count";
      const working = kids.filter((r) => r.status === "working" || r.status === "waiting").length;
      n.textContent = working ? `${working} of ${kids.length} working` : `${kids.length} done`;
      gh.append(t, n);
      group.appendChild(gh);
      for (const r of kids) group.appendChild(rowEl(r, scrolled));
      list.appendChild(group);
    }
  };

  let fromMain: unknown[] = [];
  let fromFeed: unknown[] = subAgentFeed.list();
  const merge = (): void => { runs = asRuns([...fromMain, ...fromFeed]).sort((a, b) => a.startedAt - b.startedAt); paint(); };
  let off: (() => void) | undefined;
  let offFeed: (() => void) | undefined;
  let tick = 0;
  const unmount = (): void => { off?.(); off = undefined; offFeed?.(); offFeed = undefined; window.clearInterval(tick); };
  // A work panel's body is torn down by whoever closes the card; the panel
  // lets go of its subscription and its clock the moment it is out of the page,
  // so a closed panel never keeps repainting into nothing.
  const alive = (): boolean => { if (body.isConnected) return true; unmount(); return false; };
  off = api().onSubAgentsUpdate?.((raw) => { if (!alive()) return; fromMain = Array.isArray(raw) ? raw : []; merge(); });
  offFeed = subAgentFeed.subscribe((rows) => { if (!alive()) return; fromFeed = rows; merge(); });
  void api().subAgentsList?.().then((raw) => { if (!alive()) return; fromMain = Array.isArray(raw) ? raw : []; merge(); }).catch(() => { if (alive()) paint(); });
  // The elapsed clocks tick in place — a full repaint every second would take
  // the person's text selection and scroll with it.
  tick = window.setInterval(() => {
    if (!alive()) return;
    for (const r of runs) {
      if (r.status !== "working" && r.status !== "waiting") continue;
      const meta = list.querySelector<HTMLElement>(`.agp-row[data-id="${CSS.escape(r.childId)}"] .agp-meta`);
      if (meta) meta.textContent = metaText(r);
    }
  }, 1000);
  merge();
  return unmount;
}
