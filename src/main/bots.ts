/**
 * bots.ts — THE BOTS PANEL's main side (his order, 2026-10-08: "a native
 * WorkPanel called Bots that has a left rail, claude agent sdk loops for each
 * agent, and then the models those agents run on… We should have an
 * orchestrator then a swarm under it").
 *
 * A BOT IS AN AGENT RECORD (local-agents.ts): a name, a standing brief, what
 * runs it (the Glyphh loop or a CLI), a model, and now a role and a cat. Its
 * conversation is ONE THREAD in the shared chat store, `bots/<slug>`, stamped
 * `bot` so the rail lists it under the bot's cat and a click opens the Bots
 * panel on it (his word: "we add bot threads as a special type in the rail").
 *
 * ASKING A BOT runs the Glyphh loop on that thread (glyphh-loop.ts
 * runBotTurn): "the orchestrator is just a set of personality and
 * instructions we feed into the loop". The brief leads the thread's first
 * message in this process, the engine keeps the history after that, and a
 * restart seeds it back from the store. The loop's own spawn_agent is what
 * makes an orchestrator an orchestrator: the swarm it fans out to is the
 * rest of the roster, ledgered under this thread for the panel to show.
 */
import { ipcMain } from "electron";
import { getAgent } from "./local-agents.js";
import { glyphhLoopHas, runBotTurn, stopBotTurn, type LoopFrame } from "./glyphh-loop.js";
import { appendStoredMessage, storedMessages } from "./agent-ipc.js";
import { agentRoleOf } from "../shared/member-library.js";

export const botChatId = (slug: string): string => `bots/${slug}`;
export const botSlugOfChat = (chatId: string): string | null => (chatId.startsWith("bots/") ? chatId.slice(5) : null);

/** THE ORCHESTRATOR'S STANDING BRIEF — the personality and instructions the
 *  panel seeds when the member makes one with a click. Editable like any
 *  brief (Customize → Agents). */
export const ORCHESTRATOR_BRIEF = `You are the orchestrator of the user's bots.

You plan the work and hand it out; you do not do everything yourself. For every request:
1. Say in one or two lines how you will split it.
2. Hand each part to the bot that fits with spawn_agent — its description says what it is for. Give each bot a complete, self-contained task and the context it needs; run independent parts in parallel.
3. Do the small glue work yourself, read what the bots came back with, and write ONE answer for the user: what was done, what was found, what is left.

Be direct and plain. Name which bot did what. If no bot fits a part, do that part yourself and say so. If a bot failed, say what failed and what you did instead. Never invent a result a bot did not return.`;

interface BotRun { runId: string | null; answer: string; startedAt: number }
const running = new Map<string, BotRun>();

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function installBotsIpc(): void {
  ipcMain.handle("bots-thread", (_e, p: { agent?: unknown } | undefined) => {
    const a = getAgent(str(p?.agent));
    const chatId = botChatId(a.slug);
    const live = running.get(a.slug);
    return { ok: true as const, chatId, messages: storedMessages(chatId), running: !!live, ...(live ? { partial: live.answer, startedAt: live.startedAt } : {}) };
  });

  ipcMain.handle("bots-ask", async (e, p: { agent?: unknown; text?: unknown; workdir?: unknown } | undefined) => {
    const a = getAgent(str(p?.agent));
    const ask = str(p?.text);
    if (!ask) return { ok: false as const, error: "nothing to ask" };
    if (running.has(a.slug)) return { ok: false as const, error: `${a.name} is still working` };
    const chatId = botChatId(a.slug);
    const prior = storedMessages(chatId);
    const brief = String(a.prompt ?? "").trim();
    // The brief leads the first message THIS PROCESS sends on the thread; a
    // thread the engine already holds has it in its history. The stored turn
    // is the ask alone — the member reads their own words back, not the brief.
    const fresh = !glyphhLoopHas(chatId);
    const text = fresh && brief ? `${brief}\n\n---\n\n${ask}` : ask;
    const history = fresh ? prior.map((m) => ({ role: m.role, text: m.text })) : [];
    appendStoredMessage(chatId, { role: "user", text: ask }, { title: a.name, mode: "code", bot: a.slug });
    const run: BotRun = { runId: null, answer: "", startedAt: Date.now() };
    running.set(a.slug, run);
    const sender = e.sender;
    const send = (frame: LoopFrame): void => {
      if (sender.isDestroyed()) return;
      try { sender.send("bots:frame", { bot: a.slug, role: agentRoleOf(a), ...frame }); } catch { /* panel closed */ }
    };
    try {
      const started = await runBotTurn({
        chatId, text, model: a.model, history,
        ...(str(p?.workdir) ? { workdir: str(p?.workdir) } : {}),
      }, (ev) => {
        if (ev.type === "delta" && !ev.agent) run.answer += String((ev as { delta?: string }).delta ?? "");
        send(ev);
      });
      run.runId = started.runId;
      if (run.answer.trim()) appendStoredMessage(chatId, { role: "assistant", text: run.answer });
      return { ok: true as const, runId: started.runId, text: run.answer };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      send({ type: "error", error, runId: run.runId ?? "" } as unknown as LoopFrame);
      return { ok: false as const, error, text: run.answer };
    } finally {
      running.delete(a.slug);
    }
  });

  ipcMain.handle("bots-stop", (_e, p: { agent?: unknown } | undefined) => {
    const a = getAgent(str(p?.agent));
    return { ok: true as const, stopped: stopBotTurn(botChatId(a.slug)) };
  });

  ipcMain.handle("bots-orchestrator-brief", () => ORCHESTRATOR_BRIEF);
}
