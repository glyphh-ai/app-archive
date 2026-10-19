/**
 * embeddings-config — embeddings run ON THIS MACHINE.
 *
 * There is no Glyphh gateway to embed through, and the providers the loop
 * talks to do not all offer embeddings. So memory, search and app data embed
 * locally with one built-in model: hashed word and word-pair features, scaled
 * by log frequency and normalised. It is lexical (it finds what shares words,
 * not what shares meaning), it needs no download and no key, and it is the
 * same on every machine.
 *
 * A collection pinned to a model that is no longer offered (an old gateway
 * model) is embedded again with this one by glyphh-app-ai's repin, on first use.
 */
import { ipcMain } from "electron";
import { createHash } from "node:crypto";
import { registerMemoryIpc } from "./memory.js";

export interface EmbedModel { id: string; name: string; providerSlug: string }

export const LOCAL_EMBED_MODEL: EmbedModel = { id: "local::hashed-words-512", name: "On this computer", providerSlug: "local" };
const DIM = 512;

/** The embedding models on offer: the one local model. */
export async function orgEmbedModels(_force = false): Promise<EmbedModel[]> {
  return [LOCAL_EMBED_MODEL];
}

/** The model embeds run on. */
export function selectedEmbedModel(): string {
  return LOCAL_EMBED_MODEL.id;
}

/** Whether an offered model is this one: by its id, or by its bare name. */
export function offers(models: EmbedModel[], model: string): boolean {
  return models.some((m) => m.id === model || routeName(m.id) === model);
}

export async function resolveEmbedModel(): Promise<string> {
  return LOCAL_EMBED_MODEL.id;
}

/** A model id without its provider prefix. */
export function routeName(id: string): string {
  const cut = id.indexOf("::");
  return cut === -1 ? id : id.slice(cut + 2);
}

/** Lowercased word tokens: letters and digits, any script. */
export function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** A feature's slot and sign, from a stable hash of the feature. */
function slot(feature: string): { at: number; sign: number } {
  const h = createHash("sha1").update(feature).digest();
  return { at: h.readUInt32BE(0) % DIM, sign: h[4]! & 1 ? 1 : -1 };
}

/** One text as a unit vector: words and adjacent word pairs, each counted
 *  1 + log(count), hashed into DIM signed slots. Empty text is the zero vector. */
export function embedOne(text: string): number[] {
  const toks = words(text);
  const counts = new Map<string, number>();
  for (let i = 0; i < toks.length; i++) {
    counts.set(toks[i]!, (counts.get(toks[i]!) ?? 0) + 1);
    if (i + 1 < toks.length) {
      const pair = `${toks[i]} ${toks[i + 1]}`;
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
  }
  const vec = new Array<number>(DIM).fill(0);
  for (const [feature, n] of counts) {
    const { at, sign } = slot(feature);
    vec[at]! += sign * (1 + Math.log(n));
  }
  const norm = Math.hypot(...vec);
  return norm ? vec.map((v) => v / norm) : vec;
}

/** Embed texts on this machine. The model argument is the collection's pin;
 *  there is one local model, so every pin embeds the same way. */
export async function localEmbed(texts: string[], _model: string): Promise<number[][]> {
  return texts.map(embedOne);
}

export function registerEmbeddingsIpc(): void {
  registerMemoryIpc();
  ipcMain.handle("embeddings-config-get", async () => ({ ok: true, model: LOCAL_EMBED_MODEL.id, models: [LOCAL_EMBED_MODEL] }));
  ipcMain.handle("embeddings-config-set", () => ({ ok: true, model: LOCAL_EMBED_MODEL.id }));
}
