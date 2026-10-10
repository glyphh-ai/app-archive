/**
 * App install path — validate + package + install a Glyphh app from source.
 *
 * The one-shot LLM builder (create_app / buildGlyphhApp) is retired: frontier
 * agents build apps as REAL Vite projects in the working folder now, and the
 * loop ships them through update_app → updateAppFromWorkdir → the host's
 * install gate, which makes (or updates) the app's CLOUD INSTANCE (his order,
 * 2026-10-06: nothing runs in place on this machine). Two shapes are handled:
 *   - BUILT Vite project (glyphh.app.json + dist/index.html) → package the
 *     compiled dist/ (flattened) + manifest + worker; source never ships.
 *   - Legacy single-file app (manifest.json + inline index.html) → package the
 *     working folder's files as before.
 */

import AdmZip from "adm-zip";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { getExplicitWorkingDirectory } from "./working-directory";
import { validateAppBundle, lintRemoteAssets, type AppBundle } from "@glyphh/sdk";
import { collectBuiltProject, manifestPathIn, type InstallFile } from "./glyphh-app-spec";
import { installGlyphhAppBundle, type InstallAnswer } from "./glyphh-app-host";
import * as appsStore from "./apps-store";

// The ten built-in work panels (Office / Design / Memory / Media) are
// Apps-page fixtures, not org apps — an install or deploy under their slugs is
// refused at the manifest, where the slug first exists (glyphh-agent-tools.ts
// and apps-ipc.ts refuse the slug-carrying seams the same way).
const BUILTIN_WORKPANELS = new Set(["gpoint", "gdoc", "gsheet"]);

/** Throw the refusal when a workdir manifest names a built-in work panel. */
function refuseBuiltinWorkpanel(slug: string): void {
  if (BUILTIN_WORKPANELS.has(slug)) {
    throw new Error("work panels are built in — they cannot be altered or removed");
  }
}

/** Zip a text Bundle and run it through the host's real install gate. */
async function packageAndInstall(bundle: AppBundle): Promise<InstallAnswer> {
  const zip = new AdmZip();
  for (const [file, content] of Object.entries(bundle)) {
    zip.addFile(file, Buffer.from(content, "utf8"));
  }
  return installZip(zip);
}

/** Zip on-disk files (binary-safe) + a normalized manifest, then install. */
async function packageBuiltAndInstall(files: InstallFile[], manifestJson: string): Promise<InstallAnswer> {
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(manifestJson, "utf8"));
  for (const f of files) {
    if (f.archivePath === "manifest.json") continue; // manifest is authoritative above
    try { zip.addLocalFile(f.absPath, path.dirname(f.archivePath) || undefined, path.basename(f.archivePath)); }
    catch { /* unreadable file — skip */ }
  }
  return installZip(zip);
}

async function installZip(zip: AdmZip): Promise<InstallAnswer> {
  const tmp = path.join(os.tmpdir(), `glyphh-build-${Date.now().toString(36)}.glyphh`);
  fs.writeFileSync(tmp, zip.toBuffer());
  try {
    return await installGlyphhAppBundle(tmp);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* tmp gone */ }
  }
}

/** The app-source directory inside the working folder: the root when it holds
 *  a manifest (glyphh.app.json | manifest.json), else the newest subfolder that
 *  does. */
function resolveAppDir(wd: string): string {
  if (manifestPathIn(wd)) return wd;
  const sub = fs.readdirSync(wd)
    .map((n) => path.join(wd, n))
    .filter((p) => { try { return fs.statSync(p).isDirectory() && manifestPathIn(p) !== null; } catch { return false; } })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (!sub) throw new Error("no glyphh.app.json / manifest.json in the working folder — nothing to update");
  return sub;
}

/**
 * The iteration loop's return path: re-validate + re-install the app from the
 * WORKING FOLDER's source. Built Vite projects ship their compiled dist/;
 * legacy single-file apps ship their folder files. The agent edits + rebuilds,
 * calls update_app, and the installed app catches up.
 */
export async function updateAppFromWorkdir(
  lookup?: (slug: string) => string[] | null,
): Promise<{ slug: string; name: string; warnings: string[]; instance?: string }> {
  const wd = getExplicitWorkingDirectory();
  if (!wd) throw new Error("no working folder is set");
  const dir = resolveAppDir(wd);

  // ── Built Vite project: package dist/ (compiled) — never src/node_modules ──
  const built = collectBuiltProject(dir);
  if (built) {
    // Defense in depth over the runtime CSP: refuse a bundle whose built
    // assets reference remote code, even though the CSP would block it.
    const textAssets: Record<string, string> = {};
    for (const f of built.files) {
      if (!/\.(html?|css|m?js|jsx|ts|tsx)$/i.test(f.archivePath)) continue;
      try { if (fs.statSync(f.absPath).size < 2_000_000) textAssets[f.archivePath] = fs.readFileSync(f.absPath, "utf8"); }
      catch { /* skip unreadable */ }
    }
    const remote = lintRemoteAssets({ ...textAssets, "manifest.json": built.manifestJson });
    if (remote.length) throw new Error(`build ships remote assets (bundle them instead): ${remote.join("; ")}`);

    const m = JSON.parse(built.manifestJson) as { slug: string; name: string };
    refuseBuiltinWorkpanel(m.slug);
    // THE BUILD SHIPS TO THE CLOUD: the compiled dist/ + manifest become (or
    // update) the app's instance, and open_app opens that. Name WHERE it
    // landed — "success" without a place made an open failure undiagnosable.
    const r = await packageBuiltAndInstall(built.files, built.manifestJson);
    if (!r.ok) throw new Error(r.error || "install failed");
    return { slug: m.slug, name: r.name || m.name, warnings: [], instance: r.instance };
  }

  // ── Legacy single-file app: package the folder's text files as before ─────
  const bundle: AppBundle = {};
  for (const f of fs.readdirSync(dir)) {
    const abs = path.join(dir, f);
    try {
      if (fs.statSync(abs).isFile() && fs.statSync(abs).size < 512_000) bundle[f] = fs.readFileSync(abs, "utf8");
    } catch { /* unreadable — skip */ }
  }
  const remote = lintRemoteAssets(bundle);
  if (remote.length) throw new Error(`app references remote assets (inline or bundle them instead): ${remote.join("; ")}`);
  const v = validateAppBundle(bundle, lookup);
  if (!v.ok) throw new Error(`source fails validation: ${v.errors.join("; ")}`);
  refuseBuiltinWorkpanel(v.manifest!.slug);
  const r = await packageAndInstall(bundle);
  if (!r.ok) throw new Error(r.error || "install failed");
  return { slug: v.manifest!.slug, name: r.name || v.manifest!.name, warnings: v.warnings };
}

/** Folders never packed into the SOURCE snapshot — build products + machinery
 *  (mirrors the pod's source-sync rules; the two must agree byte-for-byte so
 *  identical trees hash identically). */
const SOURCE_EXCLUDES = new Set(["node_modules", "dist", ".git", ".glyphh", "build", ".next", "coverage"]);

/** Pack the PROJECT SOURCE (not dist) as the deterministic snapshot archive. */
function packProjectSource(dir: string): Buffer {
  const files: string[] = [];
  const walk = (rel: string): void => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SOURCE_EXCLUDES.has(e.name)) walk(rel ? `${rel}/${e.name}` : e.name);
      } else if (e.isFile()) {
        files.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  };
  walk("");
  files.sort();
  const zip = new AdmZip();
  for (const rel of files) zip.addFile(rel, fs.readFileSync(path.join(dir, rel)));
  return zip.toBuffer();
}

export async function pullAppSource(slug: string, _opts: { hash?: string; merge?: boolean } = {}): Promise<{ slug: string; hash: string; dir: string; files: number; merged?: boolean }> {
  refuseBuiltinWorkpanel(slug);
  // THE PURGE: the source-of-record service is retired — app source shares
  // through git now (clone/pull the project repo into the working folder).
  throw new Error("app source sync is retired — share this app's project through git (clone or pull its repo into the working folder)");
}

export async function commitAppSource(_message: string): Promise<{ slug: string; hash: string; noop: boolean }> {
  // THE PURGE: retired with the source-of-record service — use git.
  throw new Error("app source snapshots are retired — commit this project with git instead");
}

export interface R2SourceStatus {
  slug: string | null;
  localHash: string | null;
  head: { hash: string; parentHash: string | null; createdAt: string; createdByEmail: string | null } | null;
  /** Local tree ≠ the R2 head — the drift flag. */
  drifted: boolean;
  history: Array<{ hash: string; parentHash: string | null; createdAt: string; createdByEmail: string | null; isHead: boolean }>;
}

/** The app project dir inside a working folder — the folder itself when it
 *  isn't an app project (the R2 lane then reports slug null, not an error). */
export function appDirInWorkdir(wd: string): string {
  try { return resolveAppDir(wd); } catch { return wd; }
}

/** The folder's app slug, or null when it isn't an app project. */
function slugOfDir(dir: string): string | null {
  const mf = manifestPathIn(dir);
  if (!mf) return null;
  try { return (JSON.parse(fs.readFileSync(mf, "utf8")) as { slug?: string }).slug ?? null; }
  catch { return null; }
}

/** sha256 of the deterministic source archive — comparable with the server's
 *  snapshot hashes (both sides hash the same packProjectSource bytes). */
function localTreeHash(dir: string): { archive: Buffer; hash: string } {
  const archive = packProjectSource(dir);
  const hash = createHash("sha256").update(archive).digest("hex");
  return { archive, hash };
}

export async function r2SourceStatus(dir: string): Promise<R2SourceStatus> {
  // THE PURGE: no remote source-of-record — the lane reports the local hash
  // and no head, so every consumer (fs.r2Diff, the History tab) sees a
  // clean "nothing remote" state instead of an error.
  const slug = slugOfDir(dir);
  if (!slug) return { slug: null, localHash: null, head: null, drifted: false, history: [] };
  const { hash: localHash } = localTreeHash(dir);
  return { slug, localHash, head: null, drifted: false, history: [] };
}

export async function r2DiffWorkdir(dir: string): Promise<{ status: R2SourceStatus; text: string; error?: string }> {
  // THE PURGE: no remote head to diff against — the lane answers empty.
  const status = await r2SourceStatus(dir);
  return { status, text: "" };
}
