/**
 * host-tools.test.ts — Glyphh's own tools ride in the loop, no MCP server
 * (his order, 2026-10-09: "it is our own agent loop, why do we need an mcp
 * server to reach our own shit?"). The same tools, the same shapes, the
 * unattended filter, answers (text and images) as the loop's catalog reads them.
 */
import { describe, expect, it, vi } from "vitest";
const { root } = vi.hoisted(() => ({ root: (require("node:fs") as typeof import("node:fs")).mkdtempSync((require("node:path") as typeof import("node:path")).join((require("node:os") as typeof import("node:os")).tmpdir(), "glyphh-host-")) }));
vi.mock("electron", () => ({ app: { getPath: () => root, isPackaged: false, getVersion: () => "0.0.0" }, BrowserWindow: class { static getAllWindows() { return []; } static fromWebContents() { return null; } }, dialog: {}, ipcMain: { handle: () => undefined, on: () => undefined }, shell: {}, safeStorage: { isEncryptionAvailable: () => false }, screen: {}, nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, webContents: { getAllWebContents: () => [] }, net: {} }));
vi.mock("../../src/main/relay-client.js", () => ({ dispatchRelayMethod: async (method: string) => (method === "boom" ? Promise.reject(new Error("no")) : { ok: true, method }) }));

import { UNATTENDED_HIDDEN } from "../../src/main/unattended-tools.js";

describe("Glyphh's tools, in process", () => {
  it("are all there, each with a JSON input schema and no server behind them", async () => {
    const { hostTools } = await import("../../src/main/host-tools.js");
    const all = hostTools();
    const names = all.map((t) => t.name);
    expect(all.length).toBeGreaterThan(50);
    for (const want of ["skill_save", "skill_get", "panels_open", "panels_list", "schedule_save", "agents_list"]) expect(names, want).toContain(want);
    expect(new Set(names).size).toBe(names.length);
    for (const t of all) expect(t.inputSchema.type, t.name).toBe("object");
  });
  it("leave the screen-touching ones out of an unattended run", async () => {
    const { hostTools } = await import("../../src/main/host-tools.js");
    const names = hostTools({ unattended: true }).map((t) => t.name);
    for (const hidden of UNATTENDED_HIDDEN) expect(names).not.toContain(hidden);
    expect(names).toContain("skill_get");
  });
  it("refuse bad input in words and run through the same dispatcher the relay uses", async () => {
    const { hostTools } = await import("../../src/main/host-tools.js");
    const list = hostTools().find((t) => t.name === "panels_list")!;
    const r = await list.run({});
    expect(r.failed).toBe(false);
    expect(r.text).toContain("panels.list");
    const open = hostTools().find((t) => t.name === "panels_open")!;
    const bad = await open.run({ app: 42 });
    expect(bad.failed).toBe(true);
    expect(bad.text).toMatch(/^Error: /);
  });
});
