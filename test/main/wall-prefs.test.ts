import { describe, it, expect } from "vitest";
import {
  clampRailTabsPerRow,
  railTabsTrack, railTabsLabel,
  RAIL_TABS_AUTO,
  RAIL_SHOW_DEFAULT, railTrayShown,
} from "../../src/renderer/help/wall-prefs.js";

describe("the sidebar trays' option (his order, 2026-10-08)", () => {
  it("is off by default, and only an explicit true shows a tray", () => {
    expect(RAIL_SHOW_DEFAULT).toBe(false);
    expect(railTrayShown(undefined)).toBe(false);
    expect(railTrayShown(null)).toBe(false);
    expect(railTrayShown(false)).toBe(false);
    expect(railTrayShown(true)).toBe(true);
  });
});

describe("wall-prefs", () => {

  it("keeps rail tabs on Auto by default", () => {
    // The tray shipped as auto-fill; picking a number for every rail width
    // would change the look for everyone who never touched the slider.
    expect(clampRailTabsPerRow(undefined)).toBe(RAIL_TABS_AUTO);
    expect(railTabsTrack(undefined)).toBe("auto-fill");
    expect(railTabsLabel(undefined)).toBe("Auto");
  });

  it("renders Auto as the auto-fill KEYWORD, never a numeric 0", () => {
    // repeat(0, …) is an invalid track count: the declaration would be
    // dropped and the tray would collapse to one column.
    expect(railTabsTrack(0)).toBe("auto-fill");
    expect(railTabsTrack(-3)).toBe("auto-fill");
  });

  it("passes a chosen rail count straight through", () => {
    expect(railTabsTrack(3)).toBe("3");
    expect(railTabsLabel(3)).toBe("3");
    expect(railTabsTrack(9)).toBe("6");
  });

  it("rounds fractional prefs — a track count must be a whole number", () => {
    expect(railTabsTrack(2.4)).toBe("2");
  });
});
