/**
 * Layouts — THE WORKSPACES, read from the server and held in memory.
 *
 * Until 2026-10-07 a workspace was a folder on this machine
 * (~/.glyphh/<user>/workspaces/<id>/workspace.json) the library sync kept
 * level with the server. His order that day: the server is the only truth;
 * this manager keeps a RUNNING COPY of the member library's `workspace` rows
 * (library-remote.ts primes it at sign-in and refreshes it) and writes
 * straight back. Nothing on disk. Opening a layout still goes through
 * app-resolver's openLayoutByName, which turns every cell into a
 * renderer-owned workbench panel.
 */

import { isGridLayout, layoutRowOf, workspaceId as sharedWorkspaceId, workspaceSurfaceOf, type LayoutRowLike, type WorkspaceSurface } from "../shared/member-library.js";
import { remoteList, remotePut, remoteRemove } from "./library-remote.js";

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

/** Every workspace in the running copy, flattened to the spec shape. */
export async function fetchServerLayouts(): Promise<ServerLayout[]> {
  const out: ServerLayout[] = [];
  for (const grid of getLayoutManager().listLayouts()) {
    const id = sharedWorkspaceId(grid.name);
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
        ...(grid.type === "work" || grid.type === "code" ? { type: grid.type } : {}),
        ...(grid.folder ? { folder: grid.folder } : {}),
        ...(grid.space === "chat" || grid.space === "cowork" || grid.space === "code" ? { space: grid.space } : {}),
        ...(grid.modelSelections && typeof grid.modelSelections === "object" ? { modelSelections: grid.modelSelections } : {}),
      });
  }
  return out;
}

export class LayoutManager {
  private layouts: Map<string, GridLayout> = new Map();
  private loading: Promise<void> | null = null;

  /** Save a workspace: stamped with this client's clock and the surface it
   *  was made on (a grid without one is this desktop's), written to the
   *  server, held in the running copy. */
  async saveLayout(grid: GridLayout): Promise<void> {
    const stamped: GridLayout = { ...grid, surface: grid.surface ?? "desktop", updatedAt: Date.now() };
    await remotePut("workspace", sharedWorkspaceId(stamped.name), stamped);
    this.layouts.set(stamped.name, stamped);
  }

  /** Delete a workspace on the server; the running copy drops it. */
  async deleteLayout(name: string): Promise<boolean> {
    if (!this.layouts.has(name)) return false;
    await remoteRemove("workspace", sharedWorkspaceId(name));
    this.layouts.delete(name);
    return true;
  }

  /** Every workspace in the running copy. */
  listLayouts(): GridLayout[] {
    return Array.from(this.layouts.values());
  }

  /** Reload the running copy from the server and return it. */
  async refreshAndList(): Promise<GridLayout[]> {
    await this.load();
    return this.listLayouts();
  }

  private load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const fresh = await remoteList<GridLayout>("workspace");
      this.layouts.clear();
      for (const r of fresh) {
        if (!isGridLayout(r.data) || !r.data.name) continue;
        this.layouts.set(r.data.name, { ...(r.data as GridLayout), updatedAt: r.updatedAt });
      }
    })().finally(() => { this.loading = null; });
    return this.loading;
  }

  /** Identity switch: the copy is the previous member's — drop it and reload. */
  resetForUserChange(): void {
    this.layouts.clear();
    void this.load().catch(() => undefined);
  }
}

/** The one LayoutManager the app runs: main.ts takes it on start, the attach
 *  socket's layouts.* read through the same instance (attach-handlers.ts). */
let shared: LayoutManager | null = null;
export function getLayoutManager(): LayoutManager {
  return (shared ??= new LayoutManager());
}
