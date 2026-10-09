/**
 * powers.ts — the POWERS' main side (his order, 2026-10-09; the rules are
 * shared/powers.ts). Each power runs on the server's metered media pipeline
 * (sdk media.generate → a job → a stored asset): the plan's models, spend
 * logged in dollars, the asset in the member's media library. An optional
 * `saveAs` also writes the file into the member's folder, so a workflow that
 * runs every morning leaves its pictures where the work lives.
 */
import { ipcMain, nativeImage } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getClient } from "./glyphh-client";
import { getWorkingDirectory } from "./working-directory.js";
import { avatarImagePrompt } from "../shared/avatar-style.js";
import { figureTooSmall, keyOutGreen, mascotFit, placeFigure } from "../shared/avatar-cutout.js";
import { guardAvatarAsk, guardAvatarImage } from "./avatar-guard.js";
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

/** The side an avatar picture is kept at: sharp at the rail's 56px on a 2x screen. */
const AVATAR_PX = 256;
/** The working size the background is keyed out at. */
const WORK_PX = 512;

export interface AvatarGenInput { name?: string; description?: string; prompt?: string; model?: string }
export interface AvatarGenResult { image: string; model: string; usd: number; prompt: string }

/**
 * A SUPER POWER'S AVATAR (his order, 2026-10-09): the mascot's style plus what
 * makes this one its own, made by the Images power. Guarded hard on the way in
 * and out (main/avatar-guard.ts), the green background keyed out and the
 * figure fitted into the mascot's own box (shared/avatar-cutout.ts), kept as a
 * 256px PNG data URL — small enough to ride in the agent row, so it draws the
 * same on every surface with no link to expire.
 */
export async function generateAvatar(input: AvatarGenInput): Promise<AvatarGenResult> {
  const askText = String(input.prompt ?? "").trim();
  // Gate 1 + 2: the words, then a model, on everything the member or a caller wrote.
  await guardAvatarAsk(askText, [String(input.name ?? ""), String(input.description ?? "")].filter(Boolean).join("\n"));
  const prompt = avatarImagePrompt({ name: input.name, description: input.description, ask: askText });
  const made = await runPower("images", { prompt, size: "1024x1024", title: `Avatar: ${String(input.name || "super power").slice(0, 80)}`, ...(input.model ? { model: input.model } : {}) });
  if (!made.url) throw new Error("The picture was made but could not be read back.");
  const res = await fetch(made.url);
  if (!res.ok) throw new Error(`The picture could not be downloaded (${res.status}).`);
  const img = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
  if (img.isEmpty()) throw new Error("The image model did not answer with a picture.");
  // Gate 3: the picture as made, before anything is kept.
  await guardAvatarImage(img.resize({ width: WORK_PX, height: WORK_PX }).toPNG().toString("base64"));
  const work = img.resize({ width: WORK_PX, height: WORK_PX, quality: "best" });
  const { width, height } = work.getSize();
  const px = new Uint8Array(work.toBitmap());
  const fig = keyOutGreen(px, width, height);
  if (!fig || figureTooSmall(fig, width, height)) throw new Error("The picture had no clear character in it. Try again.");
  const placed = placeFigure(px, width, fig, AVATAR_PX, mascotFit(fig, AVATAR_PX));
  const out = nativeImage.createFromBitmap(Buffer.from(placed), { width: AVATAR_PX, height: AVATAR_PX });
  return { image: `data:image/png;base64,${out.toPNG().toString("base64")}`, model: made.model, usd: made.usd, prompt };
}

export function registerPowersIpc(): void {
  ipcMain.handle("avatar-generate", async (_e, input: AvatarGenInput) => {
    try { return { ok: true as const, data: await generateAvatar(input ?? {}) }; }
    catch (err) { return { ok: false as const, error: err instanceof Error ? err.message : String(err) }; }
  });
  ipcMain.handle("powers-list", async () => {
    try { return { ok: true as const, data: await availablePowers() }; }
    catch (err) { return { ok: false as const, error: err instanceof Error ? err.message : String(err), data: [] }; }
  });
}
