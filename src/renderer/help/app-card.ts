/** THE APP CARD IN THE THREAD (his decisions, 2026-10-07; punch list 14 + 15).
 *
 *  After the agent writes a Glyphh app (a manifest.json lands in the thread's
 *  folder) or installs one (app_install answers), the thread carries ONE card
 *  for that app with the next step spelled out: "Build and run" (the first
 *  time) / "Build and run again" (the next release of the same instance),
 *  "Open" (the hosted panel beside the chat) and "Share to publish" (the org's
 *  review desk). The member's folder + ONE private running copy; no draft
 *  kind. The pure parts live here (code.ts draws and acts). */

export type AppCardState = "built" | "installing" | "building" | "installed" | "failed";

export interface AppCard {
  /** The app's folder — what Build and run installs (app_install { dir }). */
  folder: string;
  slug?: string;
  name?: string;
  /** The instance key once installed; the hosted panel's path; the live release. */
  key?: string | null;
  url?: string | null;
  release?: number | null;
  /** The build job, while the platform builds source. */
  job?: string | null;
  state: AppCardState;
  error?: string;
  tools?: string[];
  /** THE BUILD LOG IN THE THREAD (his ask, 2026-10-07): the job's log tail while it builds, kept on failure. */
  log?: string;
}

/** The last lines of a log, for the card. */
export function logLines(log: string | undefined | null, n = 14): string {
  const lines = String(log ?? "").replace(/\r/g, "").split("\n").filter((l) => l.trim());
  return lines.slice(-n).join("\n");
}

/** A log frame from the worker's app_install: {job, status, log}, or nothing. */
export function buildLogOf(detail: unknown): { job: string; status: string; log: string } | null {
  const d = detail as { job?: unknown; status?: unknown; log?: unknown } | null;
  if (!d || typeof d !== "object" || typeof d.job !== "string" || typeof d.log !== "string") return null;
  return { job: d.job, status: String(d.status ?? ""), log: d.log };
}

/** app_install's answer, as the tool returns it (main/app-instances.ts DeployAnswer). */
export interface InstallAnswerLike {
  key?: string; mode?: string; release?: { n?: number } | null; job?: { id?: string; status?: string } | null; url?: string; tools?: string[]; error?: string;
}

const MANIFEST_RE = /(^|[\\/])manifest\.json$/;

/** The folder a written path sits in (the app's root when the file is its manifest). */
export function folderOfPath(abs: string): string {
  const i = Math.max(abs.lastIndexOf("/"), abs.lastIndexOf("\\"));
  return i > 0 ? abs.slice(0, i) : abs;
}

/** A manifest.json the turn wrote → a BUILT card for that folder. */
export function cardFromManifestWrite(name: string, title: string | undefined, workdir: string | undefined, failed: boolean): AppCard | null {
  if (failed || (name !== "write_file" && name !== "edit_file") || !title?.startsWith(`${name} `)) return null;
  const raw = title.slice(name.length + 1).trim();
  if (!MANIFEST_RE.test(raw)) return null;
  const abs = raw.startsWith("/") || /^[a-z]:[\\/]/i.test(raw) ? raw : workdir ? `${workdir.replace(/\/$/, "")}/${raw.replace(/^\.\//, "")}` : raw;
  return { folder: folderOfPath(abs), state: "built" };
}

/** The JSON an app_install answer carries, if the output is one. */
export function parseInstallAnswer(output: string | undefined | null): InstallAnswerLike | null {
  const s = String(output ?? "").trim();
  if (!s.startsWith("{")) return null;
  try { const v = JSON.parse(s) as InstallAnswerLike; return v && typeof v === "object" ? v : null; } catch { return null; }
}

/** What an install answer makes of a card: installed (a release is live),
 *  building (a job runs), or failed. */
export function cardFromInstallAnswer(folder: string, a: InstallAnswerLike | null, failed: boolean, error?: string): AppCard {
  if (failed) return { folder, state: "failed", ...(error ? { error } : {}) };
  const key = a?.key || null;
  const slug = key ? key.split("~")[0] : undefined;
  const release = a?.release && Number.isInteger(a.release.n) ? (a.release.n as number) : null;
  const job = a?.job?.id || null;
  const base = { folder, ...(slug ? { slug } : {}), key, url: a?.url || null, release, job, ...(Array.isArray(a?.tools) ? { tools: a!.tools!.map(String) } : {}) };
  if (release !== null) return { ...base, state: "installed" };
  if (job) return { ...base, state: "building" };
  return { ...base, state: key ? "installed" : "failed", ...(key ? {} : { error: "the install answered no instance" }) };
}

/** A later card for the same app folds into the earlier one: what the
 *  install learned (key, url, release) stays; the state is the latest. */
export function mergeAppCard(have: AppCard, next: AppCard): AppCard {
  return {
    ...have, ...next,
    key: next.key ?? have.key ?? null,
    url: next.url ?? have.url ?? null,
    release: next.release ?? (next.state === "building" ? have.release ?? null : have.release ?? null),
    slug: next.slug ?? have.slug,
    name: next.name ?? have.name,
    tools: next.tools ?? have.tools,
    job: next.state === "building" ? next.job ?? have.job ?? null : null,
    error: next.state === "failed" ? next.error : undefined,
    log: next.log ?? (next.state === "building" || next.state === "failed" ? have.log : undefined),
  };
}

/** The card's face: a title, one line of what happens next, the primary action's label. */
export function appCardFace(c: AppCard): { title: string; sub: string; primary: string; primaryOn: boolean; canOpen: boolean; canShare: boolean } {
  const name = c.name || c.slug || c.folder.split(/[\\/]/).filter(Boolean).pop() || "the app";
  const again = c.release !== null && c.release !== undefined && c.release > 0;
  switch (c.state) {
    case "built":
      return { title: name, sub: again ? "Changed. Build and run again makes the next release of your running copy." : "Built in this folder. Build and run installs it as your own running copy — yours alone until you share it.", primary: again ? "Build and run again" : "Build and run", primaryOn: true, canOpen: again && !!c.url, canShare: again };
    case "installing":
      return { title: name, sub: "Uploading the folder…", primary: "Installing…", primaryOn: false, canOpen: false, canShare: false };
    case "building":
      return { title: name, sub: "The platform is building it (npm ci · next build · the worker). The panel opens when it is ready.", primary: "Building…", primaryOn: false, canOpen: false, canShare: false };
    case "installed":
      return { title: name, sub: `Running as your own copy${c.release ? ` · release ${c.release}` : ""}${c.tools?.length ? ` · ${c.tools.length} ${c.tools.length === 1 ? "tool" : "tools"} in the toolbox` : ""}. Share to publish puts it on your organization's review desk.`, primary: "Build and run again", primaryOn: true, canOpen: !!c.url, canShare: true };
    case "failed":
      return { title: name, sub: c.error ? `The build failed: ${c.error}` : "The build failed. Fix it and build again.", primary: "Build and run again", primaryOn: true, canOpen: false, canShare: false };
  }
}

/** The turn the web sends for Build and run (its folder lives on the worker,
 *  where the loop's app_install reaches it). */
export function buildAndRunPrompt(folder: string): string {
  return `Build and run the Glyphh app in ${folder}: call app_install { dir: "${folder}" } (one call, the path — never a base64 bundle), then report the key, the release or the build job, and the tools it added.`;
}
