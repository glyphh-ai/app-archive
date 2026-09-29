/**
 * session-title.ts — ONE TITLE GRAMMAR for a session row.
 *
 * His report, 2026-09-25: "the left rail session names are way too long and
 * they don't match what claude or codex show." The native CLI readers cut at
 * 80, our own sessions at 42 — in one merged list that read as two different
 * products.
 *
 * This file also held the chat ⇄ CLI-session binding (a session id per vendor
 * CLI, and the rules for reading it). That went with the bridge, 2026-09-28:
 * the chat IS the session now, so there is nothing to bind.
 *
 * Kept inside src/renderer (not src/shared): the renderer build pins tsc's
 * rootDir to this directory, and an import that escapes it silently moves the
 * whole emit to dist/renderer/renderer — which nothing loads. See
 * scripts/check-renderer-emit.mjs.
 */

export const SESS_TITLE_MAX = 42;

/** A row's visible name: one line, collapsed whitespace, elided past the cap.
 *  Callers keep the full text on the row's tooltip. */
export function sessionDisplayTitle(t: string | undefined): string {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "Session";
  return s.length > SESS_TITLE_MAX ? `${s.slice(0, SESS_TITLE_MAX - 1).trimEnd()}…` : s;
}
