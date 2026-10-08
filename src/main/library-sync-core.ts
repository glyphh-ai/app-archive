/**
 * library-sync-core.ts — THE SYNC LOOP of the member library, one kind at a
 * time (his rule, 2026-10-04: database-as-truth; both surfaces write to the
 * server; each syncs its own file system from it, per item, latest wins,
 * tombstones).
 *
 *   local rows (the adapter's list + this machine's tombstones)
 *     × remote rows (the server's live list + its changed-since page, which is
 *       where the TOMBSTONES are)
 *     → the SDK's `reconcile` → four moves:
 *
 *   pushes        PUT the row (folder kinds: then upload the changed files to
 *                 the presigned URLs). `applied:false` means the server's copy
 *                 is newer — it is taken, not fought.
 *   pulls         take the server's row into the local store (folder kinds:
 *                 read the item for its manifest, download the files).
 *   deletesLocal  the server tombstoned it — the local record goes.
 *   deletesRemote DELETE with the tombstone's clock. 409 `stale` = the server's
 *                 row is NEWER than the delete: it is pulled back, never
 *                 reported as a failure. 404 = the server never knew it. Either
 *                 way the local tombstone retires.
 *
 * Nothing here knows Electron: the client, the adapters, the tombstone list,
 * the state file and `fetch` are injected, so the loop runs under a test with
 * a fake SDK and a temp folder.
 */

import { readFileSync } from "fs";
import { reconcile, ApiError, type MemberLibraryFile, type MemberLibraryItem, type MemberLibraryRow } from "@glyphh/sdk";
import { normalizeRemoteRow, type MemberLibraryKind } from "../shared/member-library.js";

export type { MemberLibraryKind };

/** The slice of `client.memberLibrary` the loop uses — the SDK's MemberLibraryClient satisfies it. */
export interface LibraryApi {
  list<T = unknown>(kind: MemberLibraryKind, opts?: { since?: number }): Promise<MemberLibraryRow<T>[]>;
  get<T = unknown>(kind: MemberLibraryKind, id: string): Promise<MemberLibraryItem<T>>;
  put<T = unknown>(kind: MemberLibraryKind, id: string, input: { data: T; files?: MemberLibraryFile[]; updatedAt: number }): Promise<{ applied: boolean; item: MemberLibraryItem<T> }>;
  remove(kind: MemberLibraryKind, id: string, input?: { updatedAt?: number }): Promise<void>;
  files(kind: MemberLibraryKind, id: string, paths: string[]): Promise<{ put: Record<string, string>; get: Record<string, string> }>;
}

/** A file of a folder kind as the adapter lists it: the manifest entry plus where it is. */
export interface LocalFile extends MemberLibraryFile { abs: string }

/** One local record as the adapter projects it for the loop. */
export interface LocalItem {
  id: string;
  /** Epoch ms — this client's clock for this state of the record. */
  updatedAt: number;
  data: unknown;
  /** Folder kinds only: the folder's manifest. */
  files?: LocalFile[];
}

/** A downloaded file, ready for the adapter to write. `bytes: null` means the
 *  local copy already has these bytes (same sha256) — keep it, stamp its mtime. */
export interface PulledFile { path: string; bytes: Uint8Array | null; mtime: number }

export interface KindAdapter {
  kind: MemberLibraryKind;
  /** Folder kinds carry files (skills, tasks). */
  hasFiles: boolean;
  list(): LocalItem[];
  /** Take the server's item (folder kinds: with its files downloaded). */
  apply(item: MemberLibraryItem, files?: PulledFile[]): void;
  /** The server tombstoned it: the local record goes, quietly. */
  remove(id: string): void;
  /** The record now matches the server at this clock (folder kinds record it
   *  so the folder's clock is stable until something moves). */
  noteSynced?(id: string, updatedAt: number, files?: MemberLibraryFile[]): void;
  /** The files last synced for this id (folder kinds) — what the SERVER has, so an upload diffs against it. */
  lastSyncedFiles?(id: string): MemberLibraryFile[] | null;
  /** The files on disk NOW for this id (folder kinds) — what a download diffs against. */
  localFiles?(id: string): MemberLibraryFile[] | null;
}

export interface Tombstone { id: string; updatedAt: number }

export interface SyncContext {
  api: LibraryApi;
  adapter: KindAdapter;
  tombstones: { list(kind: MemberLibraryKind): Tombstone[]; drop(kind: MemberLibraryKind, id: string): void };
  /** When this kind last synced (epoch ms) — the `since` cursor for the tombstone page. */
  lastSyncAt: number | null;
  fetchImpl: (url: string, init?: { method?: string; body?: Uint8Array }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  log?: (msg: string) => void;
}

export interface SyncReport {
  kind: MemberLibraryKind;
  pushed: string[];
  pulled: string[];
  deletedLocal: string[];
  deletedRemote: string[];
  /** Rows whose push the server refused as stale — taken from the server instead. */
  taken: string[];
  startedAt: number;
}

/** Files larger than this never ride (a skill's screenshot is fine; a model file is not). */
export const MAX_SYNC_FILE_BYTES = 5 * 1024 * 1024;
/** The `since` page is asked a minute behind the last sync: clocks between machines drift. */
const SINCE_SLACK_MS = 60_000;

/** The server's verdicts, read off the error's fields (never `instanceof`: a
 *  bundled test and the app load the SDK as different module instances). */
const status = (err: unknown): number => (err instanceof ApiError ? err.httpStatus : Number((err as { httpStatus?: unknown } | null)?.httpStatus)) || 0;
const code = (err: unknown): string => String((err as { code?: unknown } | null)?.code ?? "");
const isStale = (err: unknown): boolean => status(err) === 409 || /stale/i.test(code(err));
const isNotFound = (err: unknown): boolean => status(err) === 404;

/** A local row's shape for the SDK's reconcile — live rows carry their data and files. */
interface LocalLww extends LocalItem { deletedAt: string | null }
interface RemoteLww { id: string; updatedAt: number; deletedAt: string | null; data?: unknown }

export async function syncKind(ctx: SyncContext): Promise<SyncReport> {
  const { api, adapter, tombstones } = ctx;
  const kind = adapter.kind;
  const log = ctx.log ?? (() => undefined);
  const startedAt = Date.now();
  const report: SyncReport = { kind, pushed: [], pulled: [], deletedLocal: [], deletedRemote: [], taken: [], startedAt };

  // ── Both sides ──────────────────────────────────────────────────────────
  const local: LocalLww[] = adapter.list().map((i) => ({ ...i, deletedAt: null }));
  for (const t of tombstones.list(kind)) local.push({ id: t.id, updatedAt: t.updatedAt, deletedAt: new Date(t.updatedAt).toISOString(), data: null });

  const [live, changed] = await Promise.all([
    api.list(kind),
    ctx.lastSyncAt ? api.list(kind, { since: Math.max(0, ctx.lastSyncAt - SINCE_SLACK_MS) }) : Promise.resolve([] as MemberLibraryRow[]),
  ]);
  // The since page's tombstones carry `deletedAt` as a number; the SDK's
  // reconcile wants an ISO string or null — normalizeRemoteRow is that.
  const remote: RemoteLww[] = [...live, ...changed].map((r) => normalizeRemoteRow(r as { id: string; updatedAt: number; deletedAt?: string | number | null; data?: unknown }));

  const moves = reconcile<LocalLww | RemoteLww>(local, remote);

  // ── pushes ──────────────────────────────────────────────────────────────
  for (const row of moves.pushes as LocalLww[]) {
    try {
      const manifest = row.files?.map(stripAbs);
      const res = await api.put(kind, row.id, { data: row.data, ...(manifest ? { files: manifest } : {}), updatedAt: row.updatedAt });
      if (res.applied) {
        if (adapter.hasFiles && row.files) await uploadChanged(ctx, row.id, row.files);
        adapter.noteSynced?.(row.id, row.updatedAt, manifest);
        report.pushed.push(row.id);
      } else {
        // The server's copy is strictly newer (or a tombstone the clock did
        // not beat): take what it holds rather than fight it.
        await takeRemote(ctx, res.item);
        report.taken.push(row.id);
      }
    } catch (err) {
      log(`push ${kind}/${row.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── pulls ───────────────────────────────────────────────────────────────
  for (const row of moves.pulls as RemoteLww[]) {
    try {
      if (adapter.hasFiles || row.data === undefined) await takeRemote(ctx, await api.get(kind, row.id));
      else await takeRemote(ctx, { kind, id: row.id, updatedAt: row.updatedAt, deletedAt: null, data: row.data, files: [], createdAt: "" });
      // A local tombstone older than the server's live row lost (reconcile
      // routed it here, not to deletesRemote): it retires with the pull.
      tombstones.drop(kind, row.id);
      report.pulled.push(row.id);
    } catch (err) {
      log(`pull ${kind}/${row.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── deletesLocal ────────────────────────────────────────────────────────
  for (const id of moves.deletesLocal) {
    try { adapter.remove(id); tombstones.drop(kind, id); report.deletedLocal.push(id); }
    catch (err) { log(`remove ${kind}/${id} failed: ${err instanceof Error ? err.message : String(err)}`); }
  }

  // ── deletesRemote ───────────────────────────────────────────────────────
  for (const id of moves.deletesRemote) {
    const at = local.find((r) => r.id === id && r.deletedAt !== null)?.updatedAt;
    try {
      await api.remove(kind, id, at ? { updatedAt: at } : {});
      tombstones.drop(kind, id);
      report.deletedRemote.push(id);
    } catch (err) {
      if (isStale(err)) {
        // 409: the server's row is NEWER than this delete — it wins. Pull it
        // back; the tombstone retires (it lost).
        try {
          await takeRemote(ctx, await api.get(kind, id));
          tombstones.drop(kind, id);
          report.pulled.push(id);
        } catch (e2) { log(`stale delete ${kind}/${id}: pull back failed: ${e2 instanceof Error ? e2.message : String(e2)}`); }
      } else if (isNotFound(err)) {
        tombstones.drop(kind, id); // never knew it, or already a tombstone
      } else {
        log(`delete ${kind}/${id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return report;
}

const stripAbs = (f: LocalFile): MemberLibraryFile => ({ path: f.path, size: f.size, mtime: f.mtime, sha256: f.sha256 });

/** The server's item lands locally: folder kinds download the files first. */
async function takeRemote(ctx: SyncContext, item: MemberLibraryItem): Promise<void> {
  const { adapter } = ctx;
  if (!adapter.hasFiles) { adapter.apply(item); adapter.noteSynced?.(item.id, item.updatedAt); return; }
  const files = await downloadAll(ctx, item);
  adapter.apply(item, files);
  adapter.noteSynced?.(item.id, item.updatedAt, item.files ?? []);
}

async function downloadAll(ctx: SyncContext, item: MemberLibraryItem): Promise<PulledFile[]> {
  const manifest = (item.files ?? []).filter((f) => f.size <= MAX_SYNC_FILE_BYTES);
  if (!manifest.length) return [];
  // Only the files whose bytes this machine does not already hold ride.
  const had = new Map((ctx.adapter.localFiles?.(item.id) ?? []).map((f) => [f.path, f.sha256]));
  const want = manifest.filter((f) => had.get(f.path) !== f.sha256);
  const keep = manifest.filter((f) => had.get(f.path) === f.sha256);
  const out: PulledFile[] = [];
  if (want.length) {
    const urls = await ctx.api.files(item.kind, item.id, want.map((f) => f.path));
    for (const f of want) {
      const url = urls.get[f.path];
      if (!url) throw new Error(`no download url for ${f.path}`);
      const res = await ctx.fetchImpl(url);
      if (!res.ok) throw new Error(`download ${f.path}: HTTP ${res.status}`);
      out.push({ path: f.path, bytes: new Uint8Array(await res.arrayBuffer()), mtime: f.mtime });
    }
  }
  // Unchanged files are reported with no bytes: the adapter keeps what it has.
  for (const f of keep) out.push({ path: f.path, bytes: null, mtime: f.mtime });
  return out;
}

/** After an applied PUT: upload the files whose bytes the server does not have yet. */
async function uploadChanged(ctx: SyncContext, id: string, files: LocalFile[]): Promise<void> {
  const had = new Map((ctx.adapter.lastSyncedFiles?.(id) ?? []).map((f) => [f.path, f.sha256]));
  const changed = files.filter((f) => f.size <= MAX_SYNC_FILE_BYTES && had.get(f.path) !== f.sha256);
  if (!changed.length) return;
  const urls = await ctx.api.files(ctx.adapter.kind, id, changed.map((f) => f.path));
  for (const f of changed) {
    const url = urls.put[f.path];
    if (!url) throw new Error(`no upload url for ${f.path}`);
    // THE SIGNED CONTENT TYPE RIDES THE PUT (his report, 2026-10-08: "schedules
    // configured for tasks never fire" — the worker found no files behind the
    // task's manifest). The server presigns every upload with
    // application/octet-stream in the signature, so a PUT without that header
    // is SignatureDoesNotMatch (403): the row landed, the files never did, and
    // every task and skill file pushed from the desktop has been missing in R2.
    const res = await ctx.fetchImpl(url, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(readFileSync(f.abs)) });
    if (!res.ok) throw new Error(`upload ${f.path}: HTTP ${res.status}`);
  }
}
