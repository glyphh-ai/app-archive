import { describe, expect, it } from "vitest";
import { deviceChecked, devicesForRun, toggleDeviceIn, selfMachineId, foldersForRun, folderSteerLine } from "../../src/renderer/help/devices-pick.js";

describe("the desktop is its own device (his report, 2026-10-07)", () => {
  // `device` is the server's hash of app + hostname (attach.py device_key); the name is the hostname.
  const rows = [{ machineId: "m-1", device: "3f9a0c1d2e4b5a69", name: "Christophers-Mac-Studio.local" }, { machineId: "m-2", device: "77aa0c1d2e4b5a00", name: "laptop.local" }];
  it("finds this machine's row by its host name, case-blind; none when not attached", () => {
    expect(selfMachineId(rows, "christophers-mac-studio.local")).toBe("m-1");
    expect(selfMachineId(rows, "other.local")).toBeNull();
    expect(selfMachineId(rows, "")).toBeNull();
  });
  it("the turn's own folder rides for this machine only on the desktop, only when the turn names it, absolute, trimmed", () => {
    expect(foldersForRun({ surface: "desktop", folder: "/Users/me/dev/happy-shoes/", selfId: "m-1", devices: ["m-1", "m-2"] })).toEqual({ "m-1": ["/Users/me/dev/happy-shoes"] });
    expect(foldersForRun({ surface: "desktop", folder: "/Users/me/dev", selfId: "m-1", devices: ["m-2"] })).toEqual({});
    expect(foldersForRun({ surface: "web", folder: "/Users/me/dev", selfId: "m-1", devices: ["m-1"] })).toEqual({});
    expect(foldersForRun({ surface: "desktop", folder: "dev", selfId: "m-1", devices: ["m-1"] })).toEqual({});
    expect(foldersForRun({ surface: "desktop", folder: "/Users/me/dev", selfId: null, devices: ["m-1"] })).toEqual({});
  });
  it("the steer says the device is off for this session when the member has not checked it", () => {
    expect(folderSteerLine("/w", "Mac", true, false)).toMatch(/not turned on for this session.*\+ → Devices/);
    expect(folderSteerLine("/w", "Mac", true, true)).toMatch(/reachable now/);
  });
  it("the steer names the folder and the device tools, or says remote control is off; never a Terminal", () => {
    const on = folderSteerLine("/Users/me/dev/happy-shoes", "mac.local", true);
    expect(on).toContain("/Users/me/dev/happy-shoes");
    expect(on).toContain("device_read_file");
    expect(on).toContain("Terminal panel is not a tool");
    const off = folderSteerLine("/Users/me/dev/happy-shoes", "mac.local", false);
    expect(off).toContain("remote control is off");
    expect(off).toContain("Settings → System → Remote control");
    expect(folderSteerLine("", "mac.local", true)).toBe("");
  });
});

describe("which devices a session reaches (his order, 2026-10-07)", () => {
  it("no device is on by itself (his report, 2026-10-07); the session's own list is the truth", () => {
    expect(deviceChecked(undefined, "m1")).toBe(false);
    expect(deviceChecked([], "m1")).toBe(false);
    expect(deviceChecked(["m2"], "m1")).toBe(false);
    expect(deviceChecked(["m1"], "m1")).toBe(true);
  });
  it("the first check starts the list with that one device; the next flips it", () => {
    expect(toggleDeviceIn(undefined, "m1", ["m1", "m2"])).toEqual(["m1"]);
    expect(toggleDeviceIn(["m2"], "m1", ["m1", "m2"])).toEqual(["m2", "m1"]);
    expect(toggleDeviceIn(["m2", "m1"], "m1", ["m1", "m2"])).toEqual(["m2"]);
  });
  it("the run names the session's list, none by default; a device gone from the relay is dropped", () => {
    expect(devicesForRun(undefined, ["m1", "m2"])).toEqual([]);
    expect(devicesForRun(["m2"], ["m1", "m2"])).toEqual(["m2"]);
    expect(devicesForRun(["m9"], ["m1"])).toEqual([]);
    expect(devicesForRun(undefined, [])).toEqual([]);
  });
});
