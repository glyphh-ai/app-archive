/**
 * swarm.ts — A TEAM IN A THREAD (his order, 2026-10-09: "the user should be
 * able to drag super powers into the chat... The loop should go into swarm
 * mode... Tasks get delegated, threads traverse as each agent works... The
 * main glyphh agent should be able to talk to the other agents in first
 * person mode. They should respond as if it is carrying out a conversation...
 * They should wait their turn to speak").
 *
 * A thread with MEMBERS (super power slugs, stored on the chat) is a team.
 * Glyphh leads it. hand_off { member, task } asks one member, in Glyphh's own
 * first-person words, to do a piece of work: the member works on ITS OWN
 * thread (`bots/<slug>`, live — the member can open it and watch), and its
 * answer lands back in the team thread as its own message, in its own voice.
 * One hand-off answers at a time per member, in order.
 *
 * WHO MAY TAKE WORK (his order, 2026-10-09: "defined by the super power
 * relationships"): the thread's members, and the super powers Glyphh holds
 * (Glyphh's own record) — a held one handed work joins the team ("both… the
 * agent can start it or the user can"). With nothing held, Glyphh may bring in
 * any super power. A member's own hand-offs are its super powers' (its brief).
 *
 * The turn itself runs in the panel holding the team thread (the renderer's
 * runTeamTurn): the same send path a person typing into the member's thread
 * takes, so the store, the rail's live dot and the open thread all work as
 * they always do. Main asks and waits for the answer.
 */
import { ipcMain } from "electron";
import { currentTurnChat, loopSenderOf } from "./glyphh-loop.js";
import { storedChat } from "./agent-ipc.js";
import { glyphhRow, listAgents } from "./local-agents.js";

export interface HandOffResult { ok: boolean; text: string; error?: string }

/** Each request waiting on the panel (a hand-off's answer, a board change), by id. */
const waiting = new Map<string, { resolve: (r: HandOffResult) => void; timer: ReturnType<typeof setTimeout> }>();

/** A MEMBER AT WORK ON A TEAM TASK (phase 2, 2026-10-09): its own thread → the
 *  team it works for and the task it holds, while the hand-off runs. Its board
 *  changes land on that team's board; its hand-offs go to the super powers it holds. */
const memberAt = new Map<string, { team: string; task: string | null; slug: string }>();

/** Which team a turn works for: the team thread itself, or a member's thread at work on one. */
function teamOfTurn(): { team: string; as: string; task: string | null } | null {
  const chat = currentTurnChat();
  if (!chat) return null;
  const m = memberAt.get(chat);
  if (m) return { team: m.team, as: m.slug, task: m.task };
  if (chat.startsWith("bots/") || chat.startsWith("powers/")) return null;
  return { team: chat, as: "glyphh", task: null };
}

/** Ask the panel holding the team thread to do something, and wait for its answer. */
function askPanel(team: string, channel: string, payload: Record<string, unknown>, limitMs: number, signal?: AbortSignal): Promise<HandOffResult> {
  const sender = loopSenderOf(team);
  if (!sender) return Promise.resolve({ ok: false, text: "", error: "no panel is showing this team's conversation" });
  const id = `tm-${Date.now().toString(36)}-${++seq}`;
  return new Promise<HandOffResult>((resolve) => {
    const timer = setTimeout(() => { waiting.delete(id); resolve({ ok: false, text: "", error: "the panel didn't answer in time" }); }, limitMs);
    waiting.set(id, { resolve, timer });
    signal?.addEventListener("abort", () => { try { sender.send("team:handoff-stop", { id }); } catch { /* panel gone */ } }, { once: true });
    try { sender.send(channel, { id, team, ...payload }); }
    catch (err) { clearTimeout(timer); waiting.delete(id); resolve({ ok: false, text: "", error: err instanceof Error ? err.message : String(err) }); }
  });
}

/** THE WORK BOARD (phase 2): add, update or read the team's tasks. The panel
 *  owns the thread's store, so it makes the change and answers with the board. */
export async function boardOp(op: "add" | "update" | "list", args: Record<string, unknown>): Promise<HandOffResult> {
  const at = teamOfTurn();
  if (!at) return { ok: false, text: "", error: "the board belongs to a team conversation (drag super powers into a Glyphh conversation to make one)" };
  return askPanel(at.team, "team:board", { op, args, by: at.as, parent: at.task }, 30_000);
}
/** One live hand-off per member per team: they answer in turn. */
const busy = new Map<string, Promise<HandOffResult>>();
const HANDOFF_LIMIT_MS = 20 * 60 * 1000;
let seq = 0;

/** Who Glyphh may hand work to in this team: its members, then what Glyphh holds (or anyone, holding none). */
export function teamReach(members: readonly string[], glyphhHolds: readonly string[] | null, roster: readonly string[]): { allowed: Set<string>; joins: Set<string> } {
  const allowed = new Set(members);
  const extra = glyphhHolds && glyphhHolds.length ? glyphhHolds : roster;
  const joins = new Set<string>();
  for (const s of extra) if (roster.includes(s) && !allowed.has(s)) { allowed.add(s); joins.add(s); }
  return { allowed, joins };
}

export async function handOff(input: { member?: unknown; task?: unknown; taskId?: unknown }, signal?: AbortSignal): Promise<HandOffResult> {
  const at = teamOfTurn();
  if (!at) return { ok: false, text: "", error: currentTurnChat() ? "hand_off belongs to team work: a Glyphh conversation with super powers on it, or a member at work on one of its tasks" : "hand_off works inside a conversation" };
  const team = at.team;
  const sender = loopSenderOf(team);
  if (!sender) return { ok: false, text: "", error: "no panel is showing this conversation" };
  const roster = listAgents();
  const ask = String(input.task ?? "").trim();
  const want = String(input.member ?? "").trim();
  const hit = roster.find((a) => a.slug === want) ?? roster.find((a) => a.name.toLowerCase() === want.toLowerCase());
  if (!hit) return { ok: false, text: "", error: `no super power called "${want}" — agents_list names them` };
  if (!ask) return { ok: false, text: "", error: "say what you need from them in `task`" };
  const members = storedChat(team)?.members ?? [];
  // WHO MAY TAKE IT (his decision, 2026-10-09: "defined by the super power
  // relationships"): Glyphh — the members and what it holds; a member at work —
  // only the super powers IT holds (they join the team as they're handed work).
  const holder = at.as === "glyphh" ? null : roster.find((a) => a.slug === at.as) ?? null;
  const { allowed, joins } = holder
    ? teamReach([], holder.superPowers ?? [], roster.map((a) => a.slug).filter((s) => s !== holder.slug))
    : teamReach(members, glyphhRow()?.superPowers ?? null, roster.map((a) => a.slug));
  if (holder && !(holder.superPowers ?? []).length) return { ok: false, text: "", error: `${holder.name} holds no super powers to hand work to — do it yourself, or tell the lead` };
  if (!allowed.has(hit.slug)) return { ok: false, text: "", error: holder ? `${holder.name} doesn't hold ${hit.name}` : `${hit.name} isn't on this team, and Glyphh doesn't hold it` };
  const taskId = String(input.taskId ?? "").trim() || null;
  const key = `${team}::${hit.slug}`;
  // THEY WAIT THEIR TURN: a member already working finishes before the next ask.
  const before = busy.get(key);
  if (before) await before.catch(() => undefined);
  const id = `ho-${Date.now().toString(36)}-${++seq}`;
  const lead = holder ? holder.name : glyphhRow()?.name?.trim() || "Glyphh";
  // The member works FOR this team on this task while it runs (its board changes and hand-offs land here).
  const memberChat = `bots/${hit.slug}`;
  memberAt.set(memberChat, { team, task: taskId, slug: hit.slug });
  const run = new Promise<HandOffResult>((resolve) => {
    const timer = setTimeout(() => { waiting.delete(id); resolve({ ok: false, text: "", error: `${hit.name} took longer than 20 minutes` }); }, HANDOFF_LIMIT_MS);
    waiting.set(id, { resolve, timer });
    try {
      sender.send("team:handoff", { id, team, member: hit.slug, name: hit.name, lead, from: at.as, ask, joins: joins.has(hit.slug), taskId });
    } catch (err) {
      clearTimeout(timer);
      waiting.delete(id);
      resolve({ ok: false, text: "", error: err instanceof Error ? err.message : String(err) });
    }
  });
  signal?.addEventListener("abort", () => {
    try { sender.send("team:handoff-stop", { id }); } catch { /* panel gone */ }
  }, { once: true });
  busy.set(key, run);
  try { return await run; } finally {
    if (busy.get(key) === run) busy.delete(key);
    if (memberAt.get(memberChat)?.team === team) memberAt.delete(memberChat);
  }
}

export function registerSwarmIpc(): void {
  // The board's answers ride the same reply as a hand-off's.
  ipcMain.handle("team-board-done", (_e, id: string, r: HandOffResult) => {
    const w = waiting.get(String(id));
    if (!w) return false;
    clearTimeout(w.timer);
    waiting.delete(String(id));
    w.resolve({ ok: !!r?.ok, text: String(r?.text ?? ""), ...(r?.error ? { error: String(r.error) } : {}) });
    return true;
  });
  ipcMain.handle("team-handoff-done", (_e, id: string, r: HandOffResult) => {
    const w = waiting.get(String(id));
    if (!w) return false;
    clearTimeout(w.timer);
    waiting.delete(String(id));
    w.resolve({ ok: !!r?.ok, text: String(r?.text ?? ""), ...(r?.error ? { error: String(r.error) } : {}) });
    return true;
  });
}
