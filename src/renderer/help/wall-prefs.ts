/**
 * wall-prefs.ts — the LAYOUT preferences, as pure clamps plus one applier each.
 *
 * His ask, 2026-09-25: sliders for the wall's tiles-per-row, the overall width
 * of the tile layout, and the sidebar's tabs-per-row. All three are pure CSS
 * vars — nothing re-chunks, nothing re-renders — so each one applies LIVE while
 * the slider moves and the same applier seeds it at boot.
 *
 * Two callers must agree or the boot frame disagrees with the open Settings
 * panel: help/settings.ts (drag + persist) and help/code.ts (seed at boot).
 * The clamps live here so there is ONE definition of each range, and so they
 * can be tested without a `window` — the reason session-title.ts moved
 * out of code.ts too.
 */

/** Tiles across one launcher row. */
export const TILES_PER_ROW_MIN = 3;
export const TILES_PER_ROW_MAX = 14;
export const TILES_PER_ROW_DEFAULT = 8;

/** Wall width, 0..100. 0 = the natural cap the wall has always drawn; 100 =
 *  the full page less the grid's own side padding. */
export const WALL_WIDTH_MIN = 0;
export const WALL_WIDTH_MAX = 100;
export const WALL_WIDTH_DEFAULT = 0;

/** THE SIDEBAR TRAYS (his order, 2026-10-08: "add the left rail elements
 *  back as config"): Tabs and Workspaces under Recents, each an option on
 *  General. OFF by default (his order the same night: "turn those off by
 *  default") — a member turns one on. Settings writes the pref, then
 *  dispatches RAIL_SECTIONS_CHANGED_EVENT; the rail re-reads (help/code.ts
 *  applyRailSectionsVisibility). */
export const RAIL_SHOW_APPS_PREF = "railShowApps";
export const RAIL_SHOW_LAYOUTS_PREF = "railShowLayouts";
export const RAIL_SHOW_DEFAULT = false;
export const RAIL_SECTIONS_CHANGED_EVENT = "glyphh:rail-sections-changed";
/** A stored value → shown? Only an explicit true shows a tray. */
export function railTrayShown(v: unknown): boolean { return v === true; }

/** Tabs across one rail row. 0 = Auto (auto-fill at the grid's 58px floor),
 *  which is the behaviour the tray shipped with. */
export const RAIL_TABS_AUTO = 0;
export const RAIL_TABS_MIN = 0;
export const RAIL_TABS_MAX = 6;
export const RAIL_TABS_DEFAULT = RAIL_TABS_AUTO;

function clamp(v: unknown, lo: number, hi: number, dflt: number): number {
  // MISSING is not 0. Number(null) and Number("") are both a finite 0, so a
  // plain isFinite guard would clamp an unset pref to the slider's MINIMUM
  // (3 tiles across, not 8) rather than to its default.
  if (v === null || v === undefined || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
}

export function clampTilesPerRow(v: unknown): number {
  return clamp(v, TILES_PER_ROW_MIN, TILES_PER_ROW_MAX, TILES_PER_ROW_DEFAULT);
}

export function clampWallWidth(v: unknown): number {
  return clamp(v, WALL_WIDTH_MIN, WALL_WIDTH_MAX, WALL_WIDTH_DEFAULT);
}

export function clampRailTabsPerRow(v: unknown): number {
  return clamp(v, RAIL_TABS_MIN, RAIL_TABS_MAX, RAIL_TABS_DEFAULT);
}

/**
 * The rail grid's `grid-template-columns` repeat() track count.
 *
 * Auto must resolve to the KEYWORD `auto-fill`, not a number: the grid's rule
 * is `repeat(var(--rail-tabs-cols, auto-fill), minmax(58px, 1fr))`, so a
 * numeric 0 there would be an invalid track count and drop the whole
 * declaration — the tray would fall back to a single column.
 */
export function railTabsTrack(v: unknown): string {
  const n = clampRailTabsPerRow(v);
  return n <= RAIL_TABS_AUTO ? "auto-fill" : String(n);
}

/** The label beside the rail slider — Auto reads as a word, not a 0. */
export function railTabsLabel(v: unknown): string {
  const n = clampRailTabsPerRow(v);
  return n <= RAIL_TABS_AUTO ? "Auto" : String(n);
}

const root = (): HTMLElement | null =>
  typeof document === "undefined" ? null : document.documentElement;

export function applyTilesPerRow(v: unknown): void {
  root()?.style.setProperty("--echo-cols", String(clampTilesPerRow(v)));
}

export function applyWallWidth(v: unknown): void {
  root()?.style.setProperty("--echo-wall-w", String(clampWallWidth(v)));
}

export function applyRailTabsPerRow(v: unknown): void {
  root()?.style.setProperty("--rail-tabs-cols", railTabsTrack(v));
}
