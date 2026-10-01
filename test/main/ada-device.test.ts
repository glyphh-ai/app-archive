/**
 * This computer as an Ada device: once registered it keeps the socket up for
 * its records even with remote control off — the ada.* row store alone, no
 * folders — and it is the same device as the CLI on this machine.
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const home = mkdtempSync(join(tmpdir(), "glyphh-ada-desktop-"));
process.env.GLYPHH_HOME = home;

const started: Array<Record<string, unknown>> = [];
const registered: string[] = [];
let setting: unknown = null;

vi.mock("electron", () => ({ BrowserWindow: { fromWebContents: () => null }, dialog: {}, ipcMain: { handle: () => undefined } }));
vi.mock("better-sqlite3", () => {
  const sqlite = (process as unknown as { getBuiltinModule: (id: string) => { DatabaseSync: new (p: string) => object } }).getBuiltinModule("node:sqlite");
  return { default: function Database(path: string) { return new sqlite.DatabaseSync(path); } };
});
vi.mock("../../src/main/relay-client.js", () => ({ dispatchRelayMethod: async () => ({}) }));
vi.mock("../../src/main/attach-handlers.js", () => ({ gitStateOf: () => ({ isRepo: false }) }));
vi.mock("../../src/main/broadcast.js", () => ({ broadcast: () => undefined }));
vi.mock("../../src/main/stores/preferences-db.js", () => ({
  getPreference: () => setting, setPreference: (_k: string, v: unknown) => { setting = v; }, loadPreferences: async () => undefined,
}));
vi.mock("../../src/main/glyphh-client.js", () => ({
  SERVER_URL: "https://s",
  getClient: () => ({
    attach: { status: async () => ({ allowed: true }) },
    ada: { registerDevice: async (name: string) => { registered.push(name); return { device_id: "dev_0123456789ab", name }; } },
  }),
}));
vi.mock("../../src/main/attach-host.js", () => ({
  startAttach: (opts: Record<string, unknown>) => { started.push(opts); },
  stopAttach: () => undefined,
  attachStatus: () => ({ attached: started.length > 0, server: "https://s" }),
}));

const rc = await import("../../src/main/remote-control.js");
const device = await import("../../src/main/ada-device.js");

describe("the desktop as an Ada device", () => {
  it("stays off with neither remote control nor a device", async () => {
    await rc.remoteControlBoot();
    expect(started).toEqual([]);
    expect((await rc.remoteControlView()).ada).toBeNull();
  });

  it("registers once, beside the CLI's id, and serves only its records", async () => {
    const reg = await device.registerAdaDevice();
    expect(reg.device_id).toBe("dev_0123456789ab");
    expect(JSON.parse(readFileSync(join(home, "ada-device.json"), "utf8")).device_id).toBe("dev_0123456789ab");
    await device.registerAdaDevice();
    expect(registered).toHaveLength(1);

    rc.remoteControlStop();
    await rc.remoteControlBoot();
    const opts = started.at(-1)!;
    expect((opts.adaDevice as () => string)()).toBe("dev_0123456789ab");
    expect((opts.folders as () => string[])()).toEqual([]);
    const table = (opts.handlers as () => Record<string, (p: unknown) => Promise<unknown>>)();
    expect(Object.keys(table).sort()).toEqual(["ada.append", "ada.delete", "ada.drop", "ada.page", "ada.rows", "ada.update"]);
    await table["ada.append"]!({ model_id: "am_0123456789ab", row: { id: "r1", store: "wins", situation: { a: 1 }, outcome: "x", author: "pat", ts: 1 } });
    expect(await table["ada.rows"]!({ model_id: "am_0123456789ab", since: 0 })).toMatchObject({ max_seq: 1, rows: [{ id: "r1", situation: { a: 1 } }] });
    expect((await rc.remoteControlView()).ada).toEqual({ device_id: "dev_0123456789ab", name: registered[0] });
  });

  it("serves the remote table and the records together when remote control is on too", async () => {
    setting = { enabled: true, folders: [home] };
    rc.remoteControlStop();
    await rc.remoteControlBoot();
    const table = (started.at(-1)!.handlers as () => Record<string, unknown>)();
    expect(Object.keys(table)).toEqual(expect.arrayContaining(["relay.ping", "fs.list", "ada.rows"]));
  });
});
