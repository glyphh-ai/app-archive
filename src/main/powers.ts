/**
 * powers.ts — the POWERS' main side (his order, 2026-10-09; the rules are
 * shared/powers.ts). Each power runs on the server's metered media pipeline
 * (sdk media.generate → a job → a stored asset): the plan's models, spend
 * logged in dollars, the asset in the member's media library. An optional
 * `saveAs` also writes the file into the member's folder, so a workflow that
 * runs every morning leaves its pictures where the work lives.
 */
import { ipcMain } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getClient } from "./glyphh-client";
import { getWorkingDirectory } from "./working-directory.js";
import { POWERS, modelsForPower, pickPowerModel, powerById, safeSaveName, type CatalogModelLike, type PowerDef, type PowerId } from "../shared/powers.js";

export interface PowerOffer { id: PowerId; name: string; blurb: string; tool: string; models: string[]; avatar: PowerDef["avatar"] }

/** The powers this member's plan carries — a power with no model is left out. */
export async function availablePowers(): Promise<PowerOffer[]> {
  const catalog = await getClient().models.available().catch(() => []) as CatalogModelLike[];
  return POWERS
    .map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, tool: p.tool, models: modelsForPower(p, catalog), avatar: p.avatar }))
    .filter((p) => p.models.length > 0);
}

export interface PowerRunInput { prompt: string; model?: string; size?: string; seconds?: number; voice?: string; imageUrl?: string; title?: string; saveAs?: string; folder?: string }
export interface PowerRunResult { power: PowerId; model: string; assetId: string; url: string | null; usd: number; saved?: string }

export async function runPower(id: PowerId, input: PowerRunInput): Promise<PowerRunResult> {
  const power = powerById(id);
  if (!power) throw new Error(`no such power: ${id}`);
  const prompt = String(input.prompt ?? "").trim();
  if (!prompt) throw new Error("say what to make (prompt)");
  const offers = await availablePowers();
  const offer = offers.find((o) => o.id === id);
  const model = offer ? pickPowerModel(offer.models, input.model) : null;
  if (!model) throw new Error(`${power.name} has no model on this plan`);
  const options = {
    ...(input.size ? { size: String(input.size) } : {}),
    ...(typeof input.seconds === "number" && input.seconds > 0 ? { seconds: Math.round(input.seconds) } : {}),
    ...(input.voice ? { voice: String(input.voice) } : {}),
    ...(input.imageUrl ? { imageUrl: String(input.imageUrl) } : {}),
  };
  const media = getClient().media;
  const started = await media.generate({ model, prompt, title: String(input.title || prompt).slice(0, 120), ...(Object.keys(options).length ? { options } : {}) });
  const job = await media.waitForJob(started.job.id);
  if (job.status !== "succeeded" || !job.assetId) throw new Error(job.error || `${power.name} could not make it`);
  const { url } = await media.playbackUrl(job.assetId).catch(() => ({ url: null as string | null }));
  const out: PowerRunResult = { power: id, model, assetId: job.assetId, url, usd: job.usdCharged };
  const name = safeSaveName(input.saveAs);
  if (name && url) {
    const root = String(input.folder || getWorkingDirectory() || "").trim();
    if (root) {
      const dest = path.resolve(root, name);
      if (dest.startsWith(path.resolve(root) + path.sep)) {
        const res = await fetch(url);
        if (res.ok) {
          mkdirSync(path.dirname(dest), { recursive: true });
          writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
          out.saved = dest;
        }
      }
    }
  }
  return out;
}

export function registerPowersIpc(): void {
  ipcMain.handle("powers-list", async () => {
    try { return { ok: true as const, data: await availablePowers() }; }
    catch (err) { return { ok: false as const, error: err instanceof Error ? err.message : String(err), data: [] }; }
  });
}
