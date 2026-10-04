/**
 * wall-swipe.ts — THE WALL'S SWIPE, one decider (his order, 2026-10-04: "the
 * echo panel needs a swipe gesture to swipe between pages of apps").
 *
 * The wall's pages (code-workbench.ts `renderPages`) are a scroll-snap
 * carousel; the › arrow, the dots and the keyboard move it one page at a
 * time through `scrollToPage`. Two more ways in, on the desktop AND the web,
 * both landing on that same transition:
 *
 *  - a TRACKPAD SWIPE — wheel events whose deltaX dominates, accumulated over
 *    the gesture until they pass a threshold; one gesture = one page, however
 *    long its inertial tail runs (`wheelSwipeFeed`);
 *  - a TOUCH SWIPE — a horizontal pointer drag over the tile area past ~40px
 *    moves one page and ends the gesture (`swipeStep`, fed by the caller).
 *
 * WHO OWNS A POINTER GESTURE (the rule, spelled once):
 *  - a mouse never swipes by dragging: a drag that starts on a tile is the
 *    tile's (the HTML5 drag `wireIconDrag` arms: reorder / trade with the
 *    dock), and a drag on empty page space rubber-bands the multi-select;
 *    the mouse's swipe is the trackpad, through the wheel;
 *  - a touch or pen pointer swipes: a drag that is clearly horizontal (dx
 *    dominant, past the threshold) pages, whether it began on a tile or on
 *    empty space — UNLESS a tile was picked first (the native drag fired
 *    `dragstart`, e.g. an iOS long press), in which case the gesture is the
 *    tile's and the swipe stands down; a vertical drag is the page's own
 *    scroll (CSS `touch-action: pan-y`), a short one is a tap.
 *
 * Pure — unit-tested in test/main/wall-swipe.test.ts.
 */

/** Accumulated wheel deltaX (px) a trackpad gesture must reach to page. */
export const SWIPE_WHEEL_PX = 60;
/** Pointer travel (px) a touch drag must reach to page. */
export const SWIPE_DRAG_PX = 40;
/** After a page turn, no other turn for this long — one gesture = one page. */
export const SWIPE_COOLDOWN_MS = 450;
/** A pause between wheel events longer than this starts a NEW gesture. */
export const WHEEL_GESTURE_GAP_MS = 150;

export interface SwipeInput {
  /** Travel in SCROLL direction: positive = toward the next page (a wheel's
   *  deltaX as it comes; a drag's `startX - clientX`, i.e. the finger moving
   *  left pulls the next page in). */
  dx: number;
  /** Travel across: the swipe stands down when this dominates. */
  dy: number;
  /** The horizontal travel that pages. */
  threshold: number;
  /** Ms since the last page turn; undefined when there has been none. */
  sinceLast?: number;
  /** The cooldown after a turn; defaults to SWIPE_COOLDOWN_MS. */
  cooldown?: number;
}

/**
 * -1 = previous page, 1 = next page, 0 = nothing (yet). A step needs |dx| at
 * the threshold, |dx| strictly over |dy| (a diagonal is not a swipe), and the
 * cooldown spent.
 */
export function swipeStep(i: SwipeInput): -1 | 0 | 1 {
  const cooldown = i.cooldown ?? SWIPE_COOLDOWN_MS;
  if (i.sinceLast !== undefined && i.sinceLast < cooldown) return 0;
  const ax = Math.abs(i.dx), ay = Math.abs(i.dy);
  if (!(ax >= i.threshold) || !(ax > ay)) return 0;
  return i.dx > 0 ? 1 : -1;
}

/** One trackpad gesture's running state — make with `wheelSwipeState()`. */
export interface WheelSwipeState {
  accX: number;
  accY: number;
  /** When the last wheel event landed; -Infinity before the first. */
  lastEventAt: number;
  /** When the gesture last paged; -Infinity before the first. */
  lastStepAt: number;
  /** False once this gesture has paged: its tail (inertia) is ignored until
   *  a pause starts a new gesture. */
  armed: boolean;
}

export function wheelSwipeState(): WheelSwipeState {
  return { accX: 0, accY: 0, lastEventAt: -Infinity, lastStepAt: -Infinity, armed: true };
}

/**
 * Feed one wheel event; returns the page step it completes. Events closer
 * than WHEEL_GESTURE_GAP_MS belong to one gesture and accumulate; a gesture
 * pages at most once (the inertial tail after a turn is swallowed); a pause
 * re-arms; the cooldown keeps two quick gestures from turning two pages.
 */
export function wheelSwipeFeed(s: WheelSwipeState, deltaX: number, deltaY: number, now: number): -1 | 0 | 1 {
  const gap = now - s.lastEventAt;
  s.lastEventAt = now;
  if (gap > WHEEL_GESTURE_GAP_MS) { s.accX = 0; s.accY = 0; s.armed = true; }
  if (!s.armed) return 0;
  s.accX += deltaX;
  s.accY += deltaY;
  const step = swipeStep({
    dx: s.accX, dy: s.accY, threshold: SWIPE_WHEEL_PX,
    sinceLast: Number.isFinite(s.lastStepAt) ? now - s.lastStepAt : undefined,
    cooldown: SWIPE_COOLDOWN_MS,
  });
  if (step !== 0) { s.armed = false; s.lastStepAt = now; s.accX = 0; s.accY = 0; }
  return step;
}

/** The pointers that swipe by dragging (see the rule above): touch and pen.
 *  A mouse (or an unknown pointer) keeps its drags for tiles and selection. */
export function isSwipePointer(pointerType: string): boolean {
  return pointerType === "touch" || pointerType === "pen";
}

/** A wheel event's deltas in px: line-mode deltas (Firefox + a mouse wheel)
 *  are scaled by a nominal line height so the threshold means the same. */
export const WHEEL_LINE_PX = 16;
export function wheelDeltaPx(delta: number, deltaMode: number): number {
  return deltaMode === 1 ? delta * WHEEL_LINE_PX : delta;
}
