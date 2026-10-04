/**
 * chat-store-repair.ts — collapse a thread whose transcript was appended to
 * itself (his report, 2026-10-04: the desktop crashed and crawled; the chat
 * store had grown to 164 MB — 55,058 messages in 10 threads, 227 of them
 * real). Two writers (main's publisher and the renderer's thread-store) and
 * one puller that replaced the local transcript with the server's copy
 * doubled every thread on every pass. The writers are one now; this repairs
 * what the loop left behind, on load, before anything crosses IPC.
 *
 * A duplicate is a message identical to an earlier one in the same thread by
 * role, text, timestamp and attachments. Two real messages that say the same
 * words carry different timestamps; the loop's copies carry the same one.
 * Pure — no Electron, tested in test/main/chat-store-repair.test.ts.
 */
export interface RepairResult<C> { chats: C[]; /** id → the message count before the repair, for threads that shrank. */ repaired: Record<string, number> }

function keyOf(m: unknown): string {
  const r = (m ?? {}) as Record<string, unknown>;
  const extra = r.attachments ?? r.images ?? r.tool ?? null;
  return JSON.stringify([r.role ?? "", r.text ?? r.content ?? "", r.at ?? r.ts ?? null, extra === null ? null : JSON.stringify(extra)]);
}

export function repairChatStore<C extends { id?: unknown; messages?: unknown }>(chats: C[]): RepairResult<C> {
  const repaired: Record<string, number> = {};
  const out = chats.map((c) => {
    if (!c || !Array.isArray(c.messages) || c.messages.length < 2) return c;
    const seen = new Set<string>();
    const kept = (c.messages as unknown[]).filter((m) => { const k = keyOf(m); if (seen.has(k)) return false; seen.add(k); return true; });
    if (kept.length === c.messages.length) return c;
    if (typeof c.id === "string") repaired[c.id] = c.messages.length;
    return { ...c, messages: kept };
  });
  return { chats: out, repaired };
}
