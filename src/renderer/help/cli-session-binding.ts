/**
 * cli-session-binding.ts — the CHAT ⇄ CLI-SESSION binding, as pure rules.
 *
 * His report, 2026-09-25: "when the user is in the cli and switches to the
 * glyphh session the state is not in synch. They MUST always be in sync."
 * Three of the four causes were binding bugs, and all three were arithmetic
 * done inline in code.ts — a module that cannot be loaded without a `window`,
 * so none of it was ever under test. The rules live here instead: no DOM, no
 * IPC, no state, importable from a test. code.ts holds the wiring.
 *
 * Kept inside src/renderer (not src/shared): the renderer build pins tsc's
 * rootDir to this directory, and an import that escapes it silently moves the
 * whole emit to dist/renderer/renderer — which nothing loads. See
 * scripts/check-renderer-emit.mjs.
 *
 * THE LAW: a binding is PER CLI. A claude session id must never feed a codex
 * resume (his ruling, 2026-09-14). `cliSessionIds[cli]` is the truth;
 * `cliSessionId` is a legacy single slot that only ever meant the claude lane.
 */

/** Whatever a chat row carries about its CLI sessions. */
export interface CliBound {
  /** Per-CLI bindings — the truth. */
  cliSessionIds?: Record<string, string>;
  /** Legacy single slot, claude lane only. */
  cliSessionId?: string;
}

/** A loop as the renderer holds it. `description` mirrors `cli` for the model
 *  chip's filter, which is exactly why reading it as the key was survivable —
 *  and why the built-in `default` row broke it. */
export interface LoopRow { id: string; cli?: string; description?: string }

export const DEFAULT_CLI = "claude";

/**
 * The CLI a chat runs on: its loop's own `cli` field.
 *
 * NEVER `description` (his report, 2026-09-25). refreshLoops() assigns
 * `description = a.cli` for server-listed loops, so reading it worked by
 * coincidence — but the BUILT-IN default row carries the prose "The standard
 * Glyphh agent loop." there. A session on that loop resolved its binding key
 * to that sentence, missed the map, and silently resumed on claude.
 */
export function sessionCliOf(loopId: string | undefined, loops: LoopRow[]): string {
  return loops.find((x) => x.id === (loopId || ""))?.cli || DEFAULT_CLI;
}

/**
 * The session id to resume for one CLI lane — the per-CLI map first, then the
 * legacy slot, and the legacy slot ONLY for claude.
 */
export function cliSidFor(row: CliBound | undefined, cli: string): string | null {
  if (!row) return null;
  const lane = cli || DEFAULT_CLI;
  const hit = row.cliSessionIds?.[lane];
  if (hit) return hit;
  return lane === DEFAULT_CLI ? (row.cliSessionId ?? null) : null;
}

/**
 * Write a binding. Returns true when something changed, so the caller knows
 * whether a save is owed.
 *
 * Mirroring into the legacy slot is claude-only: a codex sid parked there is
 * what a stale claude resume would later pick up.
 */
export function applyCliBinding(row: CliBound, cli: string, sid: string): boolean {
  if (!sid) return false;
  const lane = cli || DEFAULT_CLI;
  const map = (row.cliSessionIds ??= {});
  const changed = map[lane] !== sid || (lane === DEFAULT_CLI && row.cliSessionId !== sid);
  map[lane] = sid;
  if (lane === DEFAULT_CLI) row.cliSessionId = sid;
  return changed;
}

/**
 * Find the chat already holding a session id, ACROSS EVERY LANE.
 *
 * The old lookup only checked the legacy slot, which no codex/gemini/copilot/
 * cursor session ever populates — so re-adopting one never found its chat and
 * forked a new one on every hop. One conversation, a new rail row each time.
 */
export function chatForCliSession<T extends CliBound>(chats: readonly T[], sid: string): T | undefined {
  if (!sid) return undefined;
  return chats.find((c) => Object.values(c.cliSessionIds ?? {}).includes(sid))
    ?? chats.find((c) => c.cliSessionId === sid);
}

/** Drop every binding pointing at a dead session; true if the row changed. */
export function forgetCliSession(row: CliBound, sid: string): boolean {
  let touched = false;
  if (row.cliSessionId === sid) { row.cliSessionId = undefined; touched = true; }
  for (const [lane, v] of Object.entries(row.cliSessionIds ?? {})) {
    if (v === sid) { delete row.cliSessionIds![lane]; touched = true; }
  }
  return touched;
}

/**
 * ONE TITLE GRAMMAR for a session row, whatever store it came from (his
 * report, 2026-09-25: "the left rail session names are way too long"). The
 * native CLI readers cut at 80, our own sessions at 42 — in one merged list
 * that reads as two different products. Callers keep the full text on the
 * row's tooltip.
 */
export const SESS_TITLE_MAX = 42;
export function sessionDisplayTitle(t: string | undefined): string {
  const s = String(t ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "Session";
  return s.length > SESS_TITLE_MAX ? `${s.slice(0, SESS_TITLE_MAX - 1).trimEnd()}…` : s;
}
