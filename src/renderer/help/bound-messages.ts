/**
 * bound-messages.ts — the renderer's copy of main's chat-store-repair rule
 * (renderer never imports src/main or src/shared): a transcript read from
 * anywhere is deduplicated (same role, text, timestamp, attachments) and cut
 * to its tail. A loop elsewhere can no longer hand this window a transcript
 * that halts it (his report, 2026-10-04).
 */
export const MAX_THREAD_MESSAGES = 2000;

function keyOf(m: unknown): string {
  const r = (m ?? {}) as Record<string, unknown>;
  const extra = r.attachments ?? r.images ?? r.tool ?? null;
  return JSON.stringify([r.role ?? "", r.text ?? r.content ?? "", r.at ?? r.ts ?? null, extra === null ? null : JSON.stringify(extra)]);
}

export function boundMessages<M>(messages: M[]): M[] {
  const seen = new Set<string>();
  const kept = messages.filter((m) => { const k = keyOf(m); if (seen.has(k)) return false; seen.add(k); return true; });
  return kept.length > MAX_THREAD_MESSAGES ? kept.slice(-MAX_THREAD_MESSAGES) : kept;
}
