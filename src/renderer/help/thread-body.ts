/**
 * thread-body — what a thread's push may carry, and how a transcript held
 * on R2 is read (his report, 2026-10-06: a rail click on the web pushed an
 * adopted thread's metadata with `messages: []`; the server took that as the
 * whole transcript and zeroed the thread, so the row left every list and the
 * agent showed nothing). Pure; thread-store.ts calls these.
 */

export interface BodyLike { messages: unknown[]; messageCount?: number }

/** A thread adopted from the server carries only a count until opened. Its
 *  body is loaded once it holds messages, or once it is known to have none. */
export function bodyLoaded(c: BodyLike): boolean {
  return c.messages.length > 0 || !((c.messageCount ?? 0) > 0);
}

/** The messages a push carries: the thread's own when its body is loaded,
 *  nothing at all when it is not — the server then keeps its transcript. */
export function pushMessages(c: BodyLike): { messages: unknown[] } | Record<string, never> {
  return bodyLoaded(c) ? { messages: c.messages } : {};
}

/** The count after a body arrives: never below what is now held, never
 *  shrunk to the server's preview when its transcript is longer. */
export function countAfterLoad(loaded: number, serverCount: number | undefined): number {
  return Math.max(loaded, serverCount ?? 0);
}

/** A transcript object: one JSON message per line; blank and torn lines
 *  are skipped, a line that is not a message is skipped. */
export function parseTranscript(text: string): Array<{ role: string }> {
  const out: Array<{ role: string }> = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      const m = JSON.parse(t) as { role?: unknown };
      if (m && typeof m === "object" && typeof m.role === "string") out.push(m as { role: string });
    } catch { /* a torn line */ }
  }
  return out;
}

/** The server's thread read holds the last few messages as a preview and a
 *  signed URL for the whole transcript when it is longer. */
export function needsTranscript(full: { messages: unknown[]; messageCount?: number; transcriptUrl?: string | null }): string | null {
  return full.transcriptUrl && (full.messageCount ?? 0) > full.messages.length ? full.transcriptUrl : null;
}
