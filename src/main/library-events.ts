/**
 * library-events.ts — WHAT THE STORES TELL THE SYNC (his rule, 2026-10-04: the
 * member library is database-as-truth; every local save pushes, every local
 * delete tombstones and pushes the remove).
 *
 * The stores (layout-manager, apps-store, skills-fs, local-agents,
 * task-runner) say "this item changed" / "this item is gone" here and nothing
 * else; library-sync.ts listens and does the server round. Keeping the bus
 * apart from the sync keeps the stores importable on their own (tests, the
 * attach handlers) and breaks the import cycle a direct call would make.
 *
 * Tombstones live in `<user>/library-tombstones.json` as `"<kind>:<id>": ms`
 * — the clock of the delete, the writer's `Date.now()` — and go once the
 * server holds the tombstone (or answers that it never knew the id).
 */

import fs from "fs";
import path from "path";
import { userScopedPath } from "./app-paths.js";
import type { MemberLibraryKind } from "../shared/member-library.js";

export type { MemberLibraryKind };

export interface LibraryChange { kind: MemberLibraryKind; id: string; deleted: boolean }

const listeners = new Set<(change: LibraryChange) => void>();

/** Subscribe to local library changes (library-sync.ts). */
export function onLibraryChange(fn: (change: LibraryChange) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function announce(change: LibraryChange): void {
  for (const fn of listeners) {
    try { fn(change); } catch (err) { console.warn("[library] change listener failed:", err instanceof Error ? err.message : err); }
  }
}

/** A local save landed: the sync pushes it (debounced). */
export function noteLibrarySave(kind: MemberLibraryKind, id: string): void {
  announce({ kind, id, deleted: false });
}

/** A local delete landed: the tombstone is written first (so a crash between
 *  the delete and the push still removes it on the server next time), then
 *  the sync pushes the remove. */
export function noteLibraryDelete(kind: MemberLibraryKind, id: string, at: number = Date.now()): void {
  addTombstone(kind, id, at);
  announce({ kind, id, deleted: true });
}

// ── Tombstones ───────────────────────────────────────────────────────────────

export const TOMBSTONES_FILE = (): string => userScopedPath("library-tombstones.json");

export type Tombstones = Record<string, number>;

export const tombstoneKey = (kind: MemberLibraryKind, id: string): string => `${kind}:${id}`;

export function readTombstones(): Tombstones {
  try {
    const raw = JSON.parse(fs.readFileSync(TOMBSTONES_FILE(), "utf-8")) as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: Tombstones = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(v);
      if (k.includes(":") && Number.isFinite(n) && n > 0) out[k] = n;
    }
    return out;
  } catch { return {}; }
}

function writeTombstones(t: Tombstones): void {
  try {
    const file = TOMBSTONES_FILE();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(t, null, 2), "utf-8");
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    console.warn("[library] tombstones not written:", err instanceof Error ? err.message : err);
  }
}

export function addTombstone(kind: MemberLibraryKind, id: string, at: number): void {
  const t = readTombstones();
  t[tombstoneKey(kind, id)] = at;
  writeTombstones(t);
}

/** The server holds the tombstone (or never knew the id): forget it here. */
export function dropTombstone(kind: MemberLibraryKind, id: string): void {
  const t = readTombstones();
  if (!(tombstoneKey(kind, id) in t)) return;
  delete t[tombstoneKey(kind, id)];
  writeTombstones(t);
}

/** The tombstones of one kind as `{ id, updatedAt }` pairs. */
export function tombstonesOf(kind: MemberLibraryKind): Array<{ id: string; updatedAt: number }> {
  const prefix = `${kind}:`;
  return Object.entries(readTombstones())
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, at]) => ({ id: k.slice(prefix.length), updatedAt: at }));
}
