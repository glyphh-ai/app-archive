/**
 * wall-prefs.ts — the SIDEBAR's layout preferences, as pure clamps plus one
 * applier each. (The wall's own sliders went with the wall, 2026-10-08.)
 *
 * His ask, 2026-09-25: the sidebar's tabs-per-row is a pure CSS var — nothing
 * re-renders — so it applies LIVE while the slider moves and the same applier
 * seeds it at boot.
 *
 * Two callers must agree or the boot frame disagrees with the open Settings
 * panel: help/settings.ts (drag + persist) and help/code.ts (seed at boot).
 * The clamps live here so there is ONE definition of each range, and so they
 * can be tested without a `window` — the reason session-title.ts moved
 * out of code.ts too.
 */

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
  // rather than to its default.
  if (v === null || v === undefined || v === "") return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : dflt;
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

export function applyRailTabsPerRow(v: unknown): void {
  root()?.style.setProperty("--rail-tabs-cols", railTabsTrack(v));
}
