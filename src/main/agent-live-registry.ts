/**
 * agent-live-registry.ts — WHICH CHATS HAVE A TURN RUNNING, app-wide.
 *
 * His report, 2026-09-26: before the purge "an agent could be running, open a
 * new one and the thread in the left rail would show that session running with
 * a blinking icon". That died when the agent moved onto the CLI bridge and each
 * agent panel became its own document — a run's events reach only the
 * webContents that started it, so no other surface could know.
 *
 * This is the one ledger. The bridge and the Glyphh loop mark a chat running at
 * the start of a turn and done at its end; `announce` carries the whole list to
 * every renderer. Pure (no Electron) so it is testable; agent-live.ts wires it.
 */

export interface LiveAgentRun {
  /** The Glyphh thread the turn runs on. */
  chatId: string;
  /** The CLI's own session id for that thread, when known — the rail lists
   *  Claude/Codex sessions by THIS id, the Glyphh loop's by the chat id. */
  cliSessionId: string | null;
  cli: string;
  runId: string;
  /** The webContents driving the run — the panel that hosts it. */
  senderId: number;
  startedAt: number;
}

export interface AgentLiveRegistry {
  start(run: Omit<LiveAgentRun, "startedAt">): void;
  /** A later fact about a running chat (the CLI named its session id). */
  update(chatId: string, patch: Partial<Pick<LiveAgentRun, "cliSessionId" | "runId" | "senderId">>): void;
  /** The turn ended. With a runId, a STALE done (an old process exiting after
   *  a respawn) never clears the newer turn; without one it always clears. */
  done(chatId: string, runId?: string): void;
  isRunning(chatId: string): boolean;
  list(): LiveAgentRun[];
}

export function createAgentLiveRegistry(announce: (runs: LiveAgentRun[]) => void, now: () => number = () => Date.now()): AgentLiveRegistry {
  const runs = new Map<string, LiveAgentRun>();
  const list = (): LiveAgentRun[] => [...runs.values()].sort((a, b) => a.startedAt - b.startedAt);
  const tell = (): void => { try { announce(list()); } catch { /* a listener's failure never blocks the ledger */ } };
  return {
    start(run) {
      const prev = runs.get(run.chatId);
      runs.set(run.chatId, { ...run, startedAt: prev?.startedAt ?? now() });
      tell();
    },
    update(chatId, patch) {
      const cur = runs.get(chatId);
      if (!cur) return;
      const next = { ...cur, ...patch };
      if (next.cliSessionId === cur.cliSessionId && next.runId === cur.runId && next.senderId === cur.senderId) return;
      runs.set(chatId, next);
      tell();
    },
    done(chatId, runId) {
      const cur = runs.get(chatId);
      if (!cur) return;
      if (runId && cur.runId && runId !== cur.runId) return;
      runs.delete(chatId);
      tell();
    },
    isRunning: (chatId) => runs.has(chatId),
    list,
  };
}
