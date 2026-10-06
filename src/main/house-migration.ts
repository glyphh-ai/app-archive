/**
 * house-migration.ts — THE MAC'S HOUSE FILES GO UP, ONCE (his order,
 * 2026-10-06: "migrate the data, delete the local apps, delete everything
 * local. Cloud is first and every surface pulls from it").
 *
 * On the first sign-in after the cut (auth.ts attachStart) this reads what
 * the six house apps kept in the user's home —
 *   office/design/<stem>.json + office/design/assets/<stem>/<assetId>   designs
 *   office/slides/<stem>.html, gpoints/<stem>.html (pre-Office builds)    decks
 *   app-data/images|video|audio/files/<name>                              media
 *   office/drive.json                                                     folders + which folder each file was in
 * — asks the server which ids it already holds, plans the difference
 * (house-migration-plan.ts: idempotent, ids = the file names the Mac used)
 * and puts each item into the member library through the store's import
 * doors (shared/house-store.ts). An item's local file goes only AFTER its
 * put succeeded; a folder on disk goes only when nothing in it is left.
 *
 * ONCE PER USER: a marker in the user's home records the run with its
 * counts. A run that cannot reach the server (offline, a dead token, a 5xx)
 * leaves no marker, so the next sign-in tries again; an item the server
 * refuses for good (too large for the file lane, a bad name) is logged and
 * left where it was, named in the marker, never retried.
 */

import fs from "fs";
import path from "path";
import { ConnectError } from "@glyphh/sdk";
import { isAuthenticated } from "./auth.js";
import { userScopedPath } from "./app-paths.js";
import { houseStore } from "./house-store.js";
import { houseMigrationPlan, type ServerRow } from "./house-migration-plan.js";
import { deckFileName } from "../shared/deck-document.js";
import { designFileName, libraryIdOf, mediaKindOfMime, mediaMimeOf, APP_OF_MEDIA, MEDIA_KINDS, type DesignDocLike, type HouseKind, type MediaKind } from "../shared/house-store.js";

export const HOUSE_MIGRATION_MARKER = "house-migrated.json";

type LocalItem =
  | { kind: "folder"; id: string; name: string; parentId: string | null }
  | { kind: "design"; id: string; abs: string; document: DesignDocLike; folderId: string | null; assets: Array<{ id: string; contentType: string; abs: string }>; assetsDir: string }
  | { kind: "deck"; id: string; abs: string; folderId: string | null }
  | { kind: MediaKind; id: string; abs: string; mime: string; folderId: string | null };

interface DriveState { folders?: Array<{ id?: unknown; name?: unknown; parentId?: unknown }>; pointers?: Record<string, unknown> }

const OFFICE = (): string => userScopedPath("office");
/** The media apps kept their files where every app's data lived: app-data/<slug>/files. */
const mediaDir = (kind: MediaKind): string => userScopedPath("app-data", APP_OF_MEDIA[kind], "files");
const LEGACY_DECKS = (): string[] => [userScopedPath("gpoints")];

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")) as T; } catch { return null; }
}
function listFiles(dir: string, ext?: string): string[] {
  try { return fs.readdirSync(dir).filter((n) => !n.startsWith(".") && (!ext || n.toLowerCase().endsWith(ext)) && fs.statSync(path.join(dir, n)).isFile()).sort(); }
  catch { return []; }
}

/** Everything the Mac holds for the six apps, as the plan reads it. */
export function readLocalHouse(): LocalItem[] {
  const drive = readJson<DriveState>(path.join(OFFICE(), "drive.json")) ?? {};
  const pointers = drive.pointers && typeof drive.pointers === "object" ? drive.pointers : {};
  const folderOf = (key: string): string | null => (typeof pointers[key] === "string" ? (pointers[key] as string) : null);
  const out: LocalItem[] = [];
  for (const f of Array.isArray(drive.folders) ? drive.folders : []) {
    if (typeof f.id === "string" && typeof f.name === "string" && f.name.trim()) out.push({ kind: "folder", id: f.id, name: f.name.trim(), parentId: typeof f.parentId === "string" ? f.parentId : null });
  }
  const designDir = path.join(OFFICE(), "design");
  for (const file of listFiles(designDir, ".json")) {
    const document = readJson<DesignDocLike>(path.join(designDir, file));
    if (!document || typeof document !== "object") continue;
    const stem = file.replace(/\.json$/i, "");
    const assetsDir = path.join(designDir, "assets", stem);
    const assets = (document.assets ?? []).filter((a) => a && typeof a.id === "string" && fs.existsSync(path.join(assetsDir, a.id)))
      .map((a) => ({ id: a.id, contentType: a.contentType || "application/octet-stream", abs: path.join(assetsDir, a.id) }));
    out.push({ kind: "design", id: designFileName(file), abs: path.join(designDir, file), document, folderId: folderOf(`design:${file}`), assets, assetsDir });
  }
  for (const dir of [path.join(OFFICE(), "slides"), ...LEGACY_DECKS()]) {
    for (const file of listFiles(dir, ".html")) out.push({ kind: "deck", id: deckFileName(file), abs: path.join(dir, file), folderId: folderOf(`slides:${file}`) });
  }
  for (const kind of MEDIA_KINDS) {
    for (const name of listFiles(mediaDir(kind))) {
      const mime = mediaMimeOf(name);
      if (mediaKindOfMime(mime) !== kind) continue;
      out.push({ kind, id: libraryIdOf(name), abs: path.join(mediaDir(kind), name), mime, folderId: folderOf(`${kind}:${kind}/${name}`) });
    }
  }
  return out;
}

const isTransient = (err: unknown): boolean =>
  err instanceof ConnectError || /E_CONNECT|ECONN|ENOTFOUND|ETIMEDOUT|fetch failed|network|HTTP 5\d\d|timed out/i.test(err instanceof Error ? err.message : String(err));

async function pushOne(item: LocalItem): Promise<void> {
  const store = houseStore();
  switch (item.kind) {
    case "folder": return store.imports.folder(item.id, item.name, item.parentId);
    case "design": return store.imports.design(item.id, item.document, item.folderId, item.assets.map((a) => ({ id: a.id, contentType: a.contentType, bytes: new Uint8Array(fs.readFileSync(a.abs)) })));
    case "deck": return store.imports.deck(item.id, fs.readFileSync(item.abs, "utf-8"), item.folderId);
    default: return store.imports.media(item.kind, item.id, new Uint8Array(fs.readFileSync(item.abs)), item.mime, item.folderId);
  }
}

/** The pushed item's bytes leave this disk — the record is the cloud's now. */
function dropLocal(item: LocalItem): void {
  if (item.kind === "folder") return;
  fs.rmSync(item.abs, { force: true });
  if (item.kind === "design") fs.rmSync(item.assetsDir, { recursive: true, force: true });
}

/** The folders themselves, once nothing is left in them. */
function dropFolders(): void {
  const dirs = [path.join(OFFICE(), "design"), path.join(OFFICE(), "slides"), ...LEGACY_DECKS(), ...LEGACY_DECKS().map((d) => `${d}.migrated`), ...MEDIA_KINDS.map(mediaDir)];
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

export interface HouseMigrationReport { pushed: Partial<Record<HouseKind, number>>; left: string[]; transient: string[] }

export async function runHouseMigration(): Promise<HouseMigrationReport | null> {
  const marker = userScopedPath(HOUSE_MIGRATION_MARKER);
  if (fs.existsSync(marker) || !isAuthenticated()) return null;
  const local = readLocalHouse();
  const store = houseStore();
  let server: ServerRow[];
  try {
    const kinds: HouseKind[] = ["folder", "design", "deck", "image", "video", "audio"];
    server = (await Promise.all(kinds.map(async (kind) => (await store.rows(kind)).map((r): ServerRow => ({ kind, ...r }))))).flat();
  } catch (err) {
    console.warn("[house-migration] skipped (server unreachable):", err instanceof Error ? err.message : err);
    return null;
  }
  const plan = houseMigrationPlan(local, server);
  const report: HouseMigrationReport = { pushed: {}, left: [], transient: [] };
  for (const item of plan) {
    try {
      await pushOne(item);
      dropLocal(item);
      report.pushed[item.kind] = (report.pushed[item.kind] ?? 0) + 1;
    } catch (err) {
      const line = `${item.kind}/${item.id}: ${err instanceof Error ? err.message : String(err)}`;
      (isTransient(err) ? report.transient : report.left).push(line);
    }
  }
  console.warn("[house-migration]", JSON.stringify({ planned: plan.length, pushed: report.pushed, left: report.left, transient: report.transient }));
  if (report.transient.length) return report; // no marker: the next sign-in tries the rest again
  if (!report.left.length) dropFolders();
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ at: new Date().toISOString(), pushed: report.pushed, left: report.left }, null, 2), "utf-8");
  return report;
}
