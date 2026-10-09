import { describe, it, expect } from "vitest";
import {
  clampTilesPerRow, clampWallWidth, clampRailTabsPerRow,
  railTabsTrack, railTabsLabel,
  TILES_PER_ROW_DEFAULT, WALL_WIDTH_DEFAULT, RAIL_TABS_AUTO,
  RAIL_SHOW_DEFAULT, railTrayShown,
} from "../../src/renderer/help/wall-prefs.js";

describe("the sidebar trays' option (his order, 2026-10-08)", () => {
  it("is on by default, and only an explicit false puts a tray away", () => {
    expect(RAIL_SHOW_DEFAULT).toBe(true);
    expect(railTrayShown(undefined)).toBe(true);
    expect(railTrayShown(null)).toBe(true);
    expect(railTrayShown(true)).toBe(true);
    expect(railTrayShown(false)).toBe(false);
  });
});

describe("wall-prefs", () => {
  it("clamps tiles per row into its slider's range", () => {
    expect(clampTilesPerRow(8)).toBe(8);
    expect(clampTilesPerRow(1)).toBe(3);
    expect(clampTilesPerRow(99)).toBe(14);
  });

  it("falls back to the shipped column count when the pref is junk", () => {
    // An unset pref reads undefined, and a server that ever hands back a
    // string must not become NaN columns — that drops the whole track list.
    expect(clampTilesPerRow(undefined)).toBe(TILES_PER_ROW_DEFAULT);
    expect(clampTilesPerRow("wide")).toBe(TILES_PER_ROW_DEFAULT);
    expect(clampTilesPerRow(null)).toBe(TILES_PER_ROW_DEFAULT);
  });

  it("clamps wall width to 0..100", () => {
    expect(clampWallWidth(0)).toBe(0);
    expect(clampWallWidth(100)).toBe(100);
    expect(clampWallWidth(-20)).toBe(0);
    expect(clampWallWidth(140)).toBe(100);
    expect(clampWallWidth(undefined)).toBe(WALL_WIDTH_DEFAULT);
  });

  it("defaults wall width to the natural cap, so an untouched app looks unchanged", () => {
    expect(WALL_WIDTH_DEFAULT).toBe(0);
  });

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
    expect(clampTilesPerRow(7.6)).toBe(8);
    expect(railTabsTrack(2.4)).toBe("2");
  });
});
