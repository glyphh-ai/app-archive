/**
 * settings-devices.test.ts — Settings → Devices reads ONE row shape off
 * either answer (his order, 2026-10-04): the server's /api/attach/devices
 * (machines + the ones disconnected from the web) or, until it lands,
 * attach.status's machines.
 */
import { describe, expect, it } from "vitest";
import { deviceRowsOf } from "../../src/renderer/help/devices-rows";

describe("the devices rows", () => {
  it("reads the /api/attach/devices answer: the machine id for Disconnect, the stable device key for Allow", () => {
    const { devices, blocked } = deviceRowsOf({
      source: "devices", allowed: true,
      devices: [{ id: "d12abc", app: "glyphh-desktop", version: "1.4.11", name: "chris-mbp", since: 1_759_600_000, capabilities: ["sessions.list"], folders: ["/Users/me/code"], inst: "fly-1", device: "dev-key-1", remote: true }],
      blocked: [{ device: "dev-key-2", app: "glyphh-cli", name: "chris-linux", disconnectedAt: 1_759_600_100 }],
    });
    expect(devices).toEqual([{
      machineId: "d12abc", device: "dev-key-1", name: "chris-mbp", app: "glyphh-desktop", version: "1.4.11",
      since: 1_759_600_000_000, capabilities: ["sessions.list"], folders: ["/Users/me/code"], remote: true,
    }]);
    expect(blocked).toEqual([{ device: "dev-key-2", name: "chris-linux", app: "glyphh-cli", disconnectedAt: 1_759_600_100_000 }]);
  });

  it("reads attach.status's machines the same way, with no blocked list", () => {
    const { devices, blocked } = deviceRowsOf({
      source: "status",
      devices: [{ id: "m1", app: "glyphh-desktop", version: "1.4.9", capabilities: [], since: 1_759_600_000_000 }],
      blocked: [],
    });
    expect(devices).toEqual([{ machineId: "m1", device: "", name: "glyphh-desktop", app: "glyphh-desktop", version: "1.4.9", since: 1_759_600_000_000, capabilities: [], folders: [], remote: false }]);
    expect(blocked).toEqual([]);
  });

  it("drops rows with neither a machine id nor a device key", () => {
    expect(deviceRowsOf({ source: "devices", devices: [{ name: "ghost" }], blocked: [{ name: "ghost" }] })).toEqual({ devices: [], blocked: [] });
  });
});
