/**
 * desktop-sessions.ts — the phone's chat list, read from the member's DESKTOP.
 *
 * Chats live on the machine (the desktop's chat store, agent-ipc.ts); there is
 * no server thread store on the fork and no cloud worker yet (v1, 2026-09-30).
 * So the four calls mobile.tsx made on `glyphh().sessions` are answered over
 * the attach socket by the desktop's sessions.* handlers (attach-handlers.ts):
 *
 *   threads()          → sessions.list   (metadata, newest first)
 *   thread(id)         → sessions.get    (the last 200 {role, text} messages)
 *   pushThread(id, t)  → sessions.put    (title / type only — the desktop writes
 *                                         a relayed turn's messages itself)
 *   deleteThread(id)   → sessions.delete
 *
 * No desktop attached → an empty list, never an error: the surface then says
 * to open the desktop app.
 */
import { glyphh } from './glyphh-web.js';

export interface DesktopThread {
  id: string; title: string; mode?: string;
  source?: { kind?: string; path?: string; machineId?: string } | null;
  createdAt: number; updatedAt: number; messageCount: number;
}

interface Attach {
  status(): Promise<{ attached?: boolean; machines?: Array<{ id: string; name?: string; app?: string }> }>;
  dispatch<T>(method: string, params?: Record<string, unknown>): Promise<T>;
}
const attach = (): Attach => (glyphh() as unknown as { attach: Attach }).attach;

async function machine(): Promise<{ id: string } | null> {
  try { return (await attach().status())?.machines?.[0] ?? null; } catch { return null; }
}

export const desktopSessions = {
  async threads(): Promise<DesktopThread[]> {
    const m = await machine();
    if (!m) return [];
    const r = await attach().dispatch<{ sessions?: DesktopThread[] }>('sessions.list');
    return (r?.sessions ?? []).map((t) => ({
      ...t,
      ...(t.source?.kind === 'local' ? { source: { ...t.source, machineId: m.id } } : {}),
    }));
  },

  async thread(id: string): Promise<{ messages: Array<{ role: string; text: string }> }> {
    const r = await attach().dispatch<{ session?: { messages?: Array<{ role: string; text: string }> } }>('sessions.get', { id });
    return { messages: r?.session?.messages ?? [] };
  },

  async pushThread(id: string, t: { title?: string; mode?: string; workdir?: string }): Promise<void> {
    await attach().dispatch('sessions.put', {
      id,
      ...(t.title ? { title: t.title } : {}),
      ...(t.mode ? { mode: t.mode } : {}),
      ...(t.workdir ? { workdir: t.workdir } : {}),
    });
  },

  async deleteThread(id: string): Promise<void> {
    await attach().dispatch('sessions.delete', { id });
  },
};
