/**
 * app-instances.ts — the desktop's door to APP INSTANCES: apps installed in
 * the cloud (his decision, 2026-10-04). The server owns the instance
 * (server glyphh/docs/app-instances.md); this module is the client of its
 * routes and the writer of the `tab` library row that names the instance on
 * every surface.
 *
 *   install   POST /api/app-instances → PUT the zip to R2 → POST …/ready
 *   deploy    the thread's folder (the sandbox) as a .tgz → POST …/{key}/builds
 *             → PUT the source → POST …/{key}/builds/{n}/run: the platform
 *             builds release n as a JOB (app-platform.md §4, §6, §12 — `app_install { dir }`)
 *   releases  GET …/{key}/releases; pin = POST …/{key}/pin {n} (rollback = n-1)
 *   from hub  POST /api/app-instances/from-hub {itemId} — a hub app as the
 *             caller's personal instance, server-side
 *   list      GET  /api/app-instances (the ones this member may open)
 *   tools     the manifest's tools; a call is POST …/{key}/invoke
 *   bridge    a panel's `glyphh.call` is POST /app-host/{key}/call, as the member
 *   delete    DELETE /api/app-instances/{key}
 *
 * AN APP HAS ONE SHAPE (his order, 2026-10-06: "Cloud is first and every
 * surface pulls from it"): the instance. Nothing of an app runs on this
 * machine. The Tools tab's Never list (Settings → Build → Apps → <app> →
 * Tools) is the one thing this machine adds: a tool set to Never is neither
 * listed nor run from here. Nothing here touches Electron, so the pure parts
 * are tested under test/main.
 */

import fs from "node:fs";
import path from "node:path";
import { create as tarCreate } from "tar";
import AdmZip from "adm-zip";
import * as appsStore from "./apps-store.js";
import { getActiveUserId } from "./app-paths.js";
import { getPreference } from "./stores/preferences-db.js";
import { appCache, getClient, SERVER_URL } from "./glyphh-client.js";
import {
  instanceCardOf, instanceDetailOf, instanceRequestOf, instanceTabOpen, instanceTabRow, instanceToolRows, isInstanceCardId, instanceKeyOfCardId,
  panelUrlOf, panelPathOf, callPathOf, resolveInstance, tabConfigOf,
  type AppInstanceSummary, type BundleManifestLike, type InstanceCard, type InstanceKind,
} from "../shared/app-instances.js";

export type { AppInstanceSummary, InstanceCard, InstanceKind } from "../shared/app-instances.js";
export { isInstanceCardId, instanceKeyOfCardId, instanceKeyOfRow, panelUrlOf } from "../shared/app-instances.js";

const CACHE_KEY = "app-instances";

/** One release of an instance (the SDK's AppRelease, sdk/src/contract/app-instances.ts). */
export interface ReleaseRow { n: number; sha256: string; sizeBytes: number; note: string; at: string; by: string | null; pinned: boolean }

/** The SDK's app-instances resource (sdk/src/resources/app-instances.ts):
 *  list · create · ready · releases · pin · builds · runBuild · invoke · … */
const appInstances = () => getClient().appInstances;

/** The instances this member may open — org (everyone / on the list) and
 *  their own personal ones. Short-TTL cached (the wall, the loop's catalog
 *  and the Apps page all read it); empty when signed out or offline. */
export function listInstances(): Promise<AppInstanceSummary[]> {
  return appCache.cached(CACHE_KEY, async () => {
    try {
      const rows = await getClient().http.get<AppInstanceSummary[]>("/api/app-instances");
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  });
}

export function invalidateInstances(): void {
  appCache.invalidate(CACHE_KEY);
}

/** The instance a ref names (key, slug, or the member's personal one). */
export async function findInstance(ref: string): Promise<AppInstanceSummary | undefined> {
  return resolveInstance(await listInstances(), ref, getActiveUserId() || "");
}

interface CreateAnswer { instance: AppInstanceSummary; upload: { url: string; key: string } }

const isForbidden = (err: unknown): boolean => {
  const e = err as { code?: unknown; status?: unknown } | null;
  return e?.code === "E_FORBIDDEN" || e?.status === 403;
};

/** INSTALL = an org instance. The bundle's bytes go to the server's R2
 *  through the presigned PUT the create answers, then `ready` starts (or
 *  rolls) the instance's machine. An org admin installs an org instance;
 *  anyone else a personal one — with no `kind` given, org is tried first
 *  and a refusal falls back to personal, so one call works for every role.
 *  Re-installing a slug updates the instance in place (the server's rule). */
export async function installBundleAsInstance(bytes: Buffer, manifest: BundleManifestLike, opts: { kind?: InstanceKind; fetchImpl?: typeof fetch; note?: string } = {}): Promise<AppInstanceSummary> {
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const client = getClient();
  const create = async (kind: InstanceKind): Promise<CreateAnswer> =>
    client.http.post<CreateAnswer>("/api/app-instances", instanceRequestOf(manifest, { sha256, sizeBytes: bytes.length }, kind));
  let made: CreateAnswer;
  if (opts.kind) made = await create(opts.kind);
  else {
    try { made = await create("org"); }
    catch (err) { if (!isForbidden(err)) throw err; made = await create("personal"); }
  }
  const put = await (opts.fetchImpl ?? fetch)(made.upload.url, { method: "PUT", body: new Uint8Array(bytes), headers: { "content-type": "application/zip" } });
  if (!put.ok) throw new Error(`the bundle upload was refused (HTTP ${put.status})`);
  const live = await client.http.post<AppInstanceSummary>(`/api/app-instances/${encodeURIComponent(made.instance.key)}/ready`, opts.note ? { note: opts.note } : {});
  invalidateInstances();
  return live;
}

// ── ONE DOOR, BY PATH (his order, 2026-10-07; punch list 17 + 19) ───────────
//
// `app_install { dir }` takes a FOLDER on this machine and the runtime does
// the rest: a folder that already holds manifest.json + its entry is zipped
// and uploaded as a release; a folder with a package.json build script is
// SOURCE, tarred and built by the platform as a JOB. Base64 is only for a
// bundle handed over from outside, and only a small one — the evidence
// (server log 2026-10-07 03:47Z ×4): the model's tool call carrying a base64
// tgz was cut at the output limit after the tool name, and nothing reached
// the app server. Nothing big rides through the model again.

/** The most base64 a tool call may carry: past this, the answer is the path
 *  door. 64 KB of base64 is ~48 KB of zip — an icon and a page, not an app. */
export const BASE64_INPUT_CAP = 64 * 1024;

/** The refusal a flood gets, naming the door that works. Throws; never returns a value. */
export function refuseBase64Flood(b64: string | null | undefined, what = "bundleBase64"): void {
  const n = String(b64 ?? "").length;
  if (n <= BASE64_INPUT_CAP) return;
  throw new Error(`${what} is ${Math.round(n / 1024)} KB of base64 — too much to carry through a tool call (the cap is ${BASE64_INPUT_CAP / 1024} KB). Pass \`dir\` instead: app_install { dir: "<the app's folder>" } zips or builds it here and uploads it itself; never read a bundle into the transcript.`);
}

/** What never rides in a zipped bundle folder: installs, build outputs and history. */
export const BUNDLE_EXCLUDES: ReadonlySet<string> = new Set(["node_modules", ".next", ".git"]);

export type FolderShape = "bundle" | "source";

/** What a folder IS: SOURCE when its package.json carries a build script (the
 *  Next.js project shape — the platform builds it); a BUNDLE when it holds
 *  manifest.json and the manifest's entry as files (zip it as it is). */
export function folderShapeOf(dir: string, fsImpl: Pick<typeof fs, "existsSync" | "readFileSync"> = fs): FolderShape {
  const pkgPath = path.join(dir, "package.json");
  if (fsImpl.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fsImpl.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, unknown> };
      if (pkg && typeof pkg === "object" && pkg.scripts && typeof pkg.scripts.build === "string") return "source";
    } catch { /* not a project: read it as a bundle folder */ }
  }
  return "bundle";
}

/** The folder's manifest, read loosely (the server validates on install; the
 *  bundle lane validates the zip): slug lower-cased, like readGlyphhAppManifest. */
export function readFolderManifest(dir: string, fsImpl: Pick<typeof fs, "existsSync" | "readFileSync"> = fs): BundleManifestLike & Record<string, unknown> {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fsImpl.existsSync(manifestPath)) throw new Error(`${dir} has no manifest.json at its root — a Glyphh app folder holds manifest.json (+ its entry page), or a Next.js project with package.json`);
  let manifest: unknown;
  try { manifest = JSON.parse(fsImpl.readFileSync(manifestPath, "utf8")); }
  catch (err) { throw new Error(`manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("manifest.json must be a JSON object");
  const m = manifest as BundleManifestLike & Record<string, unknown>;
  const slug = String(m.slug || "").toLowerCase().trim();
  if (!slug) throw new Error("manifest.json names no slug");
  return { ...m, slug };
}

/** The folder as a zip: its entries minus BUNDLE_EXCLUDES at any depth. */
export function zipBundleFolder(dir: string): Buffer {
  const zip = new AdmZip();
  zip.addLocalFolder(dir, "", (p) => !p.split(/[\/]/).some((seg) => BUNDLE_EXCLUDES.has(seg)));
  const out = zip.toBuffer();
  if (!zip.getEntries().length) throw new Error(`${dir} is empty`);
  return out;
}

/** A build job as the server tells it (GET /api/app-instances/jobs/{id}). */
export interface BuildJob { id: string; key: string; status: "queued" | "building" | "ready" | "failed"; log: string; release: ReleaseRow | null; error: string | null; startedAt?: number | null; finishedAt?: number | null }

/** Start the platform's build of source n as a JOB — answered at once. */
export async function startBuildJob(key: string, n: number, note?: string): Promise<BuildJob> {
  const r = await getClient().http.post<{ job: BuildJob }>(`/api/app-instances/${encodeURIComponent(key)}/builds/${encodeURIComponent(String(n))}/run`, note ? { note } : {});
  if (!r?.job?.id) throw new Error("the platform started no build job");
  return r.job;
}

/** One read of a job. */
export function readBuildJob(id: string): Promise<BuildJob> {
  const jid = String(id || "").trim();
  if (!/^job_[0-9a-f]{24}$/.test(jid)) throw new Error("not a build job id (job_…) — app_install answers one when it starts a build");
  return getClient().http.get<BuildJob>(`/api/app-instances/jobs/${encodeURIComponent(jid)}`);
}

export const BUILD_POLL_MS = 2000;
export const BUILD_WAIT_MAX_MS = 10 * 60 * 1000;

/** Follow a job to its end (ready or failed), or until `timeoutMs` runs out —
 *  then the answer is the job as it stands, still building. `onLog` sees the
 *  log grow. */
export async function waitBuildJob(id: string, opts: { timeoutMs?: number; pollMs?: number; onLog?: (log: string) => void; sleep?: (ms: number) => Promise<void> } = {}): Promise<BuildJob> {
  const timeoutMs = Math.max(0, Math.min(BUILD_WAIT_MAX_MS, opts.timeoutMs ?? BUILD_WAIT_MAX_MS));
  const pollMs = Math.max(250, opts.pollMs ?? BUILD_POLL_MS);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const until = Date.now() + timeoutMs;
  let seen = "";
  let job = await readBuildJob(id);
  for (;;) {
    if (job.log && job.log !== seen) { seen = job.log; opts.onLog?.(job.log); }
    if (job.status === "ready" || job.status === "failed") return job;
    if (Date.now() >= until) return job;
    await sleep(Math.min(pollMs, Math.max(0, until - Date.now())));
    job = await readBuildJob(id);
  }
}

// ── Deploy: the thread's folder → a versioned release ───────────────────────

/** What never rides to the builder: installs and outputs (the pod runs
 *  `npm ci` + `next build` itself) and the repository's own history. */
export const DEPLOY_EXCLUDES: ReadonlySet<string> = new Set(["node_modules", ".next", "out", ".git"]);

/** The deploy answer's log is a tail: the server already caps the build log
 *  at 64 KB; an MCP answer carries the end of it, where the failure is. */
export const DEPLOY_LOG_TAIL_CHARS = 8000;

export interface DeployProject { folder: string; manifest: BundleManifestLike & Record<string, unknown> }

/** The folder a source install tars — THE THREAD'S FOLDER IS ITS SANDBOX (his
 *  constraint, 2026-09-29): a Code session deploys the folder it works in and
 *  nothing else. Refused without a folder, without `manifest.json` +
 *  `package.json` at its root (the Next.js project shape, app-platform.md
 *  §8), or when the manifest's slug is not the one the call named. */
export function checkDeployFolder(folder: string | null | undefined, slug: string, fsImpl: Pick<typeof fs, "existsSync" | "statSync" | "readFileSync"> = fs): DeployProject {
  const dir = String(folder || "").trim();
  if (!dir) throw new Error("no folder is set for this session — a Code session deploys the folder it works in; pick one first");
  let isDir = false;
  try { isDir = fsImpl.statSync(dir).isDirectory(); } catch { isDir = false; }
  if (!isDir) throw new Error(`the session's folder is not a directory: ${dir}`);
  const manifestPath = path.join(dir, "manifest.json");
  if (!fsImpl.existsSync(manifestPath)) throw new Error(`${dir} has no manifest.json at its root — a Glyphh app is a Next.js project with manifest.json + package.json (the build-glyphh-app skill)`);
  if (!fsImpl.existsSync(path.join(dir, "package.json"))) throw new Error(`${dir} has no package.json at its root — a Glyphh app is a Next.js project with manifest.json + package.json (the build-glyphh-app skill)`);
  let manifest: unknown;
  try { manifest = JSON.parse(fsImpl.readFileSync(manifestPath, "utf8")); }
  catch (err) { throw new Error(`manifest.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`); }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("manifest.json must be a JSON object");
  const m = manifest as BundleManifestLike & Record<string, unknown>;
  const want = String(slug || "").toLowerCase().trim();
  const have = String(m.slug || "").toLowerCase().trim();
  if (!want) throw new Error("a source install needs the app's slug");
  if (!have) throw new Error("manifest.json names no slug");
  if (have !== want) throw new Error(`manifest.json is the app "${have}" but the call named "${want}" — install from that app's folder, or pass its slug`);
  return { folder: dir, manifest: { ...m, slug: have } };
}

/** The project as a gzipped tar (what `POST …/builds` takes): the folder's
 *  entries minus DEPLOY_EXCLUDES at any depth, portable, rooted at `.`. */
export async function packProjectFolder(folder: string): Promise<Buffer> {
  const entries = fs.readdirSync(folder).filter((name) => !DEPLOY_EXCLUDES.has(name));
  if (!entries.length) throw new Error(`${folder} is empty`);
  const stream = tarCreate({ gzip: true, cwd: folder, portable: true, filter: (p) => !p.split(/[\\/]/).some((seg) => DEPLOY_EXCLUDES.has(seg)) }, entries);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

export interface DeployAnswer {
  key: string;
  /** How the folder went up: a zipped bundle, or source the platform built. */
  mode: FolderShape;
  /** The release that is live now — null while a build job is still running. */
  release: ReleaseRow | null;
  /** The build job (source only): poll it with app_build_status when `release` is null. */
  job: BuildJob | null;
  log: string;
  tools: string[];
  /** The hosted panel's URL on the server, for Open. */
  url: string;
}

/** The deploy answer's log tail: the end, where a failure is. */
export function logTail(log: string): string {
  return log.length > DEPLOY_LOG_TAIL_CHARS ? log.slice(-DEPLOY_LOG_TAIL_CHARS) : log;
}

/** DEPLOY = the folder's source → a release. The instance is the one of that
 *  slug this member may reach (its org instance, or their personal one;
 *  `kind` names which); with none yet, one is CREATED first — the create
 *  route wants a bundle's identity up front, so the SOURCE tgz's sha + size
 *  stand in until `/builds/{n}/run` records the built release (the gap:
 *  app-platform.md §4 has no create-without-bundle). Then `builds` → PUT the
 *  tgz → `runBuild`, which waits for the platform's build and pins it. */
export async function deployFolderAsInstance(folder: string | null | undefined, opts: { slug: string; kind?: InstanceKind; note?: string; fetchImpl?: typeof fetch; pack?: (folder: string) => Promise<Buffer>; wait?: boolean; waitMs?: number; onLog?: (log: string) => void; sleep?: (ms: number) => Promise<void> }): Promise<DeployAnswer> {
  const project = checkDeployFolder(folder, opts.slug);
  const slug = String(project.manifest.slug);
  if (opts.kind !== undefined && opts.kind !== "org" && opts.kind !== "personal") throw new Error('kind is "org" or "personal"');
  const tgz = await (opts.pack ?? packProjectFolder)(project.folder);
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(tgz).digest("hex");

  const userId = getActiveUserId() || "";
  const mine = await listInstances();
  const ofKind = (kind: InstanceKind) => mine.find((i) => i.slug === slug && i.kind === kind && (kind === "org" || i.key === `${slug}~${userId}`));
  let inst = opts.kind ? ofKind(opts.kind) : (ofKind("org") ?? ofKind("personal"));
  if (!inst) {
    const api = appInstances();
    const create = async (kind: InstanceKind) => api.create(instanceRequestOf(project.manifest, { sha256, sizeBytes: tgz.length }, kind));
    let made: { instance: AppInstanceSummary };
    if (opts.kind) made = await create(opts.kind) as unknown as { instance: AppInstanceSummary };
    else {
      try { made = await create("org") as unknown as { instance: AppInstanceSummary }; }
      catch (err) { if (!isForbidden(err)) throw err; made = await create("personal") as unknown as { instance: AppInstanceSummary }; }
    }
    inst = made.instance;
    invalidateInstances();
  }

  const api = appInstances();
  const build = await api.builds(inst.key);
  const put = await (opts.fetchImpl ?? fetch)(build.upload.url, { method: "PUT", body: new Uint8Array(tgz), headers: { "content-type": "application/gzip" } });
  if (!put.ok) throw new Error(`the source upload was refused (HTTP ${put.status})`);
  // A JOB, NOT A BLOCKING CALL (punch list 19): the platform answers at once
  // with the job; `wait` (the default) follows it here, `waitMs` bounds that.
  let job = await startBuildJob(inst.key, build.build.n, opts.note);
  if (opts.wait !== false) job = await waitBuildJob(job.id, { timeoutMs: opts.waitMs, onLog: opts.onLog, sleep: opts.sleep });
  if (job.status === "failed") throw new Error(`the build failed: ${job.error || "see the log"}\n${logTail(job.log || "")}`);
  invalidateInstances();
  const live = (await listInstances()).find((i) => i.key === inst!.key);
  const tools = instanceToolRows(live ? [live] : []).flatMap((r) => r.tools.map((t) => t.name));
  const declared = (Array.isArray(project.manifest.tools) ? project.manifest.tools : []).map((t) => String(t?.name ?? "")).filter(Boolean);
  return { key: inst.key, mode: "source", release: job.status === "ready" ? job.release : null, job, log: logTail(String(job.log ?? "")), tools: tools.length ? tools : declared, url: panelPathOf(inst.key) };
}

/** THE ONE DOOR: a folder on this machine becomes (or updates) the member's
 *  instance. Source (package.json with a build script) goes up as a .tgz and
 *  the platform builds it as a job; a bundle folder (manifest.json + its
 *  entry) is zipped and released as it is. `slug` must match the manifest when
 *  given; with none the manifest's own is used. */
export async function installFolderAsInstance(folder: string | null | undefined, opts: { slug?: string; kind?: InstanceKind; note?: string; fetchImpl?: typeof fetch; wait?: boolean; waitMs?: number; onLog?: (log: string) => void; sleep?: (ms: number) => Promise<void>; fsImpl?: Pick<typeof fs, "existsSync" | "readFileSync" | "statSync">; zip?: (dir: string) => Buffer; pack?: (folder: string) => Promise<Buffer> } = {}): Promise<DeployAnswer> {
  const fsImpl = opts.fsImpl ?? fs;
  const dir = String(folder || "").trim();
  if (!dir) throw new Error("no folder — pass `dir` (the app's folder on this machine), or pick a folder for this session first");
  let isDir = false;
  try { isDir = fsImpl.statSync(dir).isDirectory(); } catch { isDir = false; }
  if (!isDir) throw new Error(`not a directory: ${dir}`);
  const manifest = readFolderManifest(dir, fsImpl);
  const want = String(opts.slug || "").toLowerCase().trim();
  if (want && want !== manifest.slug) throw new Error(`manifest.json is the app "${manifest.slug}" but the call named "${want}" — install from that app's folder, or drop the slug`);
  const shape = folderShapeOf(dir, fsImpl);
  if (shape === "source") {
    return deployFolderAsInstance(dir, { slug: manifest.slug, ...(opts.kind ? { kind: opts.kind } : {}), ...(opts.note ? { note: opts.note } : {}), ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), ...(opts.pack ? { pack: opts.pack } : {}), wait: opts.wait, waitMs: opts.waitMs, onLog: opts.onLog, sleep: opts.sleep });
  }
  const entry = String(manifest.entry || "");
  if (!entry || !fsImpl.existsSync(path.join(dir, entry))) throw new Error(`${dir} is a bundle folder (no build script) but its manifest's entry "${entry || "(none)"}" is not in it — a bundle holds manifest.json, its entry page and the worker; a project holds package.json with a build script`);
  const bytes = (opts.zip ?? zipBundleFolder)(dir);
  const live = await installBundleAsInstance(bytes, manifest, { ...(opts.kind ? { kind: opts.kind } : {}), ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}), ...(opts.note ? { note: opts.note } : {}) });
  try { await ensureInstanceTab(live, manifest); } catch { /* the tab can wait for the next open */ }
  const [{ invalidateOrgApps }, { broadcast }] = await Promise.all([import("./org-apps.js"), import("./broadcast.js")]);
  invalidateOrgApps();
  broadcast("panel-apps-changed");
  const tools = instanceToolRows([live]).flatMap((r) => r.tools.map((t) => t.name));
  const declared = (Array.isArray(manifest.tools) ? manifest.tools : []).map((t) => String((t as { name?: unknown })?.name ?? "")).filter(Boolean);
  const rel = releaseOfSummary(live);
  return { key: live.key, mode: "bundle", release: rel, job: null, log: "", tools: tools.length ? tools : declared, url: panelPathOf(live.key) };
}

/** The release row a fresh summary implies (the server answers the number; the row's rest is what the install knows). */
function releaseOfSummary(inst: AppInstanceSummary): ReleaseRow | null {
  const n = inst.release;
  if (!Number.isInteger(n) || (n as number) < 1) return null;
  return { n: n as number, sha256: inst.bundle?.sha256 ?? "", sizeBytes: inst.bundle?.bytes ?? 0, note: "", at: new Date().toISOString(), by: null, pinned: true };
}

/** `app_releases`: every release of the instance a ref names, oldest first; `pinned` marks the live one. */
export async function listInstanceReleases(ref: string): Promise<ReleaseRow[]> {
  const inst = await findInstance(ref);
  if (!inst) throw new Error(`no app instance ${ref} — not installed in the cloud (app_list_tools names what is)`);
  const rows = await appInstances().releases(inst.key);
  return Array.isArray(rows) ? rows as ReleaseRow[] : [];
}

/** `app_pin` / Rollback: pin an existing release of the instance a ref names. */
export async function pinInstanceRelease(ref: string, n: number): Promise<AppInstanceSummary> {
  const inst = await findInstance(ref);
  if (!inst) throw new Error(`no app instance ${ref} — not installed in the cloud (app_list_tools names what is)`);
  if (!Number.isInteger(n) || n < 1) throw new Error("n must be a release number (a positive integer) — app_releases lists them");
  const live = await appInstances().pin(inst.key, n) as unknown as AppInstanceSummary;
  invalidateInstances();
  return live;
}

// ── APPS CARRY A VERSION; DEFAULTS INSTALL BY MANIFEST (his order, 2026-10-07) ──

/** Move an instance to the catalog's head: the same key, the next release
 *  pinned, data and secrets kept (POST /api/app-instances/{key}/update). */
export async function updateInstance(ref: string): Promise<AppInstanceSummary> {
  const inst = await findInstance(ref);
  if (!inst) throw new Error(`no app instance ${ref}`);
  const live = await getClient().http.post<AppInstanceSummary>(`/api/app-instances/${encodeURIComponent(inst.key)}/update`, {});
  invalidateInstances();
  return live;
}

/** Every instance of the caller's with an update waiting, moved at once. */
export async function updateAllInstances(): Promise<{ updated: AppInstanceSummary[]; failed: Array<{ key: string; error: string }> }> {
  const r = await getClient().http.post<{ updated?: AppInstanceSummary[]; failed?: Array<{ key: string; error: string }> }>("/api/app-instances/update-all", {});
  invalidateInstances();
  return { updated: r?.updated ?? [], failed: r?.failed ?? [] };
}

/** THE DEFAULTS, IN THE BACKGROUND (his order, 2026-10-07): the apps whose
 *  manifest says installAsDefault — minus the org's overrides, minus what the
 *  member already holds or removed — become this member's instances. Never on
 *  the boot path: the renderer asks for it after first paint, main runs it,
 *  and a landed install announces itself like any other. */
export async function installDefaultApps(): Promise<{ installed: number; failed: number }> {
  const r = await getClient().http.post<{ installed?: AppInstanceSummary[]; failed?: Array<{ slug: string; error: string }> }>("/api/app-instances/defaults/install", {});
  const installed = r?.installed?.length ?? 0;
  const failed = r?.failed?.length ?? 0;
  if (installed) {
    invalidateInstances();
    for (const inst of r!.installed!) { try { await ensureInstanceTab(inst, null); } catch { /* the tab can wait for the next open */ } }
    const [{ invalidateOrgApps }, { broadcast }] = await Promise.all([import("./org-apps.js"), import("./broadcast.js")]);
    invalidateOrgApps();
    broadcast("panel-apps-changed");
  }
  if (failed) console.warn("[app-instances] default installs that failed:", r!.failed!.map((f) => `${f.slug}: ${f.error}`).join("; "));
  return { installed, failed };
}

/** THE ORG'S WORD ON DEFAULTS (his order, 2026-10-07): every catalog app with
 *  its manifest flag, the org's override and what that makes it; PUT merges
 *  `{itemRef: on|off|null}` (null clears the override). Org admin only. */
export type DefaultOverride = "on" | "off";
export interface AdminAppDefaults { items: Array<{ itemRef: string; source: "org" | "public"; slug: string; name: string; description: string; release: number; version: string | null; flagged: boolean; override: DefaultOverride | null; default: boolean }>; overrides: Record<string, DefaultOverride> }
export const adminAppDefaults = (): Promise<AdminAppDefaults> => getClient().http.get<AdminAppDefaults>("/api/admin/app-defaults");
export const setAdminAppDefaults = (overrides: Record<string, DefaultOverride | null>): Promise<AdminAppDefaults> =>
  getClient().http.put<AdminAppDefaults>("/api/admin/app-defaults", { overrides });

/** The `app-instance-pin` IPC's body (the same name on the web, member-
 *  library-web.js): a card id or an instance key, the release to pin. */
export async function appInstancePinHandler(id: string, n: number): Promise<{ ok: boolean; data?: AppInstanceSummary; error?: string }> {
  try {
    const ref = isInstanceCardId(String(id)) ? instanceKeyOfCardId(String(id)) : String(id);
    return { ok: true, data: await pinInstanceRelease(ref, Number(n)) };
  } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}

/** A HUB APP AS THIS MEMBER'S PERSONAL INSTANCE, made server-side: the hub
 *  item's bundle becomes the instance without a round trip through this
 *  machine. The server answers the instance (or `{instance}`). */
export async function installFromHub(itemId: string): Promise<AppInstanceSummary> {
  const id = String(itemId || "").trim();
  if (!id) throw new Error("installFromHub needs the hub item's id");
  const answer = await getClient().http.post<AppInstanceSummary | { instance: AppInstanceSummary }>("/api/app-instances/from-hub", { itemId: id });
  const inst = answer && typeof answer === "object" && "instance" in answer && answer.instance && typeof answer.instance === "object" ? answer.instance : answer as AppInstanceSummary;
  if (!inst || typeof inst !== "object" || typeof inst.key !== "string") throw new Error("the server answered no instance for that hub item");
  invalidateInstances();
  return inst;
}

/** The `tab` row for an instance: written through apps-store so it is
 *  announced to the member library and reaches every surface. A row of the
 *  same slug from before the cloud is retargeted at the instance. */
export async function ensureInstanceTab(inst: AppInstanceSummary, manifest: BundleManifestLike | null): Promise<appsStore.LocalAppRow> {
  const existing = appsStore.readRow(inst.slug);
  const row = instanceTabRow(inst, manifest, existing, new Date().toISOString());
  if (existing) {
    return appsStore.updateEntry(inst.slug, { name: row.name, kind: "glyphh", nativeRef: null, url: null, description: row.description, config: row.config ?? undefined });
  }
  return appsStore.createEntry({ kind: "glyphh", slug: inst.slug, name: row.name, description: row.description, config: row.config ?? tabConfigOf(inst, manifest) });
}

/** Tools the member set to Never on the app's Tools tab, by instance key. */
function hiddenAppTools(key: string): Set<string> {
  const list = getPreference<unknown>(`appHiddenTools:${key}`, []);
  return new Set(Array.isArray(list) ? list.map(String) : []);
}

/** One row of app_list_tools: an instance and the tools it answers to. */
export type AppToolRow = ReturnType<typeof instanceToolRows>[number];

/** Every instance's declared tools, less the ones set to Never, for
 *  app_list_tools and the loop's catalog. */
export async function listInstanceTools(): Promise<AppToolRow[]> {
  return instanceToolRows(await listInstances())
    .map((r) => ({ ...r, tools: r.tools.filter((t) => !hiddenAppTools(r.app).has(t.name)) }))
    .filter((r) => r.tools.length > 0);
}

/** app_call_tool's path: the instance's machine runs the tool as this member. */
export async function callInstanceTool(ref: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const inst = await findInstance(ref);
  if (!inst) throw new Error(`no app instance ${ref} — not installed in the cloud (app_list_tools names what is)`);
  if (hiddenAppTools(inst.key).has(tool)) throw new Error(`tool "${tool}" is set to Never for this app`);
  const answer = await getClient().http.post<unknown>(`/api/app-instances/${encodeURIComponent(inst.key)}/invoke`, { tool, args: args || {} }, { raw: true });
  const body = answer as { result?: unknown; error?: unknown; detail?: unknown } | null;
  if (body && typeof body === "object" && "error" in body && body.error) throw new Error(String(body.detail || body.error));
  return body && typeof body === "object" && "result" in body ? body.result : body;
}

/** A panel's `glyphh.call(method, args)` on the desktop: the preload hands it
 *  to main, main POSTs the instance's /call as the member (the bearer, never
 *  a cookie) and answers the pod's own `{ok, result} | {ok:false, error}`. */
export async function callInstanceBridge(key: string, method: string, args: unknown, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  let token = "";
  try { token = await getClient().token(); } catch { token = ""; }
  if (!token) return { ok: false, error: "signed out" };
  try {
    const res = await fetchImpl(`${SERVER_URL}${callPathOf(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ method, args: args ?? {} }),
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (body && typeof body === "object" && "ok" in body) return body as { ok: true; result: unknown } | { ok: false; error: string };
    if (!res.ok) {
      const detail = body && typeof body === "object" ? (body as { detail?: unknown; error?: unknown }).detail ?? (body as { error?: unknown }).error : null;
      return { ok: false, error: String(detail || `the app answered ${res.status}`) };
    }
    return { ok: true, result: body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The URL a panel loads for an instance: `${SERVER_URL}/app-host/<key>/ui/`
 *  (trailing slash — the app server resolves the release's index.html). */
export const instancePanelUrl = (key: string): string => panelUrlOf(SERVER_URL, key);

/** The session bearer, for the cookie a panel's webview needs to load `ui/*`. */
export async function sessionBearer(): Promise<string | null> {
  try { return (await getClient().token()) || null; } catch { return null; }
}

export async function deleteInstance(key: string): Promise<void> {
  await getClient().http.del(`/api/app-instances/${encodeURIComponent(key)}`);
  invalidateInstances();
  // The tab that named it goes with it.
  const slug = key.split("~", 1)[0];
  const row = appsStore.readRow(slug);
  if (row && row.kind === "glyphh") await appsStore.removeEntry(slug).catch(() => undefined);
}

// ── Settings → Apps cards ───────────────────────────────────────────────────

/** The Settings → Apps cards: one per instance this member may open. */
export async function instanceCards(): Promise<InstanceCard[]> {
  const now = new Date().toISOString();
  return (await listInstances()).map((i) => instanceCardOf(i, now));
}

export async function instanceDetail(id: string): Promise<ReturnType<typeof instanceDetailOf>> {
  const key = instanceKeyOfCardId(id);
  const inst = (await listInstances()).find((i) => i.key === key);
  if (!inst) throw new Error(`no cloud app ${key}`);
  return instanceDetailOf(inst, new Date().toISOString());
}

/** Open = the tab (created on first open, so the wall and the rail know it);
 *  a house app's answer names its built-in panel (shared instanceTabOpen). */
export async function instanceTab(id: string): Promise<{ slug: string; name: string; tool?: string }> {
  const key = instanceKeyOfCardId(id);
  const inst = (await listInstances()).find((i) => i.key === key);
  if (!inst) throw new Error(`no cloud app ${key}`);
  return instanceTabOpen(await ensureInstanceTab(inst, null));
}
