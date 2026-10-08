/**
 * task-slot-pick.ts — WHO FILLS A TASK SLOT, as one pure decision.
 *
 * His order (2026-10-07): "allow agents and tasks to define cli or glyphh
 * agents with models". A slot names an agent, or nothing, and may carry its
 * own model and its own lane. The rules, in order:
 *
 *   - the SLOT's model wins over the agent's own: the task author chose it
 *     for this step (before, the agent's model silently beat the slot's);
 *   - an UNBOUND slot (no agent) runs as the default Glyphh agent on the
 *     org/default model with an empty brief — never, silently, as whichever
 *     agent happens to sort first in the roster;
 *   - a slot naming an agent that no longer exists FAILS the run, naming the
 *     slot, instead of running as someone else;
 *   - a slot runs through a CLI (claude, codex, …) when the agent it names is
 *     a CLI agent (kind/cli on the roster entry) or when the slot itself says
 *     kind:"cli" + cli. Everything else is the Glyphh loop.
 *
 * Pure: the roster and the agent's standing context are handed in, so the
 * decision is testable without a library or a database.
 */

export type SlotKind = "glyphh" | "cli";

/** One agent as the roster offers it to a slot. kind/cli come from the
 *  agents lane (local-agents.ts agentRoster); a row without them is a Glyphh
 *  agent. */
export interface SlotRosterEntry { id: string; name: string; kind?: SlotKind; cli?: string }

/** What a task.json slot says. */
export interface SlotShape { name: string; agent: string | null; model?: string; kind?: SlotKind; cli?: string }

/** What an agent brings to a run: its standing brief and its own model. */
export interface SlotAgentContext { prompt: string; model?: string }

export interface SlotBinding {
  kind: SlotKind;
  /** The CLI id when kind is "cli". */
  cli?: string;
  agentId: string | null;
  agentName: string;
  /** The standing brief that rides ahead of the step's prompt ("" when unbound). */
  prompt: string;
  /** The model the step runs on; undefined = the org/default model. */
  model?: string;
}

export const DEFAULT_AGENT_NAME = "Default Glyphh agent";

export function pickSlotAgent(
  slot: SlotShape,
  roster: SlotRosterEntry[],
  contextOf: (agentId: string) => SlotAgentContext | null,
): SlotBinding {
  const slotModel = slot.model && String(slot.model).trim() ? String(slot.model).trim() : undefined;
  if (!slot.agent) {
    // Unbound: the default Glyphh agent, or the CLI the slot itself names.
    if (slot.kind === "cli") {
      if (!slot.cli) throw new Error(`slot "${slot.name}" says kind "cli" but names no CLI`);
      return { kind: "cli", cli: slot.cli, agentId: null, agentName: slot.cli, prompt: "", ...(slotModel ? { model: slotModel } : {}) };
    }
    return { kind: "glyphh", agentId: null, agentName: DEFAULT_AGENT_NAME, prompt: "", ...(slotModel ? { model: slotModel } : {}) };
  }
  const who = roster.find((a) => a.id === slot.agent);
  if (!who) {
    throw new Error(`slot "${slot.name}" names an agent "${slot.agent}" that no longer exists — pick another on the task's Agents tab`);
  }
  const ctx = contextOf(who.id);
  // THE SLOT'S MODEL WINS; the agent's own is the fallback.
  const model = slotModel ?? (ctx?.model && String(ctx.model).trim() ? String(ctx.model).trim() : undefined);
  const kind: SlotKind = slot.kind ?? who.kind ?? "glyphh";
  const cli = slot.kind === "cli" ? (slot.cli || who.cli) : who.cli;
  if (kind === "cli" && !cli) throw new Error(`slot "${slot.name}" runs through a CLI but neither it nor "${who.name}" names one`);
  return {
    kind,
    ...(kind === "cli" ? { cli } : {}),
    agentId: who.id,
    agentName: who.name,
    prompt: ctx?.prompt || "",
    ...(model ? { model } : {}),
  };
}
