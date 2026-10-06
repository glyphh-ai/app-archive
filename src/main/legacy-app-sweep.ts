/**
 * legacy-app-sweep.ts — PRE-CLOUD APP FOLDERS ARE DELETED, NO MIGRATION (his
 * word, 2026-10-05: "all apps prior, the usage is zero, will be deleted").
 *
 * Before the cloud-app model (2026-10-04/05) an installed app was a folder on
 * this machine: a bundle in the user's apps home (SKILL.md + app.json + ui/),
 * or a `.glyphh` unzipped under apps/<org>/<slug> or custom-apps/<slug> with
 * a glyphh tab row pointing at its entry. There is no "Move to the cloud" any
 * more; the first sign-in after the cut sweeps those folders once.
 *
 * THE RULE (legacyAppFolders, pure): a folder is legacy only when it is an
 * app (it has a manifest) whose manifest says NOTHING about `data` — every
 * current-model bundle carries the author's word (`cloud` / `local` /
 * `per-home`; the hub stamps it, the scaffold writes the key) — AND no cloud
 * instance of its slug exists AND it is not a house app (Images, Audio,
 * Video, Slides, Design, Drive, or any bundle that IS a built-in panel). A
 * folder with no manifest at all (a web or native tab's row, a link into a dev
 * build, a parked folder) is never touched. Skills, tasks, plugins, app-data
 * stores and the user's files live elsewhere and are not in reach.
 *
 * ONCE PER USER: a marker file in the user's home records the sweep; a run
 * that cannot list the member's instances (offline, a dead token) does
 * nothing and leaves no marker, so the next sign-in tries again. Under the
 * `GLYPHH_LOCAL_APPS=1` override every app is a local one by design and the
 * sweep stays out.
 */

import fs from "fs";
import path from "path";
import { appsRoot, getActiveUserId, userScopedPath } from "./app-paths.js";
import { APPS_DIR, readRow, type LocalAppRow } from "./apps-store.js";
import { localAppsEnabled } from "./app-instances.js";
import { getClient } from "./glyphh-client.js";
import { HOUSE_APP_SLUGS } from "../shared/house-store.js";
import { instanceKeyOfRow } from "../shared/app-instances.js";
import { payloadDirOf } from "../shared/bundle-shape.js";

export const LEGACY_SWEEP_MARKER = ".legacy-apps-swept";

/** What the sweep knows about one folder in the apps home. */
export interface LegacyAppEntry {
  slug: string;
  /** The app's manifest (app.json, or the unzipped bundle's manifest.json);
   *  absent or null when the folder is not an app. */
  manifest?: { data?: unknown } | null;
  isHouse: boolean;
  hasInstance: boolean;
}

/** THE RULE. The slugs to sweep: apps with a manifest that says nothing about
 *  `data`, no instance in the cloud, not a house app — each once. */
export function legacyAppFolders(entries: LegacyAppEntry[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const slug = String(e.slug || "").toLowerCase().trim();
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    if (!e.manifest || typeof e.manifest !== "object") continue;
    if (e.manifest.data !== undefined) continue;
    if (e.isHouse || e.hasInstance) continue;
    out.push(slug);
  }
  return out;
}

export interface SweepDeps {
  /** The user's apps home (bundle folders and tab rows). */
  appsDir: string;
  /** The org-scoped payload root and the flat one a `.glyphh` unzipped into. */
  appsRoot: string;
  customRoot: string;
  /** The once-per-user marker file. */
  marker: string;
  /** The instances this member may open. MUST throw when the server cannot answer. */
  instances: () => Promise<Array<{ slug: string }>>;
  readRow: (slug: string) => LocalAppRow | null;
  log: (line: string) => void;
}

export interface SweepResult {
  /** The slugs removed, in order. */
  swept: string[];
  /** Why nothing ran: already done for this user, or the instances could not be listed. */
  skipped?: "done" | "offline";
}

function readJson(file: string): Record<string, unknown> | null | undefined {
  let raw: string;
  try { raw = fs.readFileSync(file, "utf-8"); } catch { return undefined; }
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

const isHouseApp = (slug: string, manifest: Record<string, unknown> | null | undefined): boolean =>
  HOUSE_APP_SLUGS.includes(slug) || (!!manifest && typeof manifest.tool === "string" && !!manifest.tool);

/** The folders in the apps home as the rule sees them, with where each one's
 *  bytes are (the folder itself, plus an unzipped payload elsewhere). */
function readEntries(deps: SweepDeps): Array<LegacyAppEntry & { dirs: string[] }> {
  let names: fs.Dirent[] = [];
  try { names = fs.readdirSync(deps.appsDir, { withFileTypes: true }); } catch { return []; }
  const out: Array<LegacyAppEntry & { dirs: string[] }> = [];
  for (const e of names) {
    if (e.name.startsWith(".") || !e.isDirectory()) continue;   // a link is a dev build's — never ours to remove
    const dir = path.join(deps.appsDir, e.name);
    const slug = e.name.toLowerCase();
    const row = deps.readRow(e.name);
    const named = !!(row && instanceKeyOfRow(row));
    const bundleManifest = readJson(path.join(dir, "app.json"));
    if (bundleManifest !== undefined) {
      // A bundle in the apps home. An unreadable app.json (null) is kept.
      out.push({ slug, manifest: bundleManifest, isHouse: isHouseApp(slug, bundleManifest), hasInstance: named, dirs: [dir] });
      continue;
    }
    if (!row || row.kind !== "glyphh" || !row.nativeRef || named) {
      // A web/native tab's row, a glyphh row that names its instance, or a
      // folder that is nothing of ours: not an app folder.
      out.push({ slug, manifest: null, isHouse: false, hasInstance: named, dirs: [dir] });
      continue;
    }
    // A glyphh tab row whose entry is a file on this machine: the unzipped
    // bundle's manifest.json says where its data lives; with the payload gone,
    // the row's own config is the only word left.
    const payload = payloadDirOf(row.nativeRef, deps.appsRoot, deps.customRoot);
    const zipManifest = payload ? readJson(path.join(payload, "manifest.json")) : undefined;
    const manifest = zipManifest === undefined ? { data: (row.config ?? {}).data } : zipManifest;
    out.push({ slug, manifest, isHouse: isHouseApp(slug, manifest), hasInstance: false, dirs: payload ? [dir, payload] : [dir] });
  }
  return out;
}

/** The sweep, over injected paths and a server answer (tested under test/main). */
export async function sweepLegacyAppFolders(deps: SweepDeps): Promise<SweepResult> {
  if (fs.existsSync(deps.marker)) return { swept: [], skipped: "done" };
  let cloudSlugs: Set<string>;
  try { cloudSlugs = new Set((await deps.instances()).map((i) => String(i.slug).toLowerCase())); }
  catch (err) {
    deps.log(`[legacy-apps] sweep deferred — the instances could not be listed: ${err instanceof Error ? err.message : String(err)}`);
    return { swept: [], skipped: "offline" };
  }
  const entries = readEntries(deps).map((e) => ({ ...e, hasInstance: e.hasInstance || cloudSlugs.has(e.slug) }));
  const byDir = new Map(entries.map((e) => [e.slug, e.dirs] as const));
  const swept: string[] = [];
  for (const slug of legacyAppFolders(entries)) {
    for (const dir of byDir.get(slug) ?? []) {
      try { fs.rmSync(dir, { recursive: true, force: true }); }
      catch (err) { deps.log(`[legacy-apps] "${slug}": ${dir} not removed: ${err instanceof Error ? err.message : String(err)}`); }
    }
    swept.push(slug);
  }
  if (swept.length) deps.log(`[legacy-apps] removed ${swept.length} app folder${swept.length === 1 ? "" : "s"} from before the cloud: ${swept.join(", ")}`);
  else deps.log("[legacy-apps] no app folders from before the cloud");
  try {
    fs.mkdirSync(path.dirname(deps.marker), { recursive: true });
    fs.writeFileSync(deps.marker, JSON.stringify({ at: new Date().toISOString(), swept }, null, 2));
  } catch (err) { deps.log(`[legacy-apps] marker not written: ${err instanceof Error ? err.message : String(err)}`); }
  return { swept };
}

/** The desktop's run: the signed-in user's apps home, the server's instance
 *  list, the user's marker. The app list and the wall are refreshed when
 *  anything went. */
export async function runLegacyAppSweep(): Promise<void> {
  if (localAppsEnabled() || !getActiveUserId()) return;
  const result = await sweepLegacyAppFolders({
    appsDir: APPS_DIR(),
    appsRoot: appsRoot(),
    customRoot: userScopedPath("custom-apps"),
    marker: userScopedPath(LEGACY_SWEEP_MARKER),
    instances: async () => {
      const rows = await getClient().http.get<Array<{ slug: string }>>("/api/app-instances");
      if (!Array.isArray(rows)) throw new Error("the instances did not list");
      return rows;
    },
    readRow,
    log: (line) => console.info(line),
  });
  if (!result.swept.length) return;
  const [{ invalidateOrgApps }, { broadcast }] = await Promise.all([import("./org-apps.js"), import("./broadcast.js")]);
  invalidateOrgApps();
  broadcast("panel-apps-changed");
}
