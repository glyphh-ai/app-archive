/**
 * turn-scope.ts — WHAT A TURN MAY TOUCH (his order, 2026-10-10: "Each super
 * power gets its scope of ability from the edit -> powers list... the LOOP
 * MUST MUST respect it at all costs... NO EXCEPTIONS"). Pure, so main
 * (turn-scope wiring, agent-ipc.ts) and the tests read the same rules.
 *
 * A turn has a HOLDER: a super power (its lists are all it holds, an empty
 * list holds nothing) or Glyphh (everything but what was withheld). A
 * sub-agent's call is held to its own record AND to the turn that started it:
 * delegating never widens. Nothing a turn creates or runs — a super power, a
 * task, a schedule — may carry more than the turn holds, and no turn edits the
 * record that scopes it.
 */

import { GLYPHH_AGENT, type AgentRowLike, type AgentWithheld } from "./member-library.js";
import { withinFolder } from "./bot-powers.js";

export type ReachKind = "connections" | "skills" | "superPowers" | "models" | "folders";
const KINDS: readonly ReachKind[] = ["connections", "skills", "superPowers", "models", "folders"];

export interface Reach {
  slug: string;
  name: string;
  glyphh: boolean;
  /** A super power: exactly these. Glyphh: null (everything but `withheld`). */
  holds: Record<ReachKind, ReadonlySet<string> | null>;
  withheld: Record<ReachKind, ReadonlySet<string>>;
}

/** The call as the loop's scope sees it (@glyphh/sdk/loop ScopeCall). */
export interface ScopeCallLike {
  kind: "builtin" | "artifact" | "belt" | "catalog" | "mcp" | "account" | "spawn";
  tool: string;
  family?: string;
  local?: boolean;
  input: Record<string, unknown>;
}

/** What the rules read from the machine. */
export interface ScopeLookups {
  /** A task's declared connections, or null when there is no such task. */
  taskConnections(slug: string): string[] | null;
  /** A schedule's target, or null when there is no such schedule. */
  scheduleTarget(id: string): { kind: string; target: string } | null;
}

const slugKey = (v: unknown): string => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
/** A power is named by its slug; the library's ids wear a `type:` prefix. */
const powerKey = (v: unknown): string => { const s = String(v ?? "").trim().toLowerCase(); return s.slice(s.indexOf(":") + 1); };
const modelKey = (v: unknown): string => String(v ?? "").replace(/"/g, "").replace(/^[a-z0-9_-]+::/i, "").trim().toLowerCase();
const KEY: Record<Exclude<ReachKind, "folders">, (v: unknown) => string> = {
  connections: slugKey, skills: powerKey, superPowers: (v) => String(v ?? "").trim().toLowerCase(), models: modelKey,
};

const names = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
const keyed = (kind: ReachKind, v: unknown): Set<string> =>
  new Set(names(v).map((x) => (kind === "folders" ? x.replace(/\/+$/, "") : KEY[kind](x))).filter(Boolean));

/** A super power's reach: its lists, and nothing else. `turnModel` stands in for an empty model slot (the main agent's). */
export function superPowerReach(row: Pick<AgentRowLike, "slug" | "name" | "model" | "models" | "connections" | "skills" | "superPowers" | "folders"> & { apps?: string[] }, turnModel = ""): Reach {
  const empty = new Set<string>();
  return {
    slug: row.slug, name: row.name || row.slug, glyphh: false,
    holds: {
      connections: keyed("connections", row.connections),
      skills: keyed("skills", [...names(row.skills), ...names(row.apps)]),
      superPowers: keyed("superPowers", row.superPowers),
      models: keyed("models", [String(row.model ?? "").trim() || turnModel, ...names(row.models)]),
      folders: keyed("folders", row.folders),
    },
    withheld: { connections: empty, skills: empty, superPowers: empty, models: empty, folders: empty },
  };
}

/** Glyphh's reach: everything, less what the member withheld. */
export function glyphhReach(name: string, withheld: AgentWithheld | null | undefined): Reach {
  const w = withheld ?? {};
  return {
    slug: GLYPHH_AGENT, name: name || "Glyphh", glyphh: true,
    holds: { connections: null, skills: null, superPowers: null, models: null, folders: null },
    withheld: Object.fromEntries(KINDS.map((k) => [k, keyed(k, w[k])])) as unknown as Reach["withheld"],
  };
}

/** Does this reach hold this one thing? */
export function holds(r: Reach, kind: Exclude<ReachKind, "folders">, value: unknown): boolean {
  const key = KEY[kind](value);
  if (!key) return false;
  if (r.withheld[kind].has(key)) return false;
  const only = r.holds[kind];
  return only === null || only.has(key);
}

/** May a turn of this reach work in `folder` (a real path)? A super power: inside
 *  one of its folders. Glyphh: anywhere not inside a withheld one. */
export function holdsFolder(r: Reach, folder: string): boolean {
  const f = String(folder ?? "").replace(/\/+$/, "");
  if (!f) return false;
  for (const w of r.withheld.folders) if (withinFolder(w, f)) return false;
  const only = r.holds.folders;
  if (only === null) return true;
  for (const g of only) if (withinFolder(g, f)) return true;
  return false;
}

/** The connection a gateway account tool belongs to. The gateway names each
 *  tool `<server>-<tool>`, and the fork names a server with its org first
 *  (server connections.py, orgconsole.py): `pd_<org>__gmail[__u_<id>|__<label>]`
 *  is the gmail connection, `mcp_<org>__<name>` a custom MCP server. */
export function accountConnection(tool: string): string {
  const server = String(tool ?? "").split("-")[0] ?? "";
  const m = /^(?:pd|mcp)_[a-z0-9_]*?__([a-z0-9_]+?)(?:__|$)/.exec(server);
  return m?.[1] ?? server;
}

const str = (v: unknown): string => String(v ?? "").trim();
const not = (r: Reach, what: string): string => `Not run: ${r.name} doesn't hold ${what}. Its powers are set on its Edit page.`;

/** The refusal for one reach, or null. */
function refusalFor(r: Reach, call: ScopeCallLike, look: ScopeLookups): string | null {
  const a = call.input ?? {};
  const conn = (slug: unknown): string | null => (holds(r, "connections", slug) ? null : not(r, `the connection "${str(slug)}"`));
  const power = (slug: unknown): string | null => (holds(r, "skills", slug) ? null : not(r, `the power "${str(slug)}"`));
  const superPower = (slug: unknown): string | null => (holds(r, "superPowers", slug) ? null : not(r, `the super power "${str(slug)}"`));
  const model = (m: unknown): string | null => (!str(m) || holds(r, "models", m) ? null : not(r, `the model "${str(m)}"`));
  const allOf = (check: (v: unknown) => string | null, list: unknown): string | null => {
    for (const v of names(list)) { const no = check(v); if (no) return no; }
    return null;
  };

  if (call.kind === "spawn") return superPower(call.tool);
  if (call.kind === "builtin" || call.kind === "artifact") return null;
  if (call.kind === "account") return conn(accountConnection(call.tool));
  const family = str(call.family);
  if (family.startsWith("connection: ")) return conn(family.slice("connection: ".length));
  if (family.startsWith("app: ")) return power(family.slice("app: ".length));

  // Glyphh's own tools (in process, or the gateway's of the same name): the ones
  // that reach a connection, a power, a super power or a model are held to it.
  switch (call.tool) {
    case "connector_call": case "connector_tools":
      return str(a.app) ? conn(a.app) : null;
    case "connections_call_tool": case "connections_list_tools":
      return str(a.connection) ? conn(a.connection) : null;
    case "skill_run": case "skill_get": case "task_get": case "task_runs":
    case "skill_enable": case "skill_retype": case "skill_delete":
      return power(a.slug);
    case "task_run": {
      const no = power(a.slug);
      if (no) return no;
      return allOf(conn, look.taskConnections(str(a.slug)) ?? []);
    }
    case "skill_save": {
      if (str(a.slug) && !r.glyphh) { const no = power(a.slug); if (no) return no; }
      return allOf(conn, a.connections) ?? model(a.model);
    }
    case "schedule_save": {
      const no = power(a.target);
      if (no) return no;
      if (str(a.agentId)) { const sp = superPower(a.agentId); if (sp) return sp; }
      return a.kind === "task" ? allOf(conn, look.taskConnections(str(a.target)) ?? []) : null;
    }
    case "schedule_run": case "schedule_delete": {
      const t = look.scheduleTarget(str(a.id));
      if (!t) return null;
      const no = power(t.target);
      if (no) return no;
      return t.kind === "task" ? allOf(conn, look.taskConnections(t.target) ?? []) : null;
    }
    case "hand_off":
      return superPower(a.member);
    case "app_call_tool":
      return power(str(a.app).split("~")[0]);
    case "image_generate": case "video_generate": case "audio_generate": case "super_power_avatar":
      return (call.tool === "super_power_avatar" ? editRefusal(r, a.agent) : null) ?? model(a.model);
    case "agent_save": case "agent_delete": {
      const no = editRefusal(r, a.agent);
      if (no) return no;
      if (call.tool === "agent_delete") return null;
      return allOf(conn, a.connections) ?? allOf(power, a.powers) ?? allOf(superPower, a.superPowers)
        ?? allOf(model, a.models) ?? model(a.model)
        ?? allOf((f) => (holdsFolder(r, str(f)) ? null : not(r, `the folder ${str(f)}`)), a.folders);
    }
    case "run_outside_sandbox":
      return r.glyphh ? null : `Not run: ${r.name} works inside its folders only.`;
    default:
      return null;
  }
}

/** Editing a super power: never the record that scopes this turn, and only one this turn holds. */
function editRefusal(r: Reach, agent: unknown): string | null {
  const slug = str(agent).toLowerCase();
  if (slug === r.slug.toLowerCase() || slug === GLYPHH_AGENT) return `Not run: ${r.name} can't change its own powers. The member sets them on its Edit page.`;
  if (!r.glyphh) return `Not run: only Glyphh makes or changes super powers.`;
  return slug && !holds(r, "superPowers", slug) ? not(r, `the super power "${slug}"`) : null;
}

/** The refusal for a call, held to every reach in the chain (the turn's holder,
 *  then each sub-agent under it), or null when every one allows it. */
export function scopeRefusal(call: ScopeCallLike, chain: readonly Reach[], look: ScopeLookups): string | null {
  if (!chain.length) return "Not run: this turn's scope could not be read.";
  for (const r of chain) {
    const no = refusalFor(r, call, look);
    if (no) return no;
  }
  return null;
}
