/**
 * house-migration-plan.ts — WHAT THE MAC STILL HOLDS GOES UP, ONCE: the pure
 * rule behind house-migration.ts (his order, 2026-10-06: "migrate the data,
 * delete the local apps, delete everything local").
 *
 * A local item is put when the server has NO row under its id — live or
 * tombstoned: a record the member already made in the cloud is theirs, and
 * one they deleted there stays deleted (a put would revive the tombstone).
 * Ids are the file names the Mac used, so a second run finds its own puts
 * on the server and plans nothing. Folders go first; a record filed in a
 * folder the cloud will not have (not planned, not live there) lands at the
 * root rather than pointing at nothing; a folder's parent the same.
 */

import type { HouseKind } from "../shared/house-store.js";

export interface PlannedItem { kind: HouseKind; id: string; folderId?: string | null; parentId?: string | null }
export interface ServerRow { kind: HouseKind; id: string; deleted: boolean }

const KIND_ORDER: readonly HouseKind[] = ["folder", "design", "deck", "image", "video", "audio", "file"];
const key = (kind: string, id: string): string => `${kind}:${id}`;

export function houseMigrationPlan<T extends PlannedItem>(local: readonly T[], server: readonly ServerRow[]): T[] {
  const known = new Set(server.map((r) => key(r.kind, r.id)));
  const liveFolders = new Set(server.filter((r) => r.kind === "folder" && !r.deleted).map((r) => r.id));
  const seen = new Set<string>();
  const puts: T[] = [];
  for (const kind of KIND_ORDER) {
    for (const item of local) {
      if (item.kind !== kind) continue;
      const k = key(item.kind, item.id);
      if (seen.has(k) || known.has(k)) continue;
      seen.add(k);
      puts.push(item);
    }
  }
  const plannedFolders = new Set(puts.filter((p) => p.kind === "folder").map((p) => p.id));
  const folderOk = (id: string | null | undefined): boolean => !!id && (plannedFolders.has(id) || liveFolders.has(id));
  return puts.map((p) => ({
    ...p,
    ...(p.folderId === undefined ? {} : { folderId: folderOk(p.folderId) ? p.folderId : null }),
    ...(p.parentId === undefined ? {} : { parentId: folderOk(p.parentId) ? p.parentId : null }),
  }));
}
