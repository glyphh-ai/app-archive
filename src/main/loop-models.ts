/**
 * loop-models.ts — WHAT THE AGENT CAN RUN ON: the models this member's org
 * serves on the gateway, as the picker's rows.
 *
 * This file used to answer per CLI: three vendor dialects, a BYOK endpoint, a
 * ChatGPT login's own cache, and the lane law deciding which group a pick ran
 * in. All of that went with the bridge (his order, 2026-09-28: one loop, no CLI
 * switching). What is left is one honest list — our server's `models.available`
 * for this member.
 *
 * THAT LIST IS THEIR TEAM'S, AND ONLY THEIR TEAM'S (his order, 2026-09-29: "the
 * model list in the glyphh agent is 100% now gated by the team and the team
 * alone"). The server resolves it: the platform catalog, narrowed by the org
 * (its approvals, its own keys, its routers), narrowed again by the team the
 * member sits on — which is the same list the gateway authorizes their key
 * against, so a model the picker offers is a model the turn can run.
 *
 * Asked once and cached briefly: every panel offers the same list.
 */

import { ipcMain } from "electron";
import { getClient } from "./glyphh-client";
import { gatewayCreds } from "./gateway-token";

export interface LoopModel {
  id: string;
  name: string;
  providerSlug: string;
  /** The model takes an effort (the composer's dial); absent on an older server = yes. */
  reasoning?: boolean;
  /** On the Free plan's list (the server's flag; nothing in the app shows it). */
  freePlan?: boolean;
}
export interface LoopModelsResult {
  ok: boolean;
  source: "gateway" | "none";
  baseUrl: string | null;
  models: LoopModel[];
  error?: string;
}

const TTL_MS = 60_000;
let cached: { at: number; value: LoopModelsResult } | null = null;

type FetchListener = (value: LoopModelsResult, forced: boolean) => void;
const fetchListeners = new Set<FetchListener>();

/** Told after every read that went to the server (not a cache hit), and
 *  whether a surface forced it — model-watch.ts compares and announces. */
export function onLoopModelsFetched(cb: FetchListener): () => void {
  fetchListeners.add(cb);
  return () => { fetchListeners.delete(cb); };
}

/**
 * ONE NAME, ONE ROW (his report, 2026-09-25: the picker listed
 * claude-fable-5-1 and claude-haiku-4-5 twice each under anthropic). The same
 * model reaches the list by more than one road — the org's allow-list and an
 * org deployment of the same public name — and they arrive as separate rows.
 * The name is what a person sees, so a repeated name is the same pick twice.
 * First wins: the caller puts the more specific row first.
 */
export function dedupeByName(rows: LoopModel[]): LoopModel[] {
  const seen = new Set<string>();
  return rows.filter((m) => {
    const key = String(m.name ?? m.id).trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function listLoopModels(force = false): Promise<LoopModelsResult> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let value: LoopModelsResult;
  try {
    // THE SERVER ANSWERS THIS, not the gateway's own /v1/models: a team-scoped
    // deployment is renamed internally there (model_name_<team>_<uuid>), and an
    // auto-router has no business being offered as a model name at all. Our own
    // endpoint publishes the public name and applies the TEAM's list — the same
    // list the member's key is authorized against.
    const creds = await gatewayCreds().catch(() => null);
    const rows = await getClient().models.available() as Array<{ name: string; providerSlug: string; modality: string; autoRouter?: boolean; reasoning?: boolean; freePlan?: boolean }>;
    const models = dedupeByName(rows
      .filter((m) => m.modality === "chat")
      .map((m): LoopModel => ({
        id: m.name, name: m.autoRouter ? "Auto" : m.name, providerSlug: m.autoRouter ? "auto" : m.providerSlug,
        ...(typeof m.reasoning === "boolean" ? { reasoning: m.reasoning } : {}),
        ...(typeof m.freePlan === "boolean" ? { freePlan: m.freePlan } : {}),
      })))
      .sort((a, b) => a.providerSlug.localeCompare(b.providerSlug) || a.name.localeCompare(b.name));
    value = { ok: true, source: "gateway", baseUrl: creds?.baseUrl ?? null, models };
  } catch (err) {
    value = { ok: false, source: "none", baseUrl: null, models: [], error: err instanceof Error ? err.message : String(err) };
  }
  if (value.ok) cached = { at: Date.now(), value };
  for (const cb of fetchListeners) {
    try { cb(value, force); } catch (err) { console.warn("[models] fetch listener failed:", err instanceof Error ? err.message : err); }
  }
  return value;
}

export function registerLoopModelsIpc(): void {
  // The channel keeps its name: the preload contract is not pruned for a
  // rename (preload-contract law). The loop id it used to take is ignored —
  // there is one loop now, and one list.
  ipcMain.handle("loop-models", (_e, _loopId?: string, force?: boolean) => listLoopModels(!!force));
}
