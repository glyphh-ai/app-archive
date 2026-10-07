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

/** What a window keeps when the server's copy of a thread is newer: the
 *  server's messages when it has at least as many, else its own. A failed or
 *  not-yet-run turn can bump the server's clock while its transcript is still
 *  empty; adopting that emptied whole threads (his report, 2026-10-04: "the
 *  history is vanishing"). Metadata is adopted either way by the caller. */
export function adoptServerMessages<M>(local: M[], server: M[]): M[] {
  const bounded = dropFlattenedTail(boundMessages(server));
  return bounded.length >= local.length ? bounded : local;
}

/** THE FLATTENED DUPLICATE (his report, 2026-10-07: a web thread ended in a
 *  "Thinking" row and one paragraph that was every status line of the turn
 *  glued together). A turn is a run of assistant parts — text, tool rows,
 *  text — and a copy of the thread from elsewhere can carry, after them, one
 *  more assistant message whose text is all those parts joined with nothing
 *  between. That tail says nothing the parts did not; it goes. */
const words = (s: unknown): string => String(s ?? "").replace(/\s+/g, "");
export function dropFlattenedTail<M>(messages: M[]): M[] {
  const rows = messages as Array<Record<string, unknown>>;
  const last = rows[rows.length - 1];
  if (!last || last.role !== "assistant" || last.kind || !words(last.text)) return messages;
  let i = rows.length - 2;
  const parts: string[] = [];
  for (; i >= 0 && rows[i].role !== "user"; i--) {
    const r = rows[i];
    if (r.role === "assistant" && !r.kind && typeof r.text === "string") parts.unshift(r.text);
  }
  if (!parts.length) return messages;
  return words(parts.join("")) === words(last.text) ? (messages.slice(0, -1) as M[]) : messages;
}

