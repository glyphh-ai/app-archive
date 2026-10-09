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
import { gatewayCreds } from "./gateway-token.js";
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
/** The avatar being made right now, so Stop can end it (one at a time). */
let avatarAbort: AbortController | null = null;
export function stopAvatar(): boolean {
  if (!avatarAbort) return false;
  avatarAbort.abort();
  return true;
}

/**
 * One picture from the GATEWAY'S image endpoint (OpenAI's /v1/images/generations,
 * which LiteLLM serves for every image model) on the member's own key, so it is
 * metered and walled like any other call. The server's /api/media pipeline is
 * not there to call (his report, 2026-10-09: "HTTP 404"), so avatars do not
 * ride it. Answers the picture's bytes and the model that made it.
 */
async function gatewayImage(prompt: string, asked: string | undefined, signal: AbortSignal): Promise<{ bytes: Buffer; model: string }> {
  const creds = await gatewayCreds().catch(() => null);
  if (!creds) throw new Error("Your organization's gateway isn't available, so no picture can be made right now.");
  const offer = (await availablePowers()).find((o) => o.id === "images");
  const picked = offer ? pickPowerModel(offer.models, asked) : null;
  if (!picked) throw new Error("Your plan has no image model. Ask your admin to turn one on.");
  const model = picked.split("::").pop()!;
  const res = await fetch(`${creds.baseUrl.replace(/\/+$/, "")}/v1/images/generations`, {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${creds.token}` },
    body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024" }),
  });
  if (!res.ok) {
    const said = await res.text().catch(() => "");
    let msg = said;
    try { const j = JSON.parse(said) as { error?: { message?: string } | string; detail?: { error?: string } | string }; msg = (typeof j.error === "object" ? j.error?.message : j.error) || (typeof j.detail === "object" ? j.detail?.error : j.detail) || said; } catch { /* plain text */ }
    throw new Error(`The image model refused (${res.status})${msg ? `: ${String(msg).slice(0, 200)}` : ""}`);
  }
  const body = await res.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const first = body.data?.[0];
  if (first?.b64_json) return { bytes: Buffer.from(first.b64_json, "base64"), model };
  if (first?.url) {
    const pic = await fetch(first.url, { signal });
    if (!pic.ok) throw new Error(`The picture could not be downloaded (${pic.status}).`);
    return { bytes: Buffer.from(await pic.arrayBuffer()), model };
  }
  throw new Error("The image model did not answer with a picture.");
}

/**
 * A SUPER POWER'S AVATAR (his order, 2026-10-09): the mascot's style plus what
 * makes this one its own, made by the member's image model through the
 * gateway. Guarded hard on the way in and out (main/avatar-guard.ts), the green
 * background keyed out and the figure fitted into the mascot's own box
 * (shared/avatar-cutout.ts), kept as a 256px PNG data URL — small enough to
 * ride in the agent row, so it draws the same on every surface with no link
 * to expire. Stop (stopAvatar) ends it between any two steps.
 */
export async function generateAvatar(input: AvatarGenInput): Promise<AvatarGenResult> {
  avatarAbort?.abort();
  const ctl = new AbortController();
  avatarAbort = ctl;
  const stopped = (): void => { if (ctl.signal.aborted) throw new Error("Stopped."); };
  try {
    const askText = String(input.prompt ?? "").trim();
    // Gate 1 + 2: the words, then a model, on everything the member or a caller wrote.
    await guardAvatarAsk(askText, [String(input.name ?? ""), String(input.description ?? "")].filter(Boolean).join("\n"));
    stopped();
    const prompt = avatarImagePrompt({ name: input.name, description: input.description, ask: askText });
    const made = await gatewayImage(prompt, input.model, ctl.signal);
    stopped();
    const img = nativeImage.createFromBuffer(made.bytes);
    if (img.isEmpty()) throw new Error("The image model did not answer with a picture.");
    // Gate 3: the picture as made, before anything is kept.
    await guardAvatarImage(img.resize({ width: WORK_PX, height: WORK_PX }).toPNG().toString("base64"));
    stopped();
    const work = img.resize({ width: WORK_PX, height: WORK_PX, quality: "best" });
    const { width, height } = work.getSize();
    const px = new Uint8Array(work.toBitmap());
    const fig = keyOutGreen(px, width, height);
    if (!fig || figureTooSmall(fig, width, height)) throw new Error("The picture had no clear character in it. Try again.");
    const placed = placeFigure(px, width, fig, AVATAR_PX, mascotFit(fig, AVATAR_PX));
    const out = nativeImage.createFromBitmap(Buffer.from(placed), { width: AVATAR_PX, height: AVATAR_PX });
    return { image: `data:image/png;base64,${out.toPNG().toString("base64")}`, model: made.model, usd: 0, prompt };
  } catch (err) {
    if (ctl.signal.aborted) throw new Error("Stopped.");
    throw err;
  } finally {
    if (avatarAbort === ctl) avatarAbort = null;
  }
}

export function registerPowersIpc(): void {
  ipcMain.handle("avatar-generate-stop", () => ({ ok: true as const, stopped: stopAvatar() }));
  ipcMain.handle("avatar-generate", async (_e, input: AvatarGenInput) => {
    try { return { ok: true as const, data: await generateAvatar(input ?? {}) }; }
    catch (err) { return { ok: false as const, error: err instanceof Error ? err.message : String(err) }; }
  });
  ipcMain.handle("powers-list", async () => {
    try { return { ok: true as const, data: await availablePowers() }; }
    catch (err) { return { ok: false as const, error: err instanceof Error ? err.message : String(err), data: [] }; }
  });
}
