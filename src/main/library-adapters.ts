/**
 * library-adapters.ts — THE LOCAL SIDE of each member-library kind: how the
 * desktop's own files project to `{ id, updatedAt, data[, files] }` rows for
 * the sync loop (library-sync-core.ts), and how a server row lands back in
 * them.
 *
 *   workspace  ~/.glyphh/<user>/workspaces/<id>/workspace.json   layout-manager.ts
 *   tab        ~/.glyphh/<user>/apps/<slug>/tab.json              apps-store.ts
 *   agent      ~/.glyphh/<user>/agents/<slug>.json                local-agents.ts
 *   skill      ~/.glyphh/<user>/skills/<name>/                    skills-fs.ts (+ skills-disabled/glyphh/)
 *   task       ~/.glyphh/<user>/tasks/<slug>/                     skills-fs.ts (+ skills-disabled/task/)
 *   drip       user-state.sqlite  drips                           drip-manager.ts
 *   schedule   user-state.sqlite  loop_schedules                  schedule-store.ts (writers: local-library.ts, local-agents.ts)
 *
 * The folder kinds keep a clock sidecar in `<user>/library-sync-state.json`:
 * once a folder matches the server (pushed or pulled) its record's clock is
 * written beside the manifest's signature, so the folder's clock holds until
 * a file, or its enabled flag, actually moves — then the newest mtime (or the
 * flip's moment) is the new clock. The same file keeps each kind's last sync
 * time (the `since` cursor for the server's tombstone page).
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import type { MemberLibraryFile, MemberLibraryItem } from "@glyphh/sdk";
import { userScopedPath } from "./app-paths.js";
import { getLayoutManager, WORKSPACES_DIR, type GridLayout } from "./layout-manager.js";
import * as appsStore from "./apps-store.js";
import { invalidateOrgApps } from "./org-apps.js";
import { listAgents, applyRemoteAgent, removeAgentLocal, type AgentRow } from "./local-agents.js";
import { applyRemoteBundle, listSyncableBundles, removeBundleLocal, walk } from "./skills-fs.js";
import { applyRemoteDrip, listDripRecords, removeDripLocal } from "./drip-manager.js";
import { applyRemoteSchedule, listScheduleRecords, removeScheduleLocal } from "./schedule-store.js";
import {
  agentClock, bundleDataOf, filesClock, filesSignature, isAgentRow, isGridLayout, isTabRow, mergeTabLocal,
  tabClock, tabRecordOf, workspaceClock, workspaceId, type BundleDataLike, type MemberLibraryKind,
} from "../shared/member-library.js";
import { MAX_SYNC_FILE_BYTES, type KindAdapter, type LocalFile, type LocalItem, type PulledFile } from "./library-sync-core.js";

// ── The state sidecar ────────────────────────────────────────────────────────

export const SYNC_STATE_FILE = (): string => userScopedPath("library-sync-state.json");

interface BundleState { updatedAt: number; sig: string; files: MemberLibraryFile[] }
export interface SyncState {
  lastSyncAt: Partial<Record<MemberLibraryKind, number>>;
  bundles: Record<string, BundleState>;
}

export function readSyncState(): SyncState {
  try {
    const raw = JSON.parse(fs.readFileSync(SYNC_STATE_FILE(), "utf-8")) as Partial<SyncState>;
    return { lastSyncAt: raw.lastSyncAt && typeof raw.lastSyncAt === "object" ? raw.lastSyncAt : {}, bundles: raw.bundles && typeof raw.bundles === "object" ? raw.bundles : {} };
  } catch { return { lastSyncAt: {}, bundles: {} }; }
}

export function writeSyncState(state: SyncState): void {
  try {
    const file = SYNC_STATE_FILE();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) { console.warn("[library-sync] state not written:", err instanceof Error ? err.message : err); }
}

export function updateSyncState(fn: (state: SyncState) => void): void {
  const state = readSyncState();
  fn(state);
  writeSyncState(state);
}

// ── Workspaces ───────────────────────────────────────────────────────────────

export function workspaceAdapter(): KindAdapter {
  const lm = () => getLayoutManager();
  return {
    kind: "workspace",
    hasFiles: false,
    list(): LocalItem[] {
      return lm().listLayouts().map((grid) => {
        const id = workspaceId(grid.name);
        // A file written before stamps existed: its mtime is the honest clock.
        let clock = workspaceClock(grid);
        if (!clock) { try { clock = Math.floor(fs.statSync(path.join(WORKSPACES_DIR(), id, "workspace.json")).mtimeMs); } catch { clock = 0; } }
        return { id, updatedAt: clock, data: { ...grid, updatedAt: clock } };
      });
    },
    apply(item: MemberLibraryItem): void {
      if (!isGridLayout(item.data)) throw new Error(`workspace ${item.id}: not a grid`);
      // ONE LIST (his order, 2026-10-06): every workspace row is adopted —
      // this machine's workspaces folder is a cache of the server's rows.
      lm().applyRemoteLayout({ ...(item.data as GridLayout), updatedAt: item.updatedAt });
    },
    remove(id: string): void { lm().removeLayoutLocal(id); },
  };
}

// ── App tabs ─────────────────────────────────────────────────────────────────

export function tabAdapter(): KindAdapter {
  return {
    kind: "tab",
    hasFiles: false,
    list(): LocalItem[] {
      return appsStore.mineSync().map((row) => ({ id: row.slug, updatedAt: tabClock(row), data: tabRecordOf(row) }));
    },
    apply(item: MemberLibraryItem): void {
      if (!isTabRow(item.data)) throw new Error(`tab ${item.id}: not a tab row`);
      const remote = { ...item.data, slug: item.id, id: item.data.id || item.id, updatedAt: new Date(item.updatedAt).toISOString() };
      appsStore.applyRemoteTab(mergeTabLocal(remote, appsStore.readRow(item.id)) as appsStore.LocalAppRow);
      invalidateOrgApps();
    },
    remove(id: string): void { appsStore.removeEntryLocal(id); invalidateOrgApps(); },
  };
}

// ── Agents ───────────────────────────────────────────────────────────────────

export function agentAdapter(): KindAdapter {
  return {
    kind: "agent",
    hasFiles: false,
    list(): LocalItem[] {
      return listAgents().map((row) => ({ id: row.slug, updatedAt: agentClock(row), data: row }));
    },
    apply(item: MemberLibraryItem): void {
      if (!isAgentRow(item.data)) throw new Error(`agent ${item.id}: not an agent row`);
      applyRemoteAgent({ ...(item.data as AgentRow), slug: item.id, id: item.id, updatedAt: new Date(item.updatedAt).toISOString() });
    },
    remove(id: string): void { removeAgentLocal(id); },
  };
}

// ── Skills and tasks (folders) ───────────────────────────────────────────────

const sha256 = (abs: string): string => createHash("sha256").update(fs.readFileSync(abs)).digest("hex");

/** A folder's manifest: every file the sync carries, with its hash and mtime. */
export function manifestOf(dir: string): LocalFile[] {
  const out: LocalFile[] = [];
  for (const f of walk(dir)) {
    if (f.size > MAX_SYNC_FILE_BYTES) continue;
    const abs = path.join(dir, f.path);
    try {
      const st = fs.statSync(abs);
      out.push({ path: f.path, size: st.size, mtime: Math.floor(st.mtimeMs), sha256: sha256(abs), abs });
    } catch { /* vanished mid-walk */ }
  }
  return out;
}

const bundleKey = (kind: MemberLibraryKind, id: string): string => `${kind}:${id}`;
const bundleSig = (files: readonly MemberLibraryFile[], enabled: boolean): string => `${filesSignature(files)}|enabled:${enabled}`;

function readJson(file: string): Record<string, unknown> | null {
  try { const v = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown; return v && typeof v === "object" ? v as Record<string, unknown> : null; }
  catch { return null; }
}

export function bundleAdapter(kind: "skill" | "task"): KindAdapter {
  const dirOf = (id: string): string | null => listSyncableBundles(kind).find((b) => b.id === id)?.dir ?? null;
  return {
    kind,
    hasFiles: true,
    list(): LocalItem[] {
      const state = readSyncState();
      const out: LocalItem[] = [];
      for (const b of listSyncableBundles(kind)) {
        const files = manifestOf(b.dir);
        let md = "";
        try { md = fs.readFileSync(path.join(b.dir, "SKILL.md"), "utf-8"); } catch { continue; }
        const manifest = kind === "task" ? readJson(path.join(b.dir, "task.json")) : null;
        const data: BundleDataLike = bundleDataOf(kind, b.id, md, b.enabled, manifest);
        const sig = bundleSig(files, b.enabled);
        const held = state.bundles[bundleKey(kind, b.id)];
        // The clock: the synced one while nothing moved; else the newest file
        // (an edit is a write on this machine), strictly after the synced
        // clock; an enabled flip with no file change is "now".
        let updatedAt: number;
        if (held && held.sig === sig) updatedAt = held.updatedAt;
        else {
          const filesMoved = !held || filesSignature(held.files) !== filesSignature(files);
          updatedAt = Math.max(filesMoved ? filesClock(files) : Date.now(), (held?.updatedAt ?? 0) + 1);
        }
        out.push({ id: b.id, updatedAt, data, files });
      }
      return out;
    },
    apply(item: MemberLibraryItem, files: PulledFile[] = []): void {
      const data = item.data as Partial<BundleDataLike> | null;
      const enabled = !data || data.enabled !== false;
      applyRemoteBundle(kind, item.id, enabled, files);
    },
    remove(id: string): void { removeBundleLocal(kind, id); },
    noteSynced(id: string, updatedAt: number, files: MemberLibraryFile[] = []): void {
      const enabled = listSyncableBundles(kind).find((b) => b.id === id)?.enabled ?? true;
      const clean = files.map((f) => ({ path: f.path, size: f.size, mtime: f.mtime, sha256: f.sha256 }));
      updateSyncState((s) => { s.bundles[bundleKey(kind, id)] = { updatedAt, sig: bundleSig(clean, enabled), files: clean }; });
    },
    lastSyncedFiles(id: string): MemberLibraryFile[] | null {
      return readSyncState().bundles[bundleKey(kind, id)]?.files ?? null;
    },
    localFiles(id: string): MemberLibraryFile[] | null {
      const dir = dirOf(id);
      return dir ? manifestOf(dir).map(({ path: p, size, mtime, sha256: h }) => ({ path: p, size, mtime, sha256: h })) : null;
    },
  };
}

// ── Drips and schedules (SQLite rows) ────────────────────────────────────────

/** A drip preset: the record is `{ name, recipe }`; the clock is the row's stamp. */
export function dripAdapter(): KindAdapter {
  return {
    kind: "drip",
    hasFiles: false,
    list(): LocalItem[] { return listDripRecords(); },
    apply(item: MemberLibraryItem): void { applyRemoteDrip(item); },
    remove(id: string): void { removeDripLocal(id); },
  };
}

/** A schedule: the record is what puts a target on a clock; a pull arms it
 *  on this machine's clock, a remote delete stops it. */
export function scheduleAdapter(): KindAdapter {
  return {
    kind: "schedule",
    hasFiles: false,
    list(): LocalItem[] { return listScheduleRecords(); },
    apply(item: MemberLibraryItem): void { applyRemoteSchedule(item); },
    remove(id: string): void { removeScheduleLocal(id); },
  };
}

/** Every adapter, by kind. */
export function allAdapters(): KindAdapter[] {
  return [workspaceAdapter(), tabAdapter(), agentAdapter(), bundleAdapter("skill"), bundleAdapter("task"), dripAdapter(), scheduleAdapter()];
}
