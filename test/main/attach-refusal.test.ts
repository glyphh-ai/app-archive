/**
 * attach-refusal.test.ts — what the desktop does with a 4403 (his order,
 * 2026-10-04): the SDK's attach host has stopped reconnecting; the org's
 * switch leaves this device's setting alone, while a disconnect from the web
 * (Settings → Devices → Disconnect) turns the switch OFF and the Remote
 * control page says the server's words plus the way back.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: { fromWebContents: () => null }, dialog: {}, ipcMain: { handle: () => undefined } }));
vi.mock("../../src/main/relay-client.js", () => ({ dispatchRelayMethod: async () => ({}) }));
vi.mock("../../src/main/attach-handlers.js", () => ({ gitStateOf: () => ({ isRepo: false }) }));
vi.mock("../../src/main/glyphh-client.js", () => ({ getClient: () => ({}) }));
vi.mock("../../src/main/broadcast.js", () => ({ broadcast: () => undefined }));
vi.mock("../../src/main/stores/preferences-db.js", () => ({ getPreference: () => null, setPreference: () => undefined, loadPreferences: async () => undefined }));
vi.mock("../../src/main/relay-pty.js", () => ({ killAllRelayPtys: () => undefined }));

const { afterRefusal, ORG_OFF } = await import("../../src/main/remote-control.js");

const on = { enabled: true, folders: ["/Users/me/code"] };

describe("a 4403 at the attach socket", () => {
  it("the org's switch: the setting stays, the page says the server's reason", () => {
    expect(afterRefusal(ORG_OFF, on)).toEqual({ setting: on, refused: ORG_OFF });
  });

  it("a disconnect from the web: this device's switch goes off and the page says why and how to come back", () => {
    const reason = "stopped from the app: allow this device under Settings, Devices, then turn remote control on again";
    const r = afterRefusal(reason, on);
    expect(r.setting).toEqual({ enabled: false, folders: ["/Users/me/code"] });
    expect(r.refused).toContain(reason);
    expect(r.refused).toContain("turn remote control on to attach again");
  });

  it("a refusal with no words still reads as a disconnect from the web", () => {
    const r = afterRefusal("", on);
    expect(r.setting.enabled).toBe(false);
    expect(r.refused).toBe("disconnected from the web — turn remote control on to attach again");
  });
});
