/**
 * library-sync.ts — THE DESKTOP'S SYNC SERVICE for the member library (his
 * rule, 2026-10-04: database-as-truth; both surfaces write to the server;
 * each syncs its own file system from it, per item, latest wins, tombstones).
 *
 * When it runs:
 *   · on sign-in (auth.ts, with the attach socket), every kind;
 *   · after every local save or delete (library-events.ts), that kind,
 *     debounced 1.5s — a save pushes at once, a delete pushes the remove;
 *   · every 5 minutes, every kind — what the web wrote lands here.
 *
 * What it tells the renderer: `glyphh:library-synced` with the kinds that
 * changed locally (a pull or a remote delete), so the open page re-reads its
 * list; a pulled tab also fires `panel-apps-changed` (the wall listens to it).
 * A pulled schedule is armed by its adapter as it lands (schedule-store.ts),
 * so one made on the web fires here within a sync interval; a pulled drip
 * is in the `.drip` command's cache at once (drip-manager.ts).
 *
 * Errors are logged, never thrown at the UI. Signed out, or the server
 * unreachable, a pass is skipped — the next trigger tries again.
 */

import { ConnectError, AuthError } from "@glyphh/sdk";
import { isAuthenticated } from "./auth.js";
import { getClient } from "./glyphh-client.js";
import { broadcast } from "./broadcast.js";
import { onLibraryChange, dropTombstone, tombstonesOf, type MemberLibraryKind } from "./library-events.js";
import { allAdapters, readSyncState, updateSyncState } from "./library-adapters.js";
import { syncKind, type KindAdapter, type SyncReport } from "./library-sync-core.js";

export const LIBRARY_SYNCED_EVENT = "glyphh:library-synced";
const DEBOUNCE_MS = 1500;
const PERIOD_MS = 5 * 60_000;

let started = false;
let timer: NodeJS.Timeout | null = null;
let unsubscribe: (() => void) | null = null;
const debounces = new Map<MemberLibraryKind, NodeJS.Timeout>();
const inFlight = new Map<MemberLibraryKind, Promise<SyncReport | null>>();
let offlineWarned = false;

const adapters = new Map<MemberLibraryKind, KindAdapter>();
function adapterFor(kind: MemberLibraryKind): KindAdapter {
  if (!adapters.size) for (const a of allAdapters()) adapters.set(a.kind, a);
  return adapters.get(kind)!;
}

/** The tombstone list the loop reads — library-events' file, per kind. */
const tombstones = { list: tombstonesOf, drop: dropTombstone };

/** Sync ONE kind now. Resolves the report, or null when skipped (signed out,
 *  offline, already running). Never throws. */
export function syncLibraryKind(kind: MemberLibraryKind): Promise<SyncReport | null> {
  const running = inFlight.get(kind);
  if (running) return running;
  const p = (async (): Promise<SyncReport | null> => {
    if (!isAuthenticated()) return null;
    try {
      const report = await syncKind({
        api: getClient().memberLibrary,
        adapter: adapterFor(kind),
        tombstones,
        lastSyncAt: readSyncState().lastSyncAt[kind] ?? null,
        fetchImpl: (url, init) => fetch(url, init as RequestInit),
        log: (msg) => console.warn(`[library-sync] ${msg}`),
      });
      updateSyncState((s) => { s.lastSyncAt[kind] = report.startedAt; });
      offlineWarned = false;
      const moved = report.pulled.length + report.deletedLocal.length + report.taken.length;
      if (moved) {
        broadcast(LIBRARY_SYNCED_EVENT, { kind, pulled: report.pulled, deleted: report.deletedLocal, taken: report.taken });
        if (kind === "tab") broadcast("panel-apps-changed");
      }
      if (moved || report.pushed.length || report.deletedRemote.length) {
        console.warn("[library-sync]", JSON.stringify({ kind, pushed: report.pushed.length, pulled: report.pulled.length, taken: report.taken.length, deletedLocal: report.deletedLocal.length, deletedRemote: report.deletedRemote.length }));
      }
      return report;
    } catch (err) {
      const code = String((err as { code?: unknown } | null)?.code ?? "");
      const offline = err instanceof ConnectError || code === "E_CONNECT";
      const unauthed = err instanceof AuthError || (err as { httpStatus?: number } | null)?.httpStatus === 401;
      if (offline || unauthed) {
        if (!offlineWarned) { offlineWarned = true; console.warn(`[library-sync] skipped (${unauthed ? "not signed in" : "server unreachable"}): ${err instanceof Error ? err.message : String(err)}`); }
      } else {
        console.warn(`[library-sync] ${kind} pass failed:`, err instanceof Error ? err.message : err);
      }
      return null;
    } finally {
      inFlight.delete(kind);
    }
  })();
  inFlight.set(kind, p);
  return p;
}

/** Sync every kind now (sign-in, the 5-minute clock, a manual refresh). */
export async function syncLibraryAll(): Promise<void> {
  for (const a of allAdapters()) await syncLibraryKind(a.kind);
}

function scheduleKind(kind: MemberLibraryKind): void {
  const prior = debounces.get(kind);
  if (prior) clearTimeout(prior);
  debounces.set(kind, setTimeout(() => { debounces.delete(kind); void syncLibraryKind(kind); }, DEBOUNCE_MS));
}

/** Start the service (idempotent): the sign-in pass, the change listener, the clock. */
export function startLibrarySync(): void {
  if (started) { void syncLibraryAll(); return; }
  started = true;
  unsubscribe = onLibraryChange((change) => scheduleKind(change.kind));
  timer = setInterval(() => { void syncLibraryAll(); }, PERIOD_MS);
  void syncLibraryAll();
}

/** Stop the service (sign-out, user switch). Pending debounces are dropped —
 *  the local tombstones and clocks make the next sign-in's pass complete. */
export function stopLibrarySync(): void {
  if (!started) return;
  started = false;
  unsubscribe?.();
  unsubscribe = null;
  if (timer) { clearInterval(timer); timer = null; }
  for (const t of debounces.values()) clearTimeout(t);
  debounces.clear();
  adapters.clear();
}
