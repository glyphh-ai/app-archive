/**
 * Layouts — the LOCAL workspace library (THE PURGE, 2026-09-10).
 *
 * A workspace persists as a folder on disk:
 *
 *   ~/.glyphh/workspaces/<id>/workspace.json   — the grid definition (this file)
 *   ~/.glyphh/workspaces/<id>/state.json       — drag/panel state (workspace-state.ts)
 *
 * `<id>` is the workspace's slug. The server layout library is gone — the
 * files ARE the truth; the old per-user `.layouts` cache imports once, then
 * retires. The BrowserView grid engine left long ago: opening a layout goes
 * through app-resolver's openLayoutByName, which turns every cell into a
 * renderer-owned workbench panel. What remains is CRUD over the folder.
 */

import fs from "fs";
import path from "path";
import { userScopedPath } from "./app-paths.js";
import { layoutRowOf, workspaceId as sharedWorkspaceId, workspaceSurfaceOf, type LayoutRowLike, type WorkspaceSurface } from "../shared/member-library.js";
import { noteLibraryDelete, noteLibrarySave } from "./library-events.js";

// The flattened spec shape the palette / app resolver / agent tools read.
// (The name is historical — "server" layouts are local files now.)
export interface ServerLayout {
  id: string;
  name: string;
  cols: number;
  rows: number;
  cells: Array<{ panelId: string; col: number; row: number; colSpan: number; rowSpan: number; sticky?: boolean; config?: { url?: string; cmd?: string; keepAlive?: boolean; railMenu?: boolean; railRecents?: boolean; railLayouts?: boolean; railHideLeft?: boolean; railHideRight?: boolean; loop?: string; view?: "glyphh" | "cli"; folder?: string; model?: string; session?: "keep" | "new" | "last"; gateway?: "on" | "off"; type?: "work" | "code" } }>;
  folderMode: "single" | "multi";
  target: "glyphh" | "desktop";
  /** The loop this layout activates on open. Absent → no opinion. */
  loop?: string;
  /** The face its agents open with (2026-09-17): the app default holds when
   *  absent, and an agent cell of its own overrides this. */
  view?: "glyphh" | "cli";
  /** role → catalog model id for that loop's slots. */
  modelSelections?: Record<string, string>;
  /** Session behavior on open: keep (default) | new | last. */
  sessionMode?: "keep" | "new" | "last";
  /** Work or Code for the sessions it creates (2026-10-07); a cell's own wins. */
  type?: "work" | "code";
  /** Folder the agent switches to on open. */
  folder?: string;
  /** The SPACE this layout belongs to (chat | cowork | code). */
  space?: "chat" | "cowork" | "code";
}

export const WORKSPACES_DIR = (): string => userScopedPath("workspaces");

/** The folder id a workspace persists under — its name, slugged (the
 *  member library's record id for the workspace, shared/member-library.ts). */
export const workspaceId = sharedWorkspaceId;

// ── Grid model ──────────────────────────────────────────────

export interface GridCell {
  panelId: string;
  col: number;      // 0-based column
  row: number;      // 0-based row
  colSpan: number;
  rowSpan: number;
  /** At most one cell per layout: the app-switch target ("sticky" panel). */
  sticky?: boolean;
  /** Per-cell app setup the layout applies on open: the Browser cell's URL,
   *  the Terminal cell's first command (runs after the folder is set), the
   *  Rail panel's section toggles. Opaque to the store — passed through. */
  config?: { url?: string; cmd?: string; keepAlive?: boolean; railMenu?: boolean; railRecents?: boolean; railLayouts?: boolean; railHideLeft?: boolean; railHideRight?: boolean; loop?: string; view?: "glyphh" | "cli"; folder?: string; model?: string; session?: "keep" | "new" | "last"; gateway?: "on" | "off"; type?: "work" | "code" };
}

/** Folder-binding mode for layouts that contain any folder-bound app
 *  (requiresFolder: true). "single" hoists ONE picker to the layout chrome
 *  — all folder-bound panels share that folder. "multi" lets each
 *  folder-bound panel pick its own. Default = "single". */
export type LayoutFolderMode = "single" | "multi";

export interface GridLayout {
  name: string;
  version: 2;
  cols: number;           // 1–25
  rows: number;           // 1–25
  colWidths: number[];    // fractions summing to ~1
  rowHeights: number[];   // fractions summing to ~1
  cells: GridCell[];
  folderMode?: LayoutFolderMode;
  /** Where the layout opens: "glyphh" (default) or "desktop". */
  target?: "glyphh" | "desktop";
  /** The face its agents open with; absent leaves the app default in force. */
  view?: "glyphh" | "cli";
  loop?: string;
  modelSelections?: Record<string, string>;
  sessionMode?: "keep" | "new" | "last";
  type?: "work" | "code";
  folder?: string;
  space?: "chat" | "cowork" | "code";
  /** THE LWW CLOCK (his rule, 2026-10-04: database-as-truth, latest wins):
   *  epoch ms, this client's `Date.now()` at the save. A file written before
   *  stamps existed has none and loses to any server copy. */
  updatedAt?: number;
  /** THE SURFACE IT WAS MADE ON (his order, 2026-10-06): "desktop" or "web",
   *  stamped at the save; absent = made on a desktop before the stamp. */
  surface?: WorkspaceSurface;
}

/** THE DESKTOP'S LIST (his order, 2026-10-06: "the workspaces should carry
 *  a desktop vs web key for where they are created"): a desktop lists only
 *  the workspaces made on a desktop — a workspace made on the web is the
 *  web's. The folder (and the library row) keeps EVERY workspace: the sync
 *  caches all of them here; only the list the wall and the Workspaces page
 *  read is filtered. The same rule, mirrored, is member-library-web.js
 *  layoutsList. */
export function desktopLayouts<T extends Pick<GridLayout, "surface">>(grids: readonly T[]): T[] {
  return grids.filter((g) => workspaceSurfaceOf(g) === "desktop");
}

/** The row the Workspaces page, the wall and the attach socket read — the
 *  `layouts-list` IPC's shape, projected in ONE place (shared/member-library.ts
 *  layoutRowOf) so app.glyphh.ai — reading the server's record or a workspace
 *  off the desktop over the relay — sees exactly what the desktop's own
 *  renderer sees. */
export type LayoutRow = LayoutRowLike;

export function toLayoutRow(l: GridLayout): LayoutRow {
  return layoutRowOf(l);
}

/** Every workspace on disk, flattened to the spec shape. */
export async function fetchServerLayouts(): Promise<ServerLayout[]> {
  const out: ServerLayout[] = [];
  let ids: string[] = [];
  try { ids = fs.readdirSync(WORKSPACES_DIR()); } catch { return out; }
  for (const id of ids) {
    const file = path.join(WORKSPACES_DIR(), id, "workspace.json");
    try {
      const grid = JSON.parse(fs.readFileSync(file, "utf-8")) as GridLayout;
      if (!Array.isArray(grid.cells)) continue;
      out.push({
        id,
        name: grid.name || id,
        cols: Math.max(1, grid.cols || 1),
        rows: Math.max(1, grid.rows || 1),
        cells: grid.cells,
        folderMode: grid.folderMode === "multi" ? "multi" : "single",
        target: grid.target === "desktop" ? "desktop" : "glyphh",
        ...(grid.loop ? { loop: grid.loop } : {}),
        ...(grid.view === "glyphh" || grid.view === "cli" ? { view: grid.view } : {}),
        ...(grid.sessionMode === "new" || grid.sessionMode === "last" ? { sessionMode: grid.sessionMode } : {}),
        ...(grid.folder ? { folder: grid.folder } : {}),
        ...(grid.space === "chat" || grid.space === "cowork" || grid.space === "code" ? { space: grid.space } : {}),
        ...(grid.modelSelections && typeof grid.modelSelections === "object" ? { modelSelections: grid.modelSelections } : {}),
      });
    } catch { /* not a workspace folder — skip */ }
  }
  return out;
}

// ── Legacy types (one-time import of the old per-user cache) ─

interface LegacySplit { panelId: string; x: number; y: number; width: number; height: number }
interface LegacyLayout { name: string; splits: LegacySplit[] }

const legacyFile = () => userScopedPath(".layouts");

// ── LayoutManager ───────────────────────────────────────────

export class LayoutManager {
  private layouts: Map<string, GridLayout> = new Map();

  constructor() {
    this.load();
  }

  // ── Layout CRUD ───────────────────────────────────────────

  /** Save a workspace — its folder is created on first save. The save is
   *  stamped with this client's clock and the surface it was made on (a grid
   *  without one is this desktop's), then announced, so the sync pushes it. */
  saveLayout(grid: GridLayout): Promise<void> {
    const stamped: GridLayout = { ...grid, surface: grid.surface ?? "desktop", updatedAt: Date.now() };
    this.layouts.set(stamped.name, stamped);
    this.persistOne(stamped);
    noteLibrarySave("workspace", workspaceId(stamped.name));
    return Promise.resolve();
  }

  /** Delete a workspace — the whole folder goes (definition AND state), a
   *  tombstone is written and the sync pushes the remove. */
  async deleteLayout(name: string): Promise<boolean> {
    if (!this.layouts.has(name)) return false;
    this.removeFolder(name);
    noteLibraryDelete("workspace", workspaceId(name));
    return true;
  }

  // ── The sync's side (library-sync.ts): pulls land here, remote deletes too ──

  /** A workspace the server holds, written as-is (its clock is the server
   *  row's). Never announced — it came FROM the sync. */
  applyRemoteLayout(grid: GridLayout): void {
    this.layouts.set(grid.name, grid);
    this.persistOne(grid);
  }

  /** The server tombstoned this workspace (by folder id): the folder goes, quietly. */
  removeLayoutLocal(id: string): boolean {
    const hit = Array.from(this.layouts.values()).find((l) => workspaceId(l.name) === id);
    if (!hit) return false;
    this.removeFolder(hit.name);
    return true;
  }

  private removeFolder(name: string): void {
    this.layouts.delete(name);
    try { fs.rmSync(path.join(WORKSPACES_DIR(), workspaceId(name)), { recursive: true, force: true }); }
    catch { /* already gone */ }
  }

  /** List all layouts */
  listLayouts(): GridLayout[] {
    return Array.from(this.layouts.values());
  }

  /** The files are the truth — re-scan and return. (Name kept from the
   *  server-sync era; the layouts-list IPC still calls it.) */
  async refreshAndList(): Promise<GridLayout[]> {
    this.layouts.clear();
    this.load();
    return this.listLayouts();
  }

  // ── Persistence ───────────────────────────────────────────

  private load() {
    // One-time import: the old per-user `.layouts` cache becomes folders.
    try {
      const raw = JSON.parse(fs.readFileSync(legacyFile(), "utf-8")) as unknown[];
      for (const item of raw) {
        const obj = item as Record<string, unknown>;
        const grid = obj.version === 2
          ? (obj as unknown as GridLayout)
          : this.migrateLayout(obj as unknown as LegacyLayout);
        if (!fs.existsSync(path.join(WORKSPACES_DIR(), workspaceId(grid.name), "workspace.json"))) {
          this.persistOne(grid);
        }
      }
      fs.renameSync(legacyFile(), `${legacyFile()}.migrated`);
      console.log("[layouts] imported legacy .layouts into ~/.glyphh/workspaces");
    } catch { /* no legacy cache — nothing to import */ }

    let ids: string[] = [];
    try { ids = fs.readdirSync(WORKSPACES_DIR()); } catch { return; }
    for (const id of ids) {
      try {
        const grid = JSON.parse(fs.readFileSync(path.join(WORKSPACES_DIR(), id, "workspace.json"), "utf-8")) as GridLayout;
        if (grid.name && Array.isArray(grid.cells)) this.layouts.set(grid.name, grid);
      } catch { /* not a workspace folder — skip */ }
    }
  }

  private persistOne(grid: GridLayout): void {
    try {
      const dir = path.join(WORKSPACES_DIR(), workspaceId(grid.name));
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "workspace.json");
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(grid, null, 2), "utf-8");
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error(`[layouts] failed to persist "${grid.name}":`, err instanceof Error ? err.message : err);
    }
  }

  /** Identity switch — workspaces are machine-local now, so this is just a
   *  re-scan (kept because auth.ts calls it on account change). */
  resetForUserChange(): void {
    this.layouts.clear();
    this.load();
  }

  private migrateLayout(legacy: LegacyLayout): GridLayout {
    const n = legacy.splits.length;
    return {
      name: legacy.name,
      version: 2,
      cols: n,
      rows: 1,
      colWidths: legacy.splits.map((s) => s.width),
      rowHeights: [1],
      cells: legacy.splits.map((s, i) => ({
        panelId: s.panelId,
        col: i,
        row: 0,
        colSpan: 1,
        rowSpan: 1,
      })),
    };
  }
}

/** The one LayoutManager the app runs: main.ts takes it on start, the attach
 *  socket's layouts.* read through the same instance (attach-handlers.ts). */
let shared: LayoutManager | null = null;
export function getLayoutManager(): LayoutManager {
  return (shared ??= new LayoutManager());
}
