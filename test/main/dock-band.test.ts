/**
 * dock-band.test.ts — the dock's band, one computation for the stage and the
 * card band (src/renderer/help/dock-band.ts), and the "Show the dock" pref's
 * read + live apply.
 */
import { describe, it, expect } from "vitest";
import {
  dockBand, searchTopFor, cardBandTop, dockEnabledFrom, applyDockEnabled,
  DOCK_ENABLED_PREF, DOCK_ENABLED_DEFAULT, DOCK_ENABLED_CHANGED_EVENT, DOCK_OFF_CLASS, DOCK_LABEL_REACH,
  SEARCH_TOP_NO_DOCK, SEARCH_GAP_UNDER_DOCK, CARD_BAND_MARGIN,
} from "../../src/renderer/help/dock-band.js";

const rect = (top: number, height: number, width = 500) => ({ top, bottom: top + height, height, width });

describe("dockBand — where the page starts under the dock", () => {
  it("measures the dock's bottom edge from the stage's top", () => {
    // Stage at 38 (under the desktop drag strip), dock row at 64..140.
    expect(dockBand({ enabled: true, tucked: false, rect: rect(64, 76), stageTop: 38 })).toBe(102);
    // Web: the stage at the very top.
    expect(dockBand({ enabled: true, tucked: false, rect: rect(26, 76), stageTop: 0 })).toBe(102);
  });
  it("reads a parked bar the same way — it is measured in viewport space, wherever it lives", () => {
    // Parked in the portal layer at 2px on web: the band is still its bottom.
    expect(dockBand({ enabled: true, tucked: false, rect: rect(2, 76), stageTop: 0 })).toBe(78);
  });
  it("is zero when the dock is turned off, whatever the DOM says", () => {
    expect(dockBand({ enabled: false, tucked: false, rect: rect(26, 76), stageTop: 0 })).toBe(0);
  });
  it("is zero for a tucked dock — off screen reserves nothing", () => {
    expect(dockBand({ enabled: true, tucked: true, rect: rect(-80, 76), stageTop: 0 })).toBe(0);
    expect(dockBand({ enabled: true, tucked: true, rect: rect(26, 76), stageTop: 0 })).toBe(0);
  });
  it("is zero without a dock, for a dock with no layout, and for one wholly above the stage", () => {
    expect(dockBand({ enabled: true, tucked: false, rect: null, stageTop: 0 })).toBe(0);
    expect(dockBand({ enabled: true, tucked: false, rect: rect(0, 0, 0), stageTop: 0 })).toBe(0);
    expect(dockBand({ enabled: true, tucked: false, rect: rect(26, 76, 0), stageTop: 0 })).toBe(0);
    expect(dockBand({ enabled: true, tucked: false, rect: rect(-100, 76), stageTop: 0 })).toBe(0);
  });
  it("rounds to whole pixels", () => {
    expect(dockBand({ enabled: true, tucked: false, rect: { top: 26.4, bottom: 102.6, height: 76.2, width: 500 }, stageTop: 0.2 })).toBe(102);
  });
});

describe("the pill and the card band follow the band", () => {
  it("centres the search pill under the dock, or sits it high with no dock", () => {
    expect(searchTopFor(102)).toBe(102 + SEARCH_GAP_UNDER_DOCK);
    expect(searchTopFor(0)).toBe(SEARCH_TOP_NO_DOCK);
    expect(SEARCH_TOP_NO_DOCK).toBe(18);
  });
  it("starts the cards under the dock's labels and zoom reach plus the panel margin", () => {
    // The row's bottom margin (24px + the zoom's share) is the reach the stylesheet reserves.
    expect(cardBandTop(102, 36.8)).toBe(Math.round(102 + 36.8 + CARD_BAND_MARGIN));
    // Never less than the labels, even when the row reports no margin.
    expect(cardBandTop(102, 0)).toBe(102 + DOCK_LABEL_REACH + CARD_BAND_MARGIN);
    expect(cardBandTop(102)).toBe(102 + DOCK_LABEL_REACH + CARD_BAND_MARGIN);
  });
  it("is just the margin with no dock — no dead strip above the panels", () => {
    expect(cardBandTop(0, 36.8)).toBe(CARD_BAND_MARGIN);
    expect(CARD_BAND_MARGIN).toBe(7);
  });
});

describe("the Show-the-dock preference", () => {
  it("is OFF by default — one constant, and every unset read lands on it (his order, 2026-10-04)", () => {
    expect(DOCK_ENABLED_DEFAULT).toBe(false);
    expect(dockEnabledFrom(undefined)).toBe(DOCK_ENABLED_DEFAULT);
    expect(dockEnabledFrom(null)).toBe(DOCK_ENABLED_DEFAULT);
    expect(dockEnabledFrom("")).toBe(DOCK_ENABLED_DEFAULT);
    expect(dockEnabledFrom("maybe")).toBe(DOCK_ENABLED_DEFAULT);
    expect(dockEnabledFrom({})).toBe(DOCK_ENABLED_DEFAULT);
    // A caller may name its own fallback; the unset read follows it.
    expect(dockEnabledFrom(undefined, true)).toBe(true);
  });
  it("keeps an explicit on — a member who turned the dock on keeps it", () => {
    expect(dockEnabledFrom(true)).toBe(true);
    expect(dockEnabledFrom("true")).toBe(true);
    expect(dockEnabledFrom(" TRUE ")).toBe(true);
    expect(dockEnabledFrom("on")).toBe(true);
    expect(dockEnabledFrom("yes")).toBe(true);
    expect(dockEnabledFrom(1)).toBe(true);
    expect(dockEnabledFrom("1")).toBe(true);
  });
  it("keeps an explicit off, whatever the fallback", () => {
    expect(dockEnabledFrom(false)).toBe(false);
    expect(dockEnabledFrom("false")).toBe(false);
    expect(dockEnabledFrom(0)).toBe(false);
    expect(dockEnabledFrom("off")).toBe(false);
    expect(dockEnabledFrom("no")).toBe(false);
    expect(dockEnabledFrom(false, true)).toBe(false);
  });
  it("names the shared pref, its event and its body class", () => {
    expect(DOCK_ENABLED_PREF).toBe("dockEnabled");
    expect(DOCK_ENABLED_CHANGED_EVENT).toBe("glyphh:dock-enabled-changed");
    expect(DOCK_OFF_CLASS).toBe("echo-dock-off");
  });
  it("applies live by flipping the body class, and reports a no-op for a repeated value", () => {
    const classes = new Set<string>();
    const body = { classList: {
      contains: (c: string) => classes.has(c),
      toggle: (c: string, force?: boolean) => { const on = force ?? !classes.has(c); if (on) classes.add(c); else classes.delete(c); return on; },
    } };
    expect(applyDockEnabled(body, false)).toBe(true);
    expect(classes.has(DOCK_OFF_CLASS)).toBe(true);
    expect(applyDockEnabled(body, false)).toBe(false);   // same value again: nothing to relayout
    expect(applyDockEnabled(body, true)).toBe(true);
    expect(classes.has(DOCK_OFF_CLASS)).toBe(false);
    expect(applyDockEnabled(body, true)).toBe(false);
  });
});
