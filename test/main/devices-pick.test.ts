import { describe, expect, it } from "vitest";
import { deviceChecked, devicesForRun, toggleDeviceIn } from "../../src/renderer/help/devices-pick.js";

describe("which devices a session reaches (his order, 2026-10-07)", () => {
  it("an attached device is checked by default; the session's own list wins once it exists", () => {
    expect(deviceChecked(undefined, "m1")).toBe(true);
    expect(deviceChecked([], "m1")).toBe(false);
    expect(deviceChecked(["m2"], "m1")).toBe(false);
    expect(deviceChecked(["m1"], "m1")).toBe(true);
  });
  it("the first toggle materialises the default from the attached set, then flips the one id", () => {
    expect(toggleDeviceIn(undefined, "m1", ["m1", "m2"])).toEqual(["m2"]);
    expect(toggleDeviceIn(["m2"], "m1", ["m1", "m2"])).toEqual(["m2", "m1"]);
    expect(toggleDeviceIn(["m2", "m1"], "m1", ["m1", "m2"])).toEqual(["m2"]);
  });
  it("the run names the session's list, else every attached device; a device gone from the relay is dropped", () => {
    expect(devicesForRun(undefined, ["m1", "m2"])).toEqual(["m1", "m2"]);
    expect(devicesForRun(["m2"], ["m1", "m2"])).toEqual(["m2"]);
    expect(devicesForRun(["m9"], ["m1"])).toEqual([]);
    expect(devicesForRun(undefined, [])).toEqual([]);
  });
});
