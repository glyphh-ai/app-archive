/**
 * remote-control.test.ts — the desktop's remote door over a real temp folder:
 * only the remote-safe methods, every path inside a granted folder (no sibling
 * prefix, no .., no symlink out), the picker starting at the granted roots,
 * and a turn's folder checked before the registry ever sees it.
 */
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: { fromWebContents: () => null }, dialog: {}, ipcMain: { handle: () => undefined } }));
vi.mock("../../src/main/relay-client.js", () => ({ dispatchRelayMethod: async () => ({}) }));
vi.mock("../../src/main/attach-handlers.js", () => ({ gitStateOf: (d: string) => ({ isRepo: d.endsWith("repo") }) }));
vi.mock("../../src/main/glyphh-client.js", () => ({ getClient: () => ({}) }));
vi.mock("../../src/main/broadcast.js", () => ({ broadcast: () => undefined }));
vi.mock("../../src/main/stores/preferences-db.js", () => ({ getPreference: () => null, setPreference: () => undefined, loadPreferences: async () => undefined }));

const { inGranted, remoteTable } = await import("../../src/main/remote-control.js");

let root: string;
let granted: string;
let calls: Array<{ m: string; p: unknown }>;
const table = () => remoteTable(() => [granted], async (m, p) => { calls.push({ m, p }); return { ok: m }; });

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "glyphh-rc-desk-")));
  granted = join(root, "code");
  mkdirSync(join(granted, "repo"), { recursive: true });
  mkdirSync(join(root, "secret"));
  calls = [];
});

describe("the desktop's remote door", () => {
  it("serves the remote-safe methods and nothing else", () => {
    expect(Object.keys(table()).sort()).toEqual([
      "agent.answer", "agent.frames", "agent.permission", "agent.run", "agent.stop",
      "fs.gitInfo", "fs.list", "fs.mkdir", "relay.ping",
      "sessions.delete", "sessions.get", "sessions.list", "sessions.put",
    ]);
  });

  it("keeps every path inside a granted folder", () => {
    symlinkSync(join(root, "secret"), join(granted, "escape"));
    expect(inGranted(join(granted, "repo"), [granted])).toBe(true);
    expect(inGranted(`${granted}-x`, [granted])).toBe(false);
    expect(inGranted(join(granted, "..", "secret"), [granted])).toBe(false);
    expect(inGranted(join(granted, "escape"), [granted])).toBe(false);
  });

  it("browses from the granted roots down, never above", async () => {
    const t = table();
    expect(await t["fs.list"]!({})).toEqual({ path: "", parent: null, entries: [{ name: "code", path: granted, dir: true, git: false }] });
    expect(await t["fs.list"]!({ path: granted })).toEqual({ path: granted, parent: null, entries: [{ name: "repo", path: join(granted, "repo"), dir: true, git: false }] });
    expect((await t["fs.list"]!({ path: join(granted, "repo") }) as { parent: string }).parent).toBe(granted);
    await expect(t["fs.list"]!({ path: root })).rejects.toThrow(/not one this machine granted/);
    await expect(t["fs.mkdir"]!({ path: granted, name: ".." })).rejects.toThrow(/a folder name/);
  });

  it("checks a turn's folder before the registry sees it", async () => {
    const t = table();
    await expect(t["agent.run"]!({ prompt: "x", workdir: join(root, "secret") })).rejects.toThrow(/not one this machine granted/);
    await expect(t["sessions.put"]!({ id: "c", workdir: "/etc" })).rejects.toThrow(/not one this machine granted/);
    expect(calls).toEqual([]);
    await t["agent.run"]!({ prompt: "x", mode: "code", workdir: join(granted, "repo") });
    await t["agent.run"]!({ prompt: "y", mode: "work" });
    expect(calls.map((c) => c.m)).toEqual(["agent.run", "agent.run"]);
  });
});
