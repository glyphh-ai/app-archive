/**
 * dock-band.ts — THE DOCK'S BAND, one computation (his report, 2026-10-04:
 * on the web the dock drew over the wall's tiles, the search pill and an
 * agent panel's header; on the desktop the same page laid out fine).
 *
 * The command center measures the dock in two places — the stage (where the
 * search pill and the tile grid start) and the card band (where panels start)
 * — and each used to decide "is the dock there" its own way. On the desktop the
 * home shell is a BrowserView under a 38px drag strip and the panels are
 * webviews placed from the band; on the web everything is ONE document, so a
 * band computed wrong anywhere shows as the dock over the page. This module is
 * the single answer both ask: given the dock's rect, whether it is tucked, and
 * whether the member turned it off, how far down does the page start.
 *
 * Also here: the "Show the dock" preference (Settings → Appearance → Dock),
 * shared by desktop and web through the preferences store. Off = the dock is
 * not rendered at all (not merely tucked) and every dock-driven offset is zero.
 *
 * Pure — unit-tested in test/main/dock-band.test.ts.
 */

/** The preference: `true` (default) shows the dock; `false` removes it. */
export const DOCK_ENABLED_PREF = "dockEnabled";
/** The one-document event Settings fires after writing the pref; the wall
 *  re-reads on it (the desktop's main-process `preference-changed` broadcast
 *  carries the same change to every other document). */
export const DOCK_ENABLED_CHANGED_EVENT = "glyphh:dock-enabled-changed";
/** The body class while the dock is OFF — the stylesheet hides the bar, the
 *  portal layer and the hover strip under it. */
export const DOCK_OFF_CLASS = "echo-dock-off";

/** Reads the stored pref: anything but an explicit off means ON (an unset pref,
 *  an old map without the key, a server that hands back a string). */
export function dockEnabledFrom(v: unknown): boolean {
  if (v === false || v === 0) return false;
  if (typeof v === "string") return !/^(false|0|off|no)$/i.test(v.trim());
  return true;
}

/** What the DOM needs for a rect — a DOMRect, or a test's plain object. */
export interface DockRectLike { top: number; bottom: number; height: number; width?: number }

export interface DockBandInput {
  /** The "Show the dock" pref. Off → no band, whatever the DOM says. */
  enabled: boolean;
  /** body.echo-dock-tucked — an auto-hidden dock slid off the top reserves nothing. */
  tucked: boolean;
  /** The dock row's viewport rect; null when there is no dock in the document. */
  rect: DockRectLike | null;
  /** The stage's viewport top: the band is measured FROM the stage. */
  stageTop: number;
}

/** The dock's TITLES ride under the icons as absolutely positioned pseudo
 *  elements (styles.css `.echo-dock-btn::after`: 5px gap + 10.5px type) — they
 *  are not in the row's rect, so a band that stops at the rect lets the labels
 *  run into whatever starts there. */
export const DOCK_LABEL_REACH = 18;

/** Px from the stage's top to the dock's bottom edge (labels excluded); 0 when
 *  no dock occupies the stage. The one "is the dock there" rule: off → no;
 *  tucked → no; no rect, no height, or a rect wholly above the stage → no. */
export function dockBand(i: DockBandInput): number {
  if (!i.enabled || i.tucked || !i.rect) return 0;
  const r = i.rect;
  if (!(r.height > 0) || (r.width !== undefined && !(r.width > 0))) return 0;
  const band = r.bottom - i.stageTop;
  return band > 0 ? Math.round(band) : 0;
}

/** The search pill's top inside the stage: centred between the dock and the
 *  tiles (his ask, 2026-10-03), or high on the page when no dock is there. */
export const SEARCH_GAP_UNDER_DOCK = 34;
export const SEARCH_TOP_NO_DOCK = 18;
export function searchTopFor(band: number): number {
  return band > 0 ? band + SEARCH_GAP_UNDER_DOCK : SEARCH_TOP_NO_DOCK;
}

/** The card band's top inside the stage: the dock's edge, what reaches below
 *  it (`reach` — the row's bottom margin, which the stylesheet scales with the
 *  zoom so a magnified slot never dips onto a panel; never less than the
 *  labels), and the 7px inter-panel margin — or just the margin without a dock. */
export const CARD_BAND_MARGIN = 7;
export function cardBandTop(band: number, reach: number = DOCK_LABEL_REACH, margin: number = CARD_BAND_MARGIN): number {
  if (!(band > 0)) return margin;
  return Math.round(band + Math.max(DOCK_LABEL_REACH, reach > 0 ? reach : 0) + margin);
}

/** The live-apply of the pref on a document: the body class flips, and the
 *  caller re-measures. Returns whether anything changed, so a redundant event
 *  (the same value written twice) costs no relayout. */
export function applyDockEnabled(body: { classList: { contains(c: string): boolean; toggle(c: string, force?: boolean): boolean } }, enabled: boolean): boolean {
  const wasOff = body.classList.contains(DOCK_OFF_CLASS);
  if (wasOff === !enabled) return false;
  body.classList.toggle(DOCK_OFF_CLASS, !enabled);
  return true;
}
