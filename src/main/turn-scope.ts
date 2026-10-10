/**
 * turn-scope.ts — THE LOOP HOLDS EVERY TURN TO ITS HOLDER'S POWERS (his order,
 * 2026-10-10: "the LOOP MUST MUST respect it at all costs... NO EXCEPTIONS").
 * The rules are shared/turn-scope.ts; this says who holds a chat and reads
 * what the rules need from this machine.
 *
 *   bots/<slug>   the super power's thread: its lists, and nothing else
 *   a headless    the agent it runs as (holdAs), else Glyphh
 *   any other     Glyphh: everything but what the member withheld
 *
 * A run started from inside a turn (skill_run, a task's slot) is held to the
 * turn that started it too: its chain runs back through every caller.
 *
 * Every tool call goes through `loopScope` before the loop's permission gate;
 * every turn goes through `turnRefusal` before it starts.
 */

import { getAgent, glyphhRow } from "./local-agents.js";
import { getTaskSpec } from "./task-runner.js";
import { getLocalDb } from "./local-db.js";
import { glyphhReach, holds, holdsFolder, scopeRefusal, superPowerReach, type Reach, type ScopeCallLike, type ScopeLookups } from "../shared/turn-scope.js";

/** A headless run's holder and the turn that started it, by its chat id, while it runs. */
const heldAs = new Map<string, { slug: string | null; parent: string | null }>();
const MAX_CHAIN = 8;
/** The model each chat's turn runs on: an empty model slot is the main agent's. */
const turnModels = new Map<string, string>();

export function holdAs(chatId: string, slug: string | null | undefined, parent: string | null = null): () => void {
  const entry = { slug: String(slug ?? "").trim() || null, parent: parent && parent !== chatId ? parent : null };
  if (!entry.slug && !entry.parent) return () => undefined;
  heldAs.set(chatId, entry);
  return () => { if (heldAs.get(chatId) === entry) heldAs.delete(chatId); };
}

export function noteTurnModel(chatId: string, model: string): void {
  if (model) turnModels.set(chatId, model);
}

/** The slug that holds a chat: a super power's, or null for Glyphh. */
export function holderSlugOf(chatId: string): string | null {
  const as = heldAs.get(chatId);
  if (as) return as.slug;
  return chatId.startsWith("bots/") ? chatId.slice(5) || null : null;
}

/** The reaches a chat is held to: its own holder, then each turn that started it. */
function chainOf(chatId: string, turnModel: string): Reach[] | null {
  const out: Reach[] = [];
  let at: string | null = chatId;
  for (let i = 0; at && i < MAX_CHAIN; i++) {
    const r = reachOf(holderSlugOf(at), i === 0 ? turnModel : turnModels.get(at) ?? "");
    if (!r) return null;
    out.push(r);
    at = heldAs.get(at)?.parent ?? null;
  }
  return at ? null : out;
}

function glyphh(): Reach {
  const row = glyphhRow();
  return glyphhReach(row?.name?.trim() || "Glyphh", row?.withheld);
}

/** The reach of a holder, or null when its record is unreadable (every call refuses). */
export function reachOf(slug: string | null, turnModel = ""): Reach | null {
  if (!slug) return glyphh();
  try { return superPowerReach(getAgent(slug), turnModel); } catch { return null; }
}

const lookups: ScopeLookups = {
  taskConnections: (slug) => { try { return getTaskSpec(slug).connections; } catch { return null; } },
  scheduleTarget: (id) => {
    try {
      const row = getLocalDb().prepare("SELECT kind, target FROM loop_schedules WHERE id = ?").get(id) as { kind?: string; target?: string } | undefined;
      return row ? { kind: String(row.kind ?? ""), target: String(row.target ?? "") } : null;
    } catch { return null; }
  },
};

/** The loop's scope seam (@glyphh/sdk/loop LoopScope). */
export function loopScope(call: ScopeCallLike & { chatId: string; agent?: string }): string | null {
  const chain = chainOf(call.chatId, turnModels.get(call.chatId) ?? "");
  const child = call.agent ? reachOf(call.agent) : undefined;
  if (!chain || child === null) return "Not run: the super power this turn runs as could not be read.";
  return scopeRefusal(call, child ? [...chain, child] : chain, lookups);
}

/** Why a turn may not start, or null. `scratch` = a folder made for this run alone. */
export function turnRefusal(chatId: string, opts: { folder: string; model: string; scratch?: boolean }): string | null {
  const chain = chainOf(chatId, opts.model);
  if (!chain) return "The super power this conversation is with could not be read.";
  for (const r of chain) {
    if (opts.model && !holds(r, "models", opts.model)) return `${r.name} doesn't hold the model ${opts.model}. Pick one of its models, or add it on its Edit page.`;
    if (!opts.scratch && !holdsFolder(r, opts.folder)) {
      return r.glyphh
        ? `Glyphh was denied ${opts.folder}. Pick another folder, or give it back on Glyphh's Edit page.`
        : `${r.name} doesn't hold ${opts.folder}. Pick one of its folders, or add this one on its Edit page.`;
    }
  }
  return null;
}
