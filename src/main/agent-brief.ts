/**
 * agent-brief.ts — WRITE AN AGENT'S BRIEF WITH AI (his order, 2026-09-29: "add
 * a magic wand… to generate with ai… that should make a call to the default
 * agent selected by the user with the info entered for the agent to generate a
 * brief").
 *
 * One call, on the member's DEFAULT model (Settings → General → Default model,
 * else the team's flagged default), through the gateway on their own key — the
 * same lane and the same bill as a turn. What goes in is what the person typed:
 * the agent's name, when to use it, the model it will run on, and any draft
 * brief (which the call improves rather than discards).
 *
 * The same generator writes the brief when an MCP client asks `agent_save` for
 * an agent without one, so "make me a researcher" works from any surface.
 */

import { ipcMain } from "electron";
import { streamMessage } from "@glyphh/sdk/loop";
import { gatewayCreds } from "./gateway-token.js";
import { bareModel, orgRequiredModel } from "./org-models.js";
import { listLoopModels } from "./loop-models.js";
import { getPreference } from "./stores/preferences-db.js";

export interface BriefInput { name?: string; description?: string; model?: string; draft?: string }
export type BriefResult = { ok: true; brief: string; model: string } | { ok: false; error: string };

const SYSTEM = [
  "You write the standing BRIEF for a sub-agent in Glyphh, a desktop AI workspace.",
  "A main agent hands this sub-agent one self-contained piece of work at a time. The sub-agent cannot see the main conversation or other agents; it gets its brief, the task, and whatever context the main agent passes. Its final message is the only thing the main agent receives.",
  "Write the brief in the second person (\"You …\"). Cover, briefly and concretely: what this agent is for and its standard of quality; how it works (the steps it takes, the sources or tools it prefers, what it checks before it answers); and exactly what its final report contains and how it is laid out.",
  "It must not ask questions or offer next steps — nobody is there to answer. It reports what it found or did, in full, and says plainly what it could not do.",
  "If a draft brief is given, keep its intent and specifics and make it clearer and more complete; do not drop instructions the draft contains.",
  "Output ONLY the brief: no title, no preamble, no quotes. Aim for 120–260 words; short paragraphs or a few bullets are fine.",
].join("\n");

/** The model the member chose as their default, if their team still carries
 *  it; else the team/org default; else "". A pick the team dropped would be
 *  refused by the gateway, so it is never used. */
export async function defaultModel(): Promise<string> {
  const picked = bareModel(String(getPreference<string>("defaultModel", "") || ""));
  if (picked) {
    const list = await listLoopModels().catch(() => null);
    if (list?.ok && list.models.some((m) => m.id === picked)) return picked;
  }
  return orgRequiredModel();
}

export async function generateAgentBrief(input: BriefInput): Promise<BriefResult> {
  const name = String(input.name ?? "").trim();
  const description = String(input.description ?? "").trim();
  const draft = String(input.draft ?? "").trim();
  if (!name && !description && !draft) {
    return { ok: false, error: "Say what the agent is for first — a name and when to use it — so there is something to write a brief from." };
  }
  const creds = await gatewayCreds().catch(() => null);
  if (!creds) return { ok: false, error: "Your organization's gateway isn't available, so nothing can be generated right now." };
  const model = await defaultModel();
  if (!model) return { ok: false, error: "Pick a default model in Settings → General first — that's the model that writes the brief." };

  const facts = [
    name ? `Name: ${name}` : "",
    description ? `When the main agent should use it: ${description}` : "",
    input.model ? `It runs on: ${bareModel(input.model)}` : "It runs on the main agent's model.",
    draft ? `Draft brief to improve:\n${draft}` : "",
  ].filter(Boolean).join("\n\n");

  try {
    const res = await streamMessage({
      baseUrl: creds.baseUrl, token: creds.token, timeoutMs: 90_000,
      body: { model, max_tokens: 1200, system: SYSTEM, messages: [{ role: "user", content: facts }] },
    });
    const brief = res.content
      .map((b) => (b.type === "text" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
      .join("")
      .trim();
    if (!brief) return { ok: false, error: "The model returned nothing. Try again, or add a little more about what the agent is for." };
    return { ok: true, brief, model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function registerAgentBriefIpc(): void {
  ipcMain.handle("agent-brief-generate", (_e, input: BriefInput) => generateAgentBrief(input ?? {}));
}
