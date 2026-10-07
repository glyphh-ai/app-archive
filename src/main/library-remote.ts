/**
 * library-remote.ts — THE SERVER IS THE ONLY TRUTH for tabs, workspaces and
 * agents (his order, 2026-10-07: "why would we replicate down to the local
 * machine?" — Claude's desktop keeps nothing but a session; only a CLI keeps
 * files). The desktop reads these kinds straight from the member library,
 * writes them straight back, and keeps a RUNNING COPY in memory for the
 * synchronous readers it has always had. Nothing of them touches the disk.
 * The skill and task folders stay on disk for the CLIs that read files
 * (library-adapters.ts), written one way, never read back as truth.
 */
import { getClient } from "./glyphh-client.js";
import type { MemberLibraryKind } from "../shared/member-library.js";

// The SDK's own kind union lags the shared one (his stale sdk/dist); the
// wire accepts any kind the server knows, so the handle is typed here.
interface LibraryRow<T> { id: string; updatedAt: number; deletedAt: string | number | null; data?: T }
interface LibraryHandle {
  list<T>(kind: string): Promise<LibraryRow<T>[]>;
  put<T>(kind: string, id: string, input: { data: T; updatedAt: number }): Promise<{ applied: boolean }>;
  remove(kind: string, id: string, input?: { updatedAt?: number }): Promise<void>;
}
const lib = (): LibraryHandle => getClient().memberLibrary as unknown as LibraryHandle;

/** A row the server holds, live. */
export interface RemoteRecord<T> { id: string; updatedAt: number; data: T }

// THE CLOCK: this client's Date.now(), strictly increasing across its writes —
// a save and a delete in the same millisecond must not collide on the
// server's strictly-newer rule (the web's member-library-web.js does the same).
let lastClock = 0;
export function nextClock(now: () => number = Date.now): number {
  lastClock = Math.max(now(), lastClock + 1);
  return lastClock;
}

export async function remoteList<T>(kind: MemberLibraryKind): Promise<RemoteRecord<T>[]> {
  const rows = await lib().list<T>(kind);
  return rows
    .filter((r) => !r.deletedAt && r.data !== undefined && r.data !== null)
    .map((r) => ({ id: r.id, updatedAt: r.updatedAt, data: r.data as T }));
}

/** Write a record; false when the server held a strictly newer copy. */
export async function remotePut<T>(kind: MemberLibraryKind, id: string, data: T): Promise<boolean> {
  const res = await lib().put<T>(kind, id, { data, updatedAt: nextClock() });
  return !!res.applied;
}

/** Tombstone a record; a record the server never had is already gone. */
export async function remoteRemove(kind: MemberLibraryKind, id: string): Promise<void> {
  try { await lib().remove(kind, id, { updatedAt: nextClock() }); }
  catch (err) {
    const status = (err as { status?: number })?.status;
    if (status !== 404) throw err;
  }
}

// ── Priming + refresh ────────────────────────────────────────────────────────
// The running copies load at sign-in and refresh every minute (another
// surface may have written) — late-bound so the stores stay importable.
const REFRESH_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

export async function primeRemoteStores(): Promise<void> {
  const [apps, layouts, agents] = await Promise.all([
    import("./apps-store.js"), import("./layout-manager.js"), import("./local-agents.js"),
  ]);
  await Promise.all([
    apps.primeTabs().catch((e) => console.warn("[library-remote] tabs:", String(e))),
    layouts.getLayoutManager().refreshAndList().catch((e) => console.warn("[library-remote] workspaces:", String(e))),
    agents.primeAgents().catch((e) => console.warn("[library-remote] agents:", String(e))),
  ]);
}

export function startRemoteRefresh(): void {
  if (timer) return;
  timer = setInterval(() => { void primeRemoteStores(); }, REFRESH_MS);
  void primeRemoteStores();
}

export function stopRemoteRefresh(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
