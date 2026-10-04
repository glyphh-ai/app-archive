/**
 * wall-swipe.test.ts — the wall's swipe decider (src/renderer/help/
 * wall-swipe.ts): the one-step rule, the trackpad accumulator (one gesture =
 * one page, however long the inertia), the cooldown, and who swipes by
 * dragging.
 */
import { describe, it, expect } from "vitest";
import {
  swipeStep, wheelSwipeFeed, wheelSwipeState, isSwipePointer, wheelDeltaPx,
  SWIPE_WHEEL_PX, SWIPE_DRAG_PX, SWIPE_COOLDOWN_MS, WHEEL_GESTURE_GAP_MS, WHEEL_LINE_PX,
} from "../../src/renderer/help/wall-swipe.js";

describe("swipeStep — one page per clear horizontal travel", () => {
  const T = SWIPE_DRAG_PX;
  it("pages forward on positive travel at the threshold, back on negative", () => {
    expect(swipeStep({ dx: T, dy: 0, threshold: T })).toBe(1);
    expect(swipeStep({ dx: -T, dy: 0, threshold: T })).toBe(-1);
    expect(swipeStep({ dx: 120, dy: 4, threshold: T })).toBe(1);
  });
  it("does nothing short of the threshold", () => {
    expect(swipeStep({ dx: T - 1, dy: 0, threshold: T })).toBe(0);
    expect(swipeStep({ dx: 0, dy: 0, threshold: T })).toBe(0);
    expect(swipeStep({ dx: NaN, dy: 0, threshold: T })).toBe(0);
  });
  it("stands down when the travel across dominates — a diagonal is not a swipe", () => {
    expect(swipeStep({ dx: T, dy: T, threshold: T })).toBe(0);
    expect(swipeStep({ dx: T, dy: T + 30, threshold: T })).toBe(0);
    expect(swipeStep({ dx: -T - 10, dy: -T - 20, threshold: T })).toBe(0);
    expect(swipeStep({ dx: T + 10, dy: -T, threshold: T })).toBe(1);
  });
  it("is swallowed inside the cooldown after a turn, and free once it has passed", () => {
    expect(swipeStep({ dx: T, dy: 0, threshold: T, sinceLast: 0 })).toBe(0);
    expect(swipeStep({ dx: T, dy: 0, threshold: T, sinceLast: SWIPE_COOLDOWN_MS - 1 })).toBe(0);
    expect(swipeStep({ dx: T, dy: 0, threshold: T, sinceLast: SWIPE_COOLDOWN_MS })).toBe(1);
    expect(swipeStep({ dx: T, dy: 0, threshold: T, sinceLast: 100, cooldown: 50 })).toBe(1);
  });
  it("names its thresholds", () => {
    expect(SWIPE_DRAG_PX).toBe(40);
    expect(SWIPE_WHEEL_PX).toBe(60);
    expect(SWIPE_COOLDOWN_MS).toBe(450);
    expect(WHEEL_GESTURE_GAP_MS).toBe(150);
  });
});

describe("wheelSwipeFeed — a trackpad gesture pages once", () => {
  it("accumulates small horizontal deltas into one page turn", () => {
    const s = wheelSwipeState();
    let t = 1000;
    const steps: number[] = [];
    for (let i = 0; i < 6; i++) { steps.push(wheelSwipeFeed(s, 15, 1, t)); t += 16; }
    // 15·4 = 60 reaches the threshold on the 4th event; nothing before, nothing after.
    expect(steps).toEqual([0, 0, 0, 1, 0, 0]);
  });
  it("swallows the inertial tail of a gesture that already paged, however long", () => {
    const s = wheelSwipeState();
    let t = 0;
    expect(wheelSwipeFeed(s, 80, 0, t)).toBe(1);
    // A long tail: 60 more events, 16 ms apart, each well over the threshold.
    for (let i = 0; i < 60; i++) { t += 16; expect(wheelSwipeFeed(s, 90, 0, t)).toBe(0); }
    // A pause starts a new gesture.
    t += WHEEL_GESTURE_GAP_MS + 1;
    expect(wheelSwipeFeed(s, 80, 0, t)).toBe(1);
  });
  it("keeps two gestures a short pause apart to one page by the cooldown", () => {
    const s = wheelSwipeState();
    expect(wheelSwipeFeed(s, 80, 0, 0)).toBe(1);
    // A pause re-arms, but the cooldown has not passed.
    expect(wheelSwipeFeed(s, 80, 0, WHEEL_GESTURE_GAP_MS + 10)).toBe(0);
    expect(wheelSwipeFeed(s, 80, 0, SWIPE_COOLDOWN_MS + WHEEL_GESTURE_GAP_MS + 20)).toBe(1);
  });
  it("pages back on a leftward gesture", () => {
    const s = wheelSwipeState();
    expect(wheelSwipeFeed(s, -30, 0, 0)).toBe(0);
    expect(wheelSwipeFeed(s, -30, 0, 16)).toBe(-1);
  });
  it("never pages on a vertical scroll, even a long one", () => {
    const s = wheelSwipeState();
    let t = 0;
    for (let i = 0; i < 20; i++) { expect(wheelSwipeFeed(s, 5, 40, t)).toBe(0); t += 16; }
  });
  it("forgets a stale accumulation after a pause", () => {
    const s = wheelSwipeState();
    expect(wheelSwipeFeed(s, 50, 0, 0)).toBe(0);
    // Too long ago to be the same gesture: the 50 does not carry over.
    expect(wheelSwipeFeed(s, 20, 0, WHEEL_GESTURE_GAP_MS + 1)).toBe(0);
    expect(wheelSwipeFeed(s, 40, 0, WHEEL_GESTURE_GAP_MS + 17)).toBe(1);
  });
});

describe("who swipes by dragging", () => {
  it("is the touch and the pen; a mouse keeps its drags for tiles and selection", () => {
    expect(isSwipePointer("touch")).toBe(true);
    expect(isSwipePointer("pen")).toBe(true);
    expect(isSwipePointer("mouse")).toBe(false);
    expect(isSwipePointer("")).toBe(false);
  });
  it("scales line-mode wheel deltas to px", () => {
    expect(wheelDeltaPx(3, 0)).toBe(3);
    expect(wheelDeltaPx(3, 1)).toBe(3 * WHEEL_LINE_PX);
    expect(wheelDeltaPx(-2, 1)).toBe(-2 * WHEEL_LINE_PX);
  });
});
