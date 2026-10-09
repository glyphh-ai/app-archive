/**
 * bots-panel.ts — THE BOTS WORK PANEL (his order, 2026-10-08: "a native
 * WorkPanel called Bots that has a left rail, claude agent sdk loops for each
 * agent, and then the models those agents run on… an orchestrator then a
 * swarm under it… the funny cat characters we built"). It grew out of the
 * Agents panel (2026-09-29), which only showed the swarm under a live
 * session; that view is still here, under each bot.
 *
 * THE RAIL lists the member's bots — their agent records (Customize →
 * Agents): the orchestrators first, each with its cat, what runs it and its
 * model. A bot's cat shows its mood: generating while it or its swarm works,
 * curious while it waits on someone, done for a moment after.
 *
 * THE BODY is the selected bot: its head (the cat — click to pick another
 * body and colour —, name, role, runs-as, model, Edit), its THREAD (the
 * conversation with it, kept in the shared store as `bots/<slug>`; main/
 * bots.ts), its SWARM (the sub-agents it fanned out to, with their feeds),
 * and the composer. Asking runs the Glyphh loop on the bot's thread with its
 * brief in front: "the orchestrator is just a set of personality and
 * instructions we feed into the loop".
 *
 * TWO SOURCES feed the swarm, one list: main's ledger (a local turn, over
 * IPC) and the renderer's own feed (help/subagent-feed.ts — relay and cloud
 * frames).
 */

import { formatMarkdown } from "./format-markdown.js";
import { stepEl, type ToolDetail } from "./help/tool-view.js";
import { subAgentFeed } from "./help/subagent-feed.js";
import { AVATAR_COLORS, AVATAR_VARIANTS, avatarOf, botAvatarSvg, moodOf, type BotAvatar, type BotMood } from "./help/bot-avatar.js";
import { BOTS_SELECT_EVENT, takeBotsSelection } from "./help/bots-events.js";

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

/** An agent record as the library lists it (main/local-agents.ts AgentRow). */
interface Bot {
  id: string; slug: string; name: string; description: string; prompt: string; model: string;
  role?: "orchestrator" | "worker"; avatar?: BotAvatar | null; live: boolean;
}
interface ThreadMsg { role: "user" | "assistant"; text: string; at: number }
interface Envelope { ok: boolean; data?: unknown; error?: string }

interface BotsApi {
  subAgentsList?: () => Promise<unknown[]>;
  onSubAgentsUpdate?: (cb: (runs: unknown[]) => void) => () => void;
  libraryAgentsList?: () => Promise<Envelope>;
  libraryAgentCreate?: (input: unknown) => Promise<Envelope>;
  libraryAgentUpdate?: (ref: string, patch: unknown) => Promise<Envelope>;
  botsThread?: (agent: string) => Promise<{ ok: true; chatId: string; messages: ThreadMsg[]; running: boolean; partial?: string }>;
  botsAsk?: (agent: string, text: string) => Promise<{ ok: true; runId: string; text: string } | { ok: false; error: string; text?: string }>;
  botsStop?: (agent: string) => Promise<{ ok: true; stopped: boolean }>;
  botsOrchestratorBrief?: () => Promise<string>;
  onBotsFrame?: (cb: (d: { bot: string; type: string; runId: string; [k: string]: unknown }) => void) => () => void;
}
const api = (): BotsApi => ((window as unknown as { glyphh?: BotsApi }).glyphh ?? {});

const STATUS_TITLE: Record<SubAgentRun["status"], string> = {
  working: "Working",
  waiting: "Waiting on you",
  done: "Done",
  failed: "Failed",
};

const CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>`;
const asRuns = (raw: unknown[]): SubAgentRun[] =>
  raw.filter((r): r is SubAgentRun => !!r && typeof r === "object" && typeof (r as SubAgentRun).childId === "string");
const asBots = (env: Envelope | null | undefined): Bot[] => {
  const rows = env?.ok && Array.isArray(env.data) ? env.data : [];
  return rows.filter((b): b is Bot => !!b && typeof b === "object" && typeof (b as Bot).slug === "string" && typeof (b as Bot).name === "string");
};
const botChatId = (slug: string): string => `bots/${slug}`;
const roleOf = (b: Bot): "orchestrator" | "worker" => (b.role === "orchestrator" ? "orchestrator" : "worker");

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

const el = (tag: string, cls: string, text?: string): HTMLElement => {
  const n = document.createElement(tag);
  n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** Mount the panel into a work-panel body. Returns an unmount. */
export function mountBotsPanel(body: HTMLElement): () => void {
  body.classList.add("bots-body");
  body.innerHTML = "";

  // ── the frame: rail | main ──
  const rail = el("div", "bots-rail");
  const railHead = el("div", "bots-rail-head");
  railHead.append(el("span", "bots-rail-title", "Bots"));
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "bots-add";
  addBtn.title = "New bot — Customize → Agents";
  addBtn.textContent = "+";
  addBtn.addEventListener("click", () => openEditor());
  railHead.appendChild(addBtn);
  const railList = el("div", "bots-rail-list");
  rail.append(railHead, railList);
  const main = el("div", "bots-main");
  body.append(rail, main);

  // ── state ──
  let bots: Bot[] = [];
  let selected: string | null = takeBotsSelection();
  let runs: SubAgentRun[] = [];
  const threads = new Map<string, ThreadMsg[]>();
  const streaming = new Map<string, string>();          // a bot's answer as it streams
  const working = new Set<string>();                     // bots with a turn on
  const errors = new Map<string, string>();
  const chosen = new Map<string, boolean>();
  const stepOpen = new Map<string, boolean>();
  let draft = "";
  let pickerOpen = false;

  const botBySlug = (slug: string | null): Bot | undefined => (slug ? bots.find((b) => b.slug === slug) : undefined);
  const sorted = (): Bot[] => [...bots].sort((a, b) => (roleOf(a) === roleOf(b) ? a.name.localeCompare(b.name) : roleOf(a) === "orchestrator" ? -1 : 1));
  /** The runs that belong to a bot: under its thread (an orchestrator's
   *  swarm), or the bot itself working for someone else (a worker's turns). */
  const runsOf = (b: Bot): SubAgentRun[] => runs.filter((r) => r.parentChatId === botChatId(b.slug) || r.slug === b.slug);
  const moodFor = (b: Bot): BotMood => {
    if (errors.has(b.slug)) return "error";
    if (working.has(b.slug)) return "generating";
    const mine = runsOf(b);
    if (mine.some((r) => r.status === "waiting")) return "curious";
    if (mine.some((r) => r.status === "working")) return "generating";
    const last = mine[mine.length - 1];
    if (last && last.endedAt && Date.now() - last.endedAt < 8000) return moodOf(last.status);
    return "idle";
  };
  const runsAs = (_b: Bot): string => "Glyphh";

  function openEditor(): void {
    (window as unknown as { __glyphhOpenSettings?: (sub?: string) => void }).__glyphhOpenSettings?.("agents");
  }

  // ── the rail ──
  const paintRail = (): void => {
    railList.textContent = "";
    if (!bots.length) {
      railList.appendChild(el("div", "bots-rail-empty", "No bots yet."));
      return;
    }
    let lastRole: string | null = null;
    for (const b of sorted()) {
      const role = roleOf(b);
      if (role !== lastRole) { railList.appendChild(el("div", "bots-rail-section", role === "orchestrator" ? "Orchestrators" : "Workers")); lastRole = role; }
      const row = document.createElement("button");
      row.type = "button";
      row.className = `bots-row${b.slug === selected ? " active" : ""}`;
      row.dataset.slug = b.slug;
      const av = el("span", "bots-row-avatar");
      av.innerHTML = botAvatarSvg(avatarOf(b), moodFor(b), { size: 34 });
      const text = el("span", "bots-row-text");
      text.append(el("span", "bots-row-name", b.name), el("span", "bots-row-sub", `${runsAs(b)}${b.model ? ` · ${b.model}` : ""}`));
      row.append(av, text);
      const live = runsOf(b).filter((r) => r.status === "working" || r.status === "waiting").length;
      if (live || working.has(b.slug)) row.appendChild(el("span", "bots-row-live", live ? String(live) : ""));
      row.addEventListener("click", () => { select(b.slug); });
      railList.appendChild(row);
    }
  };

  // ── the main column ──
  const paintMain = (): void => {
    const keepScroll = main.querySelector<HTMLElement>(".bots-thread")?.scrollTop;
    const draftEl = main.querySelector<HTMLTextAreaElement>(".bots-composer textarea");
    if (draftEl) draft = draftEl.value;
    main.textContent = "";
    const b = botBySlug(selected);
    if (!b) { main.appendChild(emptyMain()); return; }
    main.append(headEl(b), threadEl(b), swarmEl(b), composerEl(b));
    const t = main.querySelector<HTMLElement>(".bots-thread");
    if (t) requestAnimationFrame(() => { t.scrollTop = working.has(b.slug) || keepScroll === undefined ? t.scrollHeight : keepScroll; });
  };

  const emptyMain = (): HTMLElement => {
    const box = el("div", "bots-empty");
    if (!bots.length) {
      box.append(el("strong", "", "No bots yet."), el("span", "", "A bot is one of your agents with a role: an orchestrator plans the work and hands it to the workers; a worker does one kind of work, on the model that suits it."));
      const make = document.createElement("button");
      make.type = "button";
      make.className = "agp-make";
      make.textContent = "Create the orchestrator";
      make.addEventListener("click", () => void createOrchestrator());
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "agp-make";
      edit.textContent = "Make a bot in Customize → Agents";
      edit.addEventListener("click", openEditor);
      box.append(make, edit);
    } else {
      box.append(el("strong", "", "Pick a bot."), el("span", "", "Its conversation, the swarm it works with, and its cat are on the right."));
    }
    return box;
  };

  async function createOrchestrator(): Promise<void> {
    const brief = await api().botsOrchestratorBrief?.().catch(() => "") ?? "";
    const res = await api().libraryAgentCreate?.({
      name: "Orchestrator",
      description: "Plans the work and hands it to the other bots; writes the one answer.",
      prompt: brief,
      role: "orchestrator",
      avatar: { variant: 8, color: AVATAR_COLORS[0] },
    }).catch((e: unknown): Envelope => ({ ok: false, error: String(e) }));
    if (!res?.ok) { errors.set("__create", res?.error ?? "could not create"); paintMain(); return; }
    await loadBots();
    select("orchestrator");
  }

  const headEl = (b: Bot): HTMLElement => {
    const head = el("div", "bots-head");
    const av = document.createElement("button");
    av.type = "button";
    av.className = "bots-head-avatar";
    av.title = "Pick this bot's cat";
    av.innerHTML = botAvatarSvg(avatarOf(b), moodFor(b), { size: 64 });
    av.addEventListener("click", () => { pickerOpen = !pickerOpen; paintMain(); });
    const text = el("div", "bots-head-text");
    text.append(el("div", "bots-head-name", b.name));
    const sub = el("div", "bots-head-sub");
    const role = document.createElement("select");
    role.className = "bots-role";
    role.title = "Role";
    for (const [v, label] of [["orchestrator", "Orchestrator"], ["worker", "Worker"]] as const) {
      const o = document.createElement("option");
      o.value = v; o.textContent = label;
      role.appendChild(o);
    }
    role.value = roleOf(b);
    role.addEventListener("change", () => void saveBot(b.slug, { role: role.value }));
    sub.append(role, el("span", "bots-chip", runsAs(b)), el("span", "bots-chip mono", b.model || "main agent's model"));
    text.appendChild(sub);
    if (b.description) text.appendChild(el("div", "bots-head-desc", b.description));
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "agp-make";
    edit.textContent = "Edit";
    edit.title = "Name, brief, model and runs-as — Customize → Agents";
    edit.addEventListener("click", openEditor);
    head.append(av, text, edit);
    if (pickerOpen) head.appendChild(pickerEl(b));
    return head;
  };

  /** THE FACE PICKER: the sixteen mascot faces (black for now), and Surprise me. */
  const pickerEl = (b: Bot): HTMLElement => {
    const cur = avatarOf(b);
    const box = el("div", "bots-picker");
    const bodies = el("div", "bots-picker-bodies");
    for (const v of AVATAR_VARIANTS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `bots-picker-body${v.id === cur.variant ? " on" : ""}`;
      btn.title = v.name;
      btn.innerHTML = botAvatarSvg({ variant: v.id, color: cur.color }, "idle", { size: 44 });
      btn.addEventListener("click", () => void saveBot(b.slug, { avatar: { variant: v.id, color: cur.color } }));
      bodies.appendChild(btn);
    }
    // No colour choice for now — every face is black (2026-10-09).
    const colors = el("div", "bots-picker-colors");
    const shuffle = document.createElement("button");
    shuffle.type = "button";
    shuffle.className = "agp-make";
    shuffle.textContent = "Surprise me";
    shuffle.addEventListener("click", () => {
      const variant = AVATAR_VARIANTS[Math.floor(Math.random() * AVATAR_VARIANTS.length)]!.id;
      void saveBot(b.slug, { avatar: { variant, color: cur.color } });
    });
    colors.appendChild(shuffle);
    box.append(bodies, colors);
    return box;
  };

  async function saveBot(slug: string, patch: Record<string, unknown>): Promise<void> {
    const res = await api().libraryAgentUpdate?.(slug, patch).catch((e: unknown): Envelope => ({ ok: false, error: String(e) }));
    if (!res?.ok) { errors.set(slug, res?.error ?? "the change did not save"); paintAll(); return; }
    await loadBots();
  }

  const threadEl = (b: Bot): HTMLElement => {
    const box = el("div", "bots-thread");
    const msgs = threads.get(b.slug) ?? [];
    if (!msgs.length && !streaming.has(b.slug)) {
      const hello = el("div", "bots-thread-empty");
      hello.innerHTML = botAvatarSvg(avatarOf(b), "playful", { size: 72 });
      hello.appendChild(el("span", "", roleOf(b) === "orchestrator"
        ? `Ask ${b.name} for something. It plans the work, hands the parts to your other bots, and writes the one answer.`
        : `Ask ${b.name} for something. It works on its own, on ${b.model || "the main agent's model"}.`));
      box.appendChild(hello);
    }
    for (const m of msgs) box.appendChild(msgEl(b, m.role, m.text));
    const live = streaming.get(b.slug);
    if (working.has(b.slug)) box.appendChild(msgEl(b, "assistant", live ?? "", true));
    const err = errors.get(b.slug);
    if (err) box.appendChild(el("div", "bots-error", err));
    return box;
  };

  const msgEl = (b: Bot, role: "user" | "assistant", text: string, live = false): HTMLElement => {
    const row = el("div", `bots-msg ${role}${live ? " live" : ""}`);
    if (role === "assistant") {
      const av = el("span", "bots-msg-avatar");
      av.innerHTML = botAvatarSvg(avatarOf(b), live ? "generating" : "idle", { size: 26 });
      row.appendChild(av);
    }
    const bubble = el("div", "bots-msg-body code-agent-text");
    if (text) bubble.innerHTML = formatMarkdown(text);
    else if (live) bubble.appendChild(el("span", "agp-starting", "Thinking…"));
    row.appendChild(bubble);
    return row;
  };

  /** THE SWARM under this bot: the sub-agents it fanned out to (an
   *  orchestrator), or its own turns for others (a worker). */
  const swarmEl = (b: Bot): HTMLElement => {
    const box = el("div", "bots-swarm");
    const mine = runsOf(b);
    const head = el("div", "agp-group-head");
    const liveN = mine.filter((r) => r.status === "working" || r.status === "waiting").length;
    head.append(el("span", "agp-group-title", roleOf(b) === "orchestrator" ? "Swarm" : "Working for others"),
      el("span", "agp-group-count", mine.length ? (liveN ? `${liveN} of ${mine.length} working` : `${mine.length} done`) : ""));
    box.appendChild(head);
    if (!mine.length) {
      box.appendChild(el("div", "bots-swarm-empty", roleOf(b) === "orchestrator"
        ? "Nothing handed out yet. The bots it can call are the workers on the left."
        : "Not called by anyone yet."));
      return box;
    }
    const scrolled = new Map<string, number>();
    for (const r of mine) box.appendChild(rowEl(r, scrolled));
    return box;
  };

  const rowEl = (r: SubAgentRun, scrolled: Map<string, number>): HTMLElement => {
    const open = chosen.get(r.childId) ?? (r.status === "working" || r.status === "waiting");
    const row = document.createElement("div");
    row.className = `agp-row ${r.status}${open ? " open" : ""}`;
    row.dataset.id = r.childId;
    const bar = document.createElement("button");
    bar.type = "button";
    bar.className = "agp-bar";
    bar.setAttribute("aria-expanded", open ? "true" : "false");
    bar.innerHTML = `<span class="agp-chev">${CHEVRON}</span>`;
    const who = botBySlug(r.slug);
    const av = el("span", "bots-run-avatar");
    av.innerHTML = botAvatarSvg(who ? avatarOf(who) : avatarOf({ slug: r.slug }), moodOf(r.status), { size: 22 });
    const name = el("span", "agp-name", r.name);
    const model = el("span", "agp-model", r.model);
    const task = el("span", "agp-bar-task", (r.status === "done" || r.status === "failed") && r.summary ? r.summary : r.task);
    const meta = el("span", "agp-meta", metaText(r));
    meta.title = STATUS_TITLE[r.status];
    bar.append(av, name, model, task, meta);
    bar.addEventListener("click", () => { chosen.set(r.childId, !open); paintMain(); });
    row.appendChild(bar);
    if (open) {
      const feed = feedEl(r, stepOpen, paintMain);
      row.appendChild(feed);
      const prev = scrolled.get(r.childId);
      requestAnimationFrame(() => { feed.scrollTop = prev !== undefined && r.status !== "working" ? prev : feed.scrollHeight; });
    }
    return row;
  };

  const composerEl = (b: Bot): HTMLElement => {
    const box = el("div", "bots-composer");
    const ta = document.createElement("textarea");
    ta.rows = 2;
    ta.placeholder = `Ask ${b.name}…`;
    ta.value = draft;
    ta.spellcheck = false;
    const send = document.createElement("button");
    send.type = "button";
    send.className = "bots-send";
    const busy = working.has(b.slug);
    send.textContent = busy ? "Stop" : "Ask";
    send.title = busy ? "Stop this turn" : "Ask (⌘↩)";
    const go = (): void => {
      if (working.has(b.slug)) { void api().botsStop?.(b.slug); return; }
      const text = ta.value.trim();
      if (!text) return;
      ta.value = ""; draft = "";
      void ask(b, text);
    };
    send.addEventListener("click", go);
    ta.addEventListener("keydown", (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); go(); } });
    box.append(ta, send);
    return box;
  };

  async function ask(b: Bot, text: string): Promise<void> {
    errors.delete(b.slug);
    const msgs = threads.get(b.slug) ?? [];
    msgs.push({ role: "user", text, at: Date.now() });
    threads.set(b.slug, msgs);
    working.add(b.slug);
    streaming.set(b.slug, "");
    paintAll();
    const res = await api().botsAsk?.(b.slug, text).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    working.delete(b.slug);
    const answer = streaming.get(b.slug) ?? "";
    streaming.delete(b.slug);
    if (res && res.ok) {
      if ((res.text || answer).trim()) msgs.push({ role: "assistant", text: res.text || answer, at: Date.now() });
    } else {
      if (answer.trim()) msgs.push({ role: "assistant", text: answer, at: Date.now() });
      errors.set(b.slug, res?.error ?? "the turn did not go through");
    }
    paintAll();
  }

  // ── data ──
  async function loadBots(): Promise<void> {
    const env = await api().libraryAgentsList?.().catch((e: unknown): Envelope => ({ ok: false, error: String(e) }));
    bots = asBots(env);
    if (selected && !botBySlug(selected)) selected = null;
    if (!selected && bots.length) selected = sorted()[0]!.slug;
    paintAll();
    if (selected) void loadThread(selected);
  }
  async function loadThread(slug: string): Promise<void> {
    const t = await api().botsThread?.(slug).catch(() => null);
    if (!t?.ok || !body.isConnected) return;
    threads.set(slug, t.messages);
    if (t.running) { working.add(slug); streaming.set(slug, t.partial ?? ""); }
    paintMain();
  }
  function select(slug: string): void {
    if (selected === slug) return;
    selected = slug;
    pickerOpen = false;
    paintAll();
    void loadThread(slug);
  }
  const paintAll = (): void => { paintRail(); paintMain(); };

  // ── wiring ──
  let fromMain: unknown[] = [];
  let fromFeed: unknown[] = subAgentFeed.list();
  const merge = (): void => { runs = asRuns([...fromMain, ...fromFeed]).sort((a, b) => a.startedAt - b.startedAt); paintAll(); };
  const offs: Array<() => void> = [];
  let tick = 0;
  const unmount = (): void => { for (const off of offs.splice(0)) off(); window.clearInterval(tick); };
  const alive = (): boolean => { if (body.isConnected) return true; unmount(); return false; };
  offs.push(api().onSubAgentsUpdate?.((raw) => { if (!alive()) return; fromMain = Array.isArray(raw) ? raw : []; merge(); }) ?? (() => {}));
  offs.push(subAgentFeed.subscribe((rows) => { if (!alive()) return; fromFeed = rows; merge(); }));
  offs.push(api().onBotsFrame?.((d) => {
    if (!alive()) return;
    if (d.agent) return;   // the swarm's own frames arrive through the ledger
    if (d.type === "delta") { streaming.set(d.bot, (streaming.get(d.bot) ?? "") + String(d.delta ?? "")); if (d.bot === selected) paintStreaming(d.bot); }
    else if (d.type === "error") { errors.set(d.bot, String(d.error ?? "the turn failed")); paintAll(); }
  }) ?? (() => {}));
  const onSelect = (ev: Event): void => {
    const slug = (ev as CustomEvent<{ bot?: string }>).detail?.bot;
    if (slug) { select(slug); if (!botBySlug(slug)) void loadBots(); }
  };
  window.addEventListener(BOTS_SELECT_EVENT, onSelect);
  offs.push(() => window.removeEventListener(BOTS_SELECT_EVENT, onSelect));
  const onAgents = (): void => { if (alive()) void loadBots(); };
  window.addEventListener("glyphh:agents-changed", onAgents);
  offs.push(() => window.removeEventListener("glyphh:agents-changed", onAgents));

  /** A streaming answer repaints its own bubble, not the whole column. */
  const paintStreaming = (slug: string): void => {
    const bubble = main.querySelector<HTMLElement>(".bots-msg.live .bots-msg-body");
    const text = streaming.get(slug) ?? "";
    if (!bubble) { paintMain(); return; }
    if (text) bubble.innerHTML = formatMarkdown(text);
    const t = main.querySelector<HTMLElement>(".bots-thread");
    if (t) t.scrollTop = t.scrollHeight;
  };

  void api().subAgentsList?.().then((raw) => { if (!alive()) return; fromMain = Array.isArray(raw) ? raw : []; merge(); }).catch(() => undefined);
  void loadBots();
  // The elapsed clocks and the cats' moods tick in place.
  tick = window.setInterval(() => {
    if (!alive()) return;
    for (const r of runs) {
      if (r.status !== "working" && r.status !== "waiting") continue;
      const meta = main.querySelector<HTMLElement>(`.agp-row[data-id="${CSS.escape(r.childId)}"] .agp-meta`);
      if (meta) meta.textContent = metaText(r);
    }
    paintRail();
  }, 1000);
  paintAll();
  return unmount;
}
