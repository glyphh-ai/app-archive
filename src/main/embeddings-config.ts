/**
 * embeddings-config — embeddings run on the GATEWAY (his order, 2026-09-16:
 * no local model, no vendor key on the machine). The org admin publishes
 * embedding models in the console; a member picks one here and every
 * chunk/embed lane calls the gateway with their own key.
 *
 * No pick (or an org with no embedding models) = the semantic features are
 * off, and callers say so rather than silently degrading.
 */
import { ipcMain } from "electron";
import { getPreference, setPreference } from "./stores/preferences-db.js";
import { getClient } from "./glyphh-client.js";
import { mcpCreds } from "./gateway-token.js";
import { registerMemoryIpc } from "./memory.js";

export interface EmbedModel { id: string; name: string; providerSlug: string }

const MODELS_TTL_MS = 60_000;
let cached: { at: number; models: EmbedModel[] } | null = null;

/** The org's embedding models, as the server's catalog reports them; null
 *  when the server could not be asked and nothing is cached. */
export async function orgEmbedModels(force = false): Promise<EmbedModel[] | null> {
  if (!force && cached && Date.now() - cached.at < MODELS_TTL_MS) return cached.models;
  try {
    const rows = await getClient().http.get<Array<{ id: string; name: string; providerSlug: string; modality?: string; active?: boolean }>>("/api/models/available");
    const models = (Array.isArray(rows) ? rows : [])
      .filter((m) => m && m.modality === "embedding")
      .map((m) => ({ id: m.id, name: m.name || m.id, providerSlug: m.providerSlug || "" }));
    cached = { at: Date.now(), models };
    return models;
  } catch (err) {
    console.warn("[embeddings] model list unavailable:", err instanceof Error ? err.message : String(err));
    return cached?.models ?? null;
  }
}

/** The member's pick, or "" when they have not chosen one. */
export function selectedEmbedModel(): string {
  return String(getPreference<string>("embeddingsModel", "") ?? "");
}

/** Whether a published model is this one: by its id, or by the name the gateway
 *  is sent (an app may pin a collection by that name). */
export function offers(models: EmbedModel[], model: string): boolean {
  return models.some((m) => m.id === model || routeName(m.id) === model);
}

/** The model embeds run on NOW. The member's pick while the org still publishes
 *  it; else the first model the org does publish, which becomes the pick, so an
 *  admin removing a model does not stop memory and search for everyone who had
 *  chosen it (his report, 2026-10-03: every embed refused 403 for a model that
 *  was gone). The pick as it stands when the server cannot be asked; "" when
 *  the org publishes none. */
export async function resolveEmbedModel(): Promise<string> {
  const pick = selectedEmbedModel();
  const models = await orgEmbedModels();
  if (models === null) return pick;
  if (!models.length) return "";
  if (offers(models, pick)) return pick;
  const next = models[0].id;
  if (pick) console.warn(`[embeddings] ${pick} is no longer published for this organization; embeds move to ${next}`);
  setPreference("embeddingsModel", next);
  return next;
}

/** The model id the gateway should embed with, stripped of our provider prefix. */
export function routeName(id: string): string {
  const cut = id.indexOf("::");
  return cut === -1 ? id : id.slice(cut + 2);
}

/** Embed through the gateway with the member's own key: the org's allow-list,
 *  its rate limits and its spend, like every other model call.
 *
 *  WHATEVER THE GATEWAY LANE SAYS (his report, 2026-09-20: memory captured
 *  nothing). The lane switch decides where CHAT goes: a loop rides its own
 *  login when the lane is off. An embedding has no login to ride; the org's
 *  embedding model lives on the gateway, so it goes there with the member
 *  credential that still authenticates the server, lane on or off. */
export async function gatewayEmbed(texts: string[], model: string): Promise<number[][]> {
  const creds = await mcpCreds();
  if (!creds) throw new Error("embeddings need the server — sign in first");
  const res = await fetch(`${creds.baseUrl.replace(/\/+$/, "")}/v1/embeddings`, {
    method: "POST",
    headers: { authorization: `Bearer ${creds.token}`, "content-type": "application/json" },
    body: JSON.stringify({ model: routeName(model), input: texts }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`the gateway refused the embedding (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body = await res.json() as { data?: Array<{ embedding?: number[]; index?: number }> };
  const rows = body.data ?? [];
  if (rows.length !== texts.length) throw new Error(`the gateway returned ${rows.length} vectors for ${texts.length} texts`);
  return rows
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => {
      if (!Array.isArray(d.embedding)) throw new Error("the gateway returned no vector");
      return d.embedding;
    });
}

export function registerEmbeddingsIpc(): void {
  registerMemoryIpc();
  ipcMain.handle("embeddings-config-get", async () => {
    const models = (await orgEmbedModels()) ?? [];
    return { ok: true, model: await resolveEmbedModel(), models };
  });

  ipcMain.handle("embeddings-config-set", (_e, input: { model?: string }) => {
    if (typeof input?.model === "string") setPreference("embeddingsModel", input.model);
    return { ok: true, model: selectedEmbedModel() };
  });
}
