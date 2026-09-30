/**
 * desktop-sessions.ts — the phone's chat list, read from the member's machines.
 *
 * Chats live on the machine (the desktop's chat store, agent-ipc.ts, shared
 * with the CLI); there is no server thread store on the fork and no cloud
 * worker yet (v1, 2026-09-30). A machine is reachable only while its member
 * has REMOTE CONTROL on (`glyphh remote-control`, or the desktop's Settings →
 * Remote control), so the four calls mobile.tsx made on `glyphh().sessions`
 * are answered over the attach socket by each such machine's sessions.*:
 *
 *   threads()          → sessions.list on EVERY machine, each thread tagged
 *                        with the machine it lives on
 *   thread(id)         → sessions.get    (the last 200 {role, text} messages)
 *   pushThread(id, t)  → sessions.put    (title / type / folder — the machine
 *                                         writes a relayed turn's messages itself)
 *   deleteThread(id)   → sessions.delete
 *
 * A machine's id changes on every reconnect, so a thread's machine is also
 * known by NAME. No machine → an empty list, never an error; an org that
 * turned remote control off → `orgOff()` says so.
 */
import { glyphh } from './glyphh-web.js';

export interface DesktopThread {
  id: string; title: string; mode?: string;
  source?: { kind?: string; path?: string; machineId?: string; machineName?: string } | null;
  createdAt: number; updatedAt: number; messageCount: number;
}

interface Machine { id: string; name?: string; app?: string }
interface Attach {
  status(): Promise<{ allowed?: boolean; attached?: boolean; machines?: Machine[] }>;
  dispatch<T>(method: string, params?: Record<string, unknown>, opts?: { machineId?: string }): Promise<T>;
}
const attach = (): Attach => (glyphh() as unknown as { attach: Attach }).attach;

/** Which machine each listed thread lives on (from the last threads()). */
const home = new Map<string, string>();
let off = false;

const on = (id: string): { machineId?: string } => {
  const m = home.get(id);
  return m ? { machineId: m } : {};
};

export const desktopSessions = {
  /** The org's admin turned remote control off (from the last threads()). */
  orgOff: (): boolean => off,

  async threads(): Promise<DesktopThread[]> {
    const st = await attach().status().catch(() => null);
    off = st?.allowed === false;
    const machines = st?.machines ?? [];
    const lists = await Promise.all(machines.map(async (m) => {
      const r = await attach().dispatch<{ sessions?: DesktopThread[] }>('sessions.list', {}, { machineId: m.id }).catch(() => null);
      return (r?.sessions ?? []).map((t) => ({
        ...t,
        source: { ...(t.source ?? {}), kind: 'local', machineId: m.id, machineName: m.name || m.app || '' },
      }));
    }));
    const all = lists.flat();
    home.clear();
    for (const t of all) if (t.source?.machineId) home.set(t.id, t.source.machineId);
    return all;
  },

  async thread(id: string): Promise<{ messages: Array<{ role: string; text: string }> }> {
    const r = await attach().dispatch<{ session?: { messages?: Array<{ role: string; text: string }> } }>('sessions.get', { id }, on(id));
    return { messages: r?.session?.messages ?? [] };
  },

  async pushThread(id: string, t: { title?: string; mode?: string; workdir?: string; machineId?: string }): Promise<void> {
    await attach().dispatch('sessions.put', {
      id,
      ...(t.title ? { title: t.title } : {}),
      ...(t.mode ? { mode: t.mode } : {}),
      ...(t.workdir ? { workdir: t.workdir } : {}),
    }, t.machineId ? { machineId: t.machineId } : on(id));
  },

  async deleteThread(id: string): Promise<void> {
    await attach().dispatch('sessions.delete', { id }, on(id));
    home.delete(id);
  },
};
