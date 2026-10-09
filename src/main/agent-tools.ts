/**
 * agent-tools.ts — THE MEMBER'S AGENTS, as tools (his order, 2026-09-29:
 * "extend the mcp tools for the app to include generating agents").
 *
 * The same records Settings → Build → Agents edits (local-agents.ts), reached
 * through the relay dispatch every app tool uses, so the local MCP server and
 * any relay client get the same four calls:
 *
 *   agents.list                 — the roster: slug, name, when to use it, model
 *   agents.get    {agent}       — one agent in full, brief included
 *   agents.save   {agent?, name, description?, brief?, model?, kind?, cli?}
 *                               — make or update one; with no brief the app
 *                                 WRITES one on the member's default model;
 *                                 kind "cli" + cli names a CLI agent run
 *                                 headless (his order, 2026-10-07)
 *   agents.delete {agent}
 *
 * A SUPER POWER IS THE AGENT PLUS ITS POWERS (his order, 2026-10-09: "the
 * agent / glyphh skill… well versed in super powers"): a save also carries
 * the powers it holds, the connections and models it may use, its folders,
 * personality and thinking — what the super power's Edit page sets, so a
 * super power built in a chat is whole the moment it lands.
 *
 * Every save is checked the way the page checks it: a model must be one the
 * member's team carries (a slot naming anything else would be refused at spawn
 * time), and making an agent never silently overwrites one that exists.
 */

import { registerRelayHandler } from "./relay-client.js";
import { deleteAgent, getAgent, listAgents, saveAgent, slugify } from "./local-agents.js";
import { generateAgentBrief } from "./agent-brief.js";
import { listLoopModels } from "./loop-models.js";
import { bareModel } from "./org-models.js";
import { listSkills } from "./skills-fs.js";
import { getClient } from "./glyphh-client.js";
import { agentRoleOf, cleanEffort, cleanNames, cleanPersonality, AGENT_EFFORTS, type AgentRole } from "../shared/member-library.js";

interface SaveParams {
  agent?: unknown; name?: unknown; description?: unknown; brief?: unknown; model?: unknown; role?: unknown;
  powers?: unknown; connections?: unknown; models?: unknown; folders?: unknown; personality?: unknown; effort?: unknown; superPowers?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function summary(a: ReturnType<typeof getAgent>) {
  return {
    agent: a.slug, name: a.name, description: a.description, model: bareModel(a.model || "") || null, role: agentRoleOf(a), hasBrief: !!a.prompt.trim(),
    powers: (a.skills ?? []).map((id) => id.slice(id.indexOf(":") + 1)), connections: a.connections ?? [], models: a.models ?? [],
    folders: a.folders ?? [], superPowers: a.superPowers ?? [], personality: a.personality ?? null, effort: a.effort ?? null,
  };
}

/** CONNECTIONS ARE LOOKED UP, NEVER GUESSED (his report, 2026-10-09: "the
 *  agent got the connector name wrong, it shouldn't guess… so the link can
 *  be used to map it"). Each name is checked against the connector catalog:
 *  an exact app id is kept; an exact match on a connector's NAME maps to its
 *  id; anything else is refused with the nearest real connectors, so the
 *  caller looks it up and saves again. A catalog that can't be read keeps
 *  the names as given (the rail's badge and the Connect door still show them). */
export async function checkedConnections(raw: unknown): Promise<string[]> {
  const want = cleanNames(raw);
  const out: string[] = [];
  const wrong: string[] = [];
  for (const name of want) {
    const words = name.replace(/[_-]+/g, " ").trim();
    let apps: Array<{ id: string; name: string }>;
    try { apps = (await getClient().connections.apps({ search: words, limit: 10 })).apps.map((a) => ({ id: a.id, name: a.name })); }
    catch { out.push(name); continue; }
    const hit = apps.find((a) => a.id === name)
      ?? apps.find((a) => a.name.toLowerCase() === words.toLowerCase());
    if (hit) { if (!out.includes(hit.id)) out.push(hit.id); continue; }
    const near = apps.slice(0, 5).map((a) => `${a.id} (${a.name})`).join(", ");
    wrong.push(`"${name}"${near ? ` — did you mean: ${near}` : " — no connector matches"}`);
  }
  if (wrong.length) throw new Error(`not a connector slug: ${wrong.join("; ")}. Look it up with connector_tools { query } and use the exact app slug it returns.`);
  return out;
}

/** Power slugs (or ids) → the library ids a super power holds; an unknown one is refused by name. */
function checkedPowers(raw: unknown): string[] {
  const want = cleanNames(raw);
  const have = listSkills("skill");
  const missing: string[] = [];
  const ids = want.map((w) => {
    const hit = have.find((sk) => sk.id === w || sk.id.slice(sk.id.indexOf(":") + 1) === w || sk.name === w);
    if (!hit) missing.push(w);
    return hit?.id ?? "";
  });
  if (missing.length) throw new Error(`no power called ${missing.map((m) => `"${m}"`).join(", ")} — build it first with skill_save, or pick from skills_list`);
  return [...new Set(ids)];
}
/** THE BOTS PANEL's role (2026-10-08): an orchestrator plans and hands out; a worker does one kind of work. */
function checkedRole(raw: unknown): AgentRole {
  const r = str(raw);
  if (r === "orchestrator" || r === "worker") return r;
  throw new Error(`role must be "orchestrator" or "worker", not "${r}"`);
}

async function checkedModel(raw: string): Promise<string> {
  const m = bareModel(raw);
  if (!m) return "";
  const list = await listLoopModels().catch(() => null);
  if (!list?.ok) return m;   // the list couldn't be read: the gateway decides at spawn time
  if (list.models.some((x) => x.id === m)) return m;
  const valid = list.models.map((x) => x.id).slice(0, 30).join(", ");
  throw new Error(`"${m}" is not one of this member's models. Use one of: ${valid || "(none available)"} — or omit model to run on the main agent's.`);
}

export function installAgentRelayHandlers(): void {
  registerRelayHandler("agents.list", () => listAgents().map(summary));

  registerRelayHandler("agents.get", (params) => {
    const ref = str((params as { agent?: unknown } | null)?.agent);
    if (!ref) throw new Error("agents.get requires { agent }");
    const a = getAgent(ref);
    return { ...summary(a), brief: a.prompt };
  });

  registerRelayHandler("agents.save", async (params) => {
    const p = (params ?? {}) as SaveParams;
    const ref = str(p.agent);
    const existing = ref ? listAgents().find((a) => a.slug === ref) : undefined;
    if (ref && !existing) throw new Error(`no agent "${ref}" — call agents_list, or omit agent to make a new one`);
    const name = str(p.name) || existing?.name || "";
    if (!name) throw new Error("an agent needs a name");
    // MAKING never overwrites: a name that slugs onto an existing agent is that
    // agent, and changing it is an explicit update.
    if (!ref && listAgents().some((a) => a.slug === slugify(name))) {
      throw new Error(`an agent called "${name}" already exists — pass { agent: "${slugify(name)}" } to update it`);
    }
    const description = p.description === undefined ? existing?.description ?? "" : str(p.description);
    const model = p.model === undefined ? existing?.model ?? "" : await checkedModel(str(p.model));
    const role = p.role === undefined ? agentRoleOf(existing) : checkedRole(p.role);
    let brief = p.brief === undefined ? existing?.prompt ?? "" : str(p.brief);
    let generated = false;
    // NO BRIEF, THE APP WRITES ONE — the same generator as the page's wand, on
    // the member's default model. An agent without a brief can't be handed work.
    if (!brief) {
      const g = await generateAgentBrief({ name, description, model });
      if (!g.ok) throw new Error(`the brief could not be written: ${g.error}`);
      brief = g.brief;
      generated = true;
    }
    // ITS POWERS (2026-10-09): each field left out keeps what it has.
    const powers = p.powers === undefined ? undefined : checkedPowers(p.powers);
    const connections = p.connections === undefined ? undefined : await checkedConnections(p.connections);
    const models = p.models === undefined ? undefined : await Promise.all(cleanNames(p.models).map((m) => checkedModel(m)));
    const personality = p.personality === undefined ? undefined : cleanPersonality(p.personality);
    if (p.personality !== undefined && personality === undefined) throw new Error("personality is 1 (serious) to 5 (playful)");
    const effort = p.effort === undefined ? undefined : cleanEffort(p.effort);
    if (p.effort !== undefined && effort === undefined) throw new Error(`effort is one of ${AGENT_EFFORTS.join(", ")}`);
    const row = saveAgent({
      ...(existing ? { slug: existing.slug } : {}), name, description, prompt: brief, model, role,
      ...(powers ? { skills: powers } : {}),
      ...(connections !== undefined ? { connections } : {}),
      ...(models ? { models: models.filter(Boolean) } : {}),
      ...(p.folders !== undefined ? { folders: cleanNames(p.folders) } : {}),
      ...(personality !== undefined ? { personality } : {}),
      ...(effort !== undefined ? { effort } : {}),
      // The super powers it holds: checked for itself and loops by saveAgent.
      ...(p.superPowers !== undefined ? { superPowers: cleanNames(p.superPowers) } : {}),
    });
    return { ...summary(row), created: !existing, generatedBrief: generated, brief: row.prompt };
  });

  registerRelayHandler("agents.delete", (params) => {
    const ref = str((params as { agent?: unknown } | null)?.agent);
    if (!ref) throw new Error("agents.delete requires { agent }");
    getAgent(ref);   // a clear "not found" rather than a silent no-op
    deleteAgent(ref);
    return { agent: ref, deleted: true };
  });
}
