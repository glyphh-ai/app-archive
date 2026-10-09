/**
 * super-power-build.ts — A NEW SUPER POWER, BUILT BY GLYPHH (his order,
 * 2026-10-09: "a new button next to super powers that opens a new super power
 * modal that has prompt etc. something super super cool that gets the user
 * pumped about super powers"). The rules main (super-power-build-ipc.ts) runs
 * a headless Glyphh turn with, the stages the modal lights up, and how it
 * reads what Glyphh says it made. Pure, for the tests.
 */

export const SUPER_POWER_ASK_MAX = 2000;

/** What Glyphh is told: the Glyphh power's recipe, end to end, then one line of JSON. */
export function superPowerBuildPrompt(ask: string): string {
  return [
    "The member is making a new SUPER POWER from the rail's + button. A super power is a bot on the rail: a name, when to use it, a standing brief, and the powers it holds.",
    "Build the whole thing, then stop:",
    "1. Plan it: its job, the powers it needs, the connected accounts it calls, the model it should run on.",
    "2. Reuse what the member has: find_tools, skills_list. Build each missing power with skill_save (a name, a description that says when to use it, its instructions; a program only when it must run on its own). Never pass `type`.",
    "3. Look up every connected account it needs with connector_tools { query } and use the EXACT app slug it returns — never guess one (the save refuses a slug that is not in the catalog and names the real ones).",
    "4. Make it with agent_save: a short memorable name, a one-line description of when to use it, `powers` (the slugs you reused or built), `connections` (those exact slugs, connected yet or not), and a personality and effort that fit the job. Leave `brief` out; Glyphh writes it.",
    "Do not ask questions: make sensible choices. Do not run it. Do not make its avatar; the app draws it.",
    "End your reply with ONE line of JSON and nothing after it: {\"agent\":\"…\",\"name\":\"…\",\"powers\":[\"…\"],\"connections\":[\"…\"]}",
    "",
    "What the member asked for:",
    String(ask ?? "").trim().slice(0, SUPER_POWER_ASK_MAX),
  ].join("\n");
}

export interface BuiltSuperPowerClaim { agent: string; name: string; powers: string[]; connections: string[] }

const slugs = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((c) => String(c ?? "").trim().toLowerCase()).filter((c) => /^[a-z0-9_.:-]{1,80}$/.test(c)))] : [];

/** The last JSON object in Glyphh's reply that names the super power it made, or null. */
export function parseBuiltSuperPower(text: string): BuiltSuperPowerClaim | null {
  const found = String(text ?? "").match(/\{[^{}]*"agent"[^{}]*\}/g);
  if (!found?.length) return null;
  for (let i = found.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(found[i]!) as Record<string, unknown>;
      const agent = String(o.agent ?? "").trim();
      if (!agent) continue;
      return { agent, name: String(o.name ?? agent).trim() || agent, powers: slugs(o.powers), connections: slugs(o.connections) };
    } catch { /* not this one */ }
  }
  return null;
}

/** How long a build may take before it is stopped: it may build several powers. */
export const SUPER_POWER_BUILD_LIMIT_MS = 8 * 60 * 1000;

/** THE STAGES the modal lights up, in order (its labels live with the modal,
 *  help/super-power-new.ts: the renderer never imports src/shared). */
export type SuperPowerStage = "plan" | "powers" | "connect" | "life" | "face";

/** A progress beat: the stage it belongs to and the line under the spinner. */
export interface SuperPowerBeat { stage: SuperPowerStage; line: string }

/** A tool, as the modal says what Glyphh is doing with it. */
export function superPowerToolBeat(name: string): SuperPowerBeat {
  const n = String(name ?? "").toLowerCase();
  if (n.includes("agent_save")) return { stage: "life", line: "Giving it a name, a brief and its powers" };
  if (n.includes("skill_save")) return { stage: "powers", line: "Forging a new power" };
  if (n.includes("skill") || n.includes("task")) return { stage: "powers", line: "Looking through your powers" };
  if (n.includes("connector") || n.includes("connection")) return { stage: "connect", line: "Checking your connections" };
  if (n.includes("model")) return { stage: "plan", line: "Picking its model" };
  return { stage: "plan", line: "Finding the right tools" };
}
