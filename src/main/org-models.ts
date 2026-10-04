/**
 * org-models — WHAT MODEL A TURN RUNS ON, and the name to send.
 *
 * Extracted from cli-agents.ts in the bridge cut (his order, 2026-09-28: all
 * the bridge and CLI code goes, the loop is the only lane). The lane law went
 * with it: there is no CLI login to choose between any more, so a turn either
 * rides the gateway or it does not run. What survives is the org's default
 * model, whether the gateway is available at all, and stripping the catalog
 * prefix off a picked name.
 */
import { getClient } from "./glyphh-client.js";

let gatewayOn = false;
let requiredModel = "";
let connectionsOn = true;
let hasPlan = true;

/**
 * A catalog id ("anthropic::claude-sonnet-5") as the vendor's own name. Every
 * picker in the app stores catalog ids; the wire wants the bare name.
 */
export const bareModel = (model: string): string =>
  model.replace(/"/g, "").replace(/^[a-z0-9_-]+::/i, "").trim();

/** Is the gateway available to this member at all? */
export function gatewayAvailable(): boolean { return gatewayOn; }

/** What the renderers are told when any of it moves (model-watch.ts). */
export function orgModelState(): { gatewayOn: boolean; defaultModel: string; connectionsOn: boolean; hasPlan: boolean } {
  return { gatewayOn, defaultModel: requiredModel, connectionsOn, hasPlan };
}

/** DOES THE ORG HAVE A PAID PLAN? A Free org runs the free-plan models (his
 *  order, 2026-10-04); what still needs a plan is the CLI gateway pass-through
 *  (cli-agents.ts). Absent on an older server = yes. */
export function orgHasPlan(): boolean { return hasPlan; }

/** The model a turn runs on when it named none: the org's default with the
 *  gateway on, "" otherwise (the loop then refuses in its own words). */
export function orgRequiredModel(): string { return requiredModel; }

/**
 * IS THE CONNECTIONS LANE OPEN TO THIS MEMBER? (his order, 2026-09-29: "if the
 * org turns off pipedream they cannot use the connections… that should trickle
 * down to the desktop app and fully gate the pipedream lane").
 *
 * The lane is the server's remote MCP: `mcp_tool_search` / `mcp_tool_call` and
 * the desktop's own connector tools, all of which bill through Pipedream. With
 * the lane closed they are not lent to a run at all — a gate that only refuses
 * at call time still puts the tools in the prompt and invites the attempt.
 */
export function connectionsAvailable(): boolean { return connectionsOn; }

/**
 * Re-read the org's lane and default model. Called at boot and whenever the
 * account changes; offline leaves the last answer standing, because a network
 * hiccup must not look like "no model".
 */
export async function refreshOrgModels(): Promise<void> {
  try {
    const client = getClient();
    const [gates, models] = await Promise.all([
      client.plans.gates() as Promise<{ gatewayAllowed?: boolean; defaultModel?: string; connectionsAllowed?: boolean; hasPlan?: boolean }>,
      client.models.available().catch(() => []) as Promise<Array<{ name: string; modality: string; autoRouter?: boolean }>>,
    ]);
    gatewayOn = !!gates.gatewayAllowed;
    // Absent = open: an older server that does not answer this must not lock
    // the lane for everyone.
    connectionsOn = gates.connectionsAllowed !== false;
    hasPlan = gates.hasPlan !== false;
    // THE ORG'S DEFAULT FIRST (his order, 2026-09-20): the model the admin set
    // for turns that picked none; then the router. The surprise he reported then
    // ("where did it get luna from?") was a HIDDEN pick; the chip now names the
    // model Default resolves to, so the last fallback is visible, not a guess.
    const chat = models.filter((m) => m.modality === "chat");
    const orgDefault = String(gates.defaultModel || "").trim();
    const router = chat.find((m) => m.autoRouter)?.name ?? "";
    // NEVER NOTHING WHILE THE TEAM HAS A MODEL (his report, 2026-09-29: "Model:
    // Default" answered "Pick a model…"): the server's pick (desktop.pick_default)
    // while the team carries it, else the router, else the first chat model by
    // name — the same rule the chip shows (help/code.ts resolvedDefaultModel).
    const first = chat.map((m) => m.name).sort()[0] ?? "";
    requiredModel = gatewayOn
      ? (orgDefault && chat.some((m) => m.name === orgDefault) ? orgDefault : router || first)
      : "";
  } catch { /* offline — the last answer stands */ }
}
