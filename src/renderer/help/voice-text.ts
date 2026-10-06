/**
 * voice-text — what the composer shows while the member speaks (his order,
 * 2026-10-07: "both should stream the voice content into the window as the
 * user is speaking"). The text that was in the box when the take began is the
 * base; every partial transcript replaces the previous one after it. Pure.
 */

/** The box's text: the base, then the live transcript, one space between. */
export function dictationText(base: string, transcript: string): string {
  const t = transcript.trim();
  if (!t) return base;
  if (!base) return t;
  return /\s$/.test(base) ? base + t : `${base} ${t}`;
}

/** WHAT A FAILED TRANSCRIPTION SAYS on the mic chip (his report, 2026-10-07:
 *  the mic heard him and nothing landed — the wall had refused the model and
 *  the desktop swallowed the error). Electron wraps a main-process throw as
 *  "Error invoking remote method 'voice-transcribe': Error: <message>"; the
 *  member reads the message. Pure. */
export function transcribeErrorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const msg = raw.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^(?:Error|GlyphhError):\s*/, "").trim();
  return msg ? `Transcription failed — ${msg}` : "Transcription failed.";
}

/** How often a growing take is sent for a partial transcript, in ms. */
export const PARTIAL_EVERY_MS = 2_500;
/** A take shorter than this is not worth a partial (the final transcript covers it). */
export const PARTIAL_MIN_MS = 1_500;

/** Is it time for another partial: enough audio, the interval passed, none in flight. */
export function partialDue(now: number, startedAt: number, lastAt: number, inflight: boolean): boolean {
  if (inflight) return false;
  if (now - startedAt < PARTIAL_MIN_MS) return false;
  return now - lastAt >= PARTIAL_EVERY_MS;
}
