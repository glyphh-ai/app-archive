/**
 * remote-control.test.ts — the desktop's remote door over a real temp folder:
 * only the remote-safe methods, every path inside a granted folder (no sibling
 * prefix, no .., no symlink out), the picker starting at the granted roots,
 * and a turn's folder checked before the registry ever sees it.
 */
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const trashed: string[] = [];
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => null }, dialog: {}, ipcMain: { handle: () => undefined },
  app: { getPath: () => "/tmp" }, shell: { trashItem: async (p: string) => { trashed.push(p); } },
}));
vi.mock("../../src/main/relay-client.js", () => ({ dispatchRelayMethod: async () => ({}), registerRelayHandler: () => undefined, pushLocal: () => undefined }));
vi.mock("../../src/main/attach-handlers.js", () => ({ gitStateOf: (d: string) => ({ isRepo: d.endsWith("repo") }) }));
vi.mock("../../src/main/glyphh-client.js", () => ({ getClient: () => ({}) }));
vi.mock("../../src/main/broadcast.js", () => ({ broadcast: () => undefined }));
vi.mock("../../src/main/stores/preferences-db.js", () => ({
  getPreference: () => null, setPreference: () => undefined, loadPreferences: async () => undefined,
  preferencesByPrefix: () => ({}),
}));
vi.mock("../../src/main/relay-pty.js", () => ({ killAllRelayPtys: () => undefined }));
vi.mock("../../src/main/glyphh-app-builder.js", () => ({ r2DiffWorkdir: async () => ({ status: null, text: "" }), appDirInWorkdir: (p: string) => p }));
// The desktop's own working folder: OUTSIDE the grant, so the door must never hand it out.
let desktopCwd = "/";
vi.mock("../../src/main/working-directory.js", async (orig) => ({ ...(await orig<typeof import("../../src/main/working-directory.js")>()), getWorkingDirectory: () => desktopCwd, getExplicitWorkingDirectory: () => desktopCwd }));

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
  trashed.length = 0;
  desktopCwd = root;
});

describe("the desktop's remote door", () => {
  it("serves the remote-safe methods and nothing else", () => {
    expect(Object.keys(table()).sort()).toEqual([
      "agent.answer", "agent.frames", "agent.permission", "agent.run", "agent.stop",
      "fs.cwd", "fs.delete", "fs.gitDiff", "fs.gitInfo", "fs.list", "fs.listDir", "fs.mkdir", "fs.r2Diff", "fs.read", "fs.rename", "fs.search", "fs.unwatch", "fs.watch", "fs.write",
      "git.status",
      "layouts.open",
      "panel.clipboard", "panel.close", "panel.input", "panel.nav", "panel.open", "panel.stats", "panel.webrtc",
      "panels.close", "panels.list", "panels.open", "panels.switch",
      "pty.close", "pty.input", "pty.open", "pty.resize",
      "relay.ping",
      "settings.open",
    ]);
  });

  it("carries no data read: the threads, the CLI sessions, the workspaces and the app tabs are the server's (his order, 2026-10-06)", () => {
    const t = table();
    for (const m of ["sessions.list", "sessions.get", "sessions.put", "sessions.delete", "cliSessions.list", "layouts.list", "layouts.get", "panelApps.list"]) expect(t[m]).toBeUndefined();
  });

  it("opens a web terminal only inside a granted folder (the first grant by default)", async () => {
    const t = table();
    await expect(t["pty.open"]!({ cols: 80, rows: 24, cwd: join(root, "secret") })).rejects.toThrow(/not one this machine granted/);
    await expect(t["pty.open"]!({ cols: 80, rows: 24, cwd: "/etc" })).rejects.toThrow(/not one this machine granted/);
    expect(calls).toEqual([]);
    await t["pty.open"]!({ cols: 80, rows: 24 });
    await t["pty.open"]!({ cols: 80, rows: 24, cwd: join(granted, "repo") });
    expect(calls).toEqual([
      { m: "pty.open", p: { cols: 80, rows: 24, cwd: granted } },
      { m: "pty.open", p: { cols: 80, rows: 24, cwd: join(granted, "repo") } },
    ]);
    // No grant at all → no shell, ever.
    const bare = remoteTable(() => [], async (m, p) => { calls.push({ m, p }); return {}; });
    await expect(bare["pty.open"]!({ cols: 80, rows: 24 })).rejects.toThrow(/not one this machine granted/);
    // Input/resize/close name a pty this door opened — straight through.
    await t["pty.input"]!({ ptyId: "pty-1", data: "ls\r" });
    await t["pty.close"]!({ ptyId: "pty-1" });
    expect(calls.slice(2).map((c) => c.m)).toEqual(["pty.input", "pty.close"]);
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
    expect(calls).toEqual([]);
    await t["agent.run"]!({ prompt: "x", mode: "code", workdir: join(granted, "repo") });
    await t["agent.run"]!({ prompt: "y", mode: "work" });
    expect(calls.map((c) => c.m)).toEqual(["agent.run", "agent.run"]);
  });
});

// ── THE FILE AND GIT DOORS (his report, 2026-10-05) ───────────────────────────
describe("the file and git doors — the folder is the sandbox, reads too", () => {
  const file = () => join(granted, "repo", "a.ts");
  beforeEach(() => { writeFileSync(file(), "export const a = 1;\n"); writeFileSync(join(root, "secret", "key.pem"), "PRIVATE"); });

  it("reads, searches and lists inside a granted folder, and refuses outside — before any disk access", async () => {
    const t = table();
    expect(await t["fs.read"]!({ path: file() })).toEqual({ content: "export const a = 1;\n" });
    expect((await t["fs.listDir"]!({ dir: join(granted, "repo") }) as { entries: Array<{ name: string }> }).entries.map((e) => e.name)).toEqual(["a.ts"]);
    expect((await t["fs.search"]!({ dir: granted, query: "a.t" }) as { entries: Array<{ rel: string }> }).entries.map((e) => e.rel)).toEqual([join("repo", "a.ts")]);
    for (const bad of [join(root, "secret", "key.pem"), "/etc/passwd", join(granted, "..", "secret", "key.pem"), `${granted}-x/a.ts`]) {
      await expect(t["fs.read"]!({ path: bad })).rejects.toThrow(/not one this machine granted/);
    }
    await expect(t["fs.listDir"]!({ dir: join(root, "secret") })).rejects.toThrow(/not one this machine granted/);
    await expect(t["fs.search"]!({ dir: root, query: "key" })).rejects.toThrow(/not one this machine granted/);
    await expect(t["fs.read"]!({})).rejects.toThrow(/requires a string/);
    expect(calls).toEqual([]);
  });

  it("refuses a binary honestly and keeps the 2 MB write cap", async () => {
    const t = table();
    writeFileSync(join(granted, "repo", "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a]));
    expect(await t["fs.read"]!({ path: join(granted, "repo", "pic.png") })).toEqual({ content: "", error: expect.stringMatching(/binary/) });
    await expect(t["fs.write"]!({ path: file(), content: "x".repeat(2_000_001) })).rejects.toThrow(/too large/);
    expect(readFileSync(file(), "utf8")).toBe("export const a = 1;\n");
  });

  it("writes, renames and deletes inside the grant only; delete goes to the OS trash", async () => {
    const t = table();
    expect(await t["fs.write"]!({ path: join(granted, "repo", "b.ts"), content: "b" })).toEqual({ ok: true });
    expect(readFileSync(join(granted, "repo", "b.ts"), "utf8")).toBe("b");
    await expect(t["fs.write"]!({ path: join(root, "secret", "evil.sh"), content: "x" })).rejects.toThrow(/not one this machine granted/);
    expect(existsSync(join(root, "secret", "evil.sh"))).toBe(false);
    expect(await t["fs.rename"]!({ path: join(granted, "repo", "b.ts"), to: join(granted, "repo", "c.ts") })).toEqual({ ok: true });
    expect(existsSync(join(granted, "repo", "c.ts"))).toBe(true);
    // Neither end may leave the grant — a move OUT is a leak, a move IN an overwrite.
    await expect(t["fs.rename"]!({ path: join(granted, "repo", "c.ts"), to: join(root, "secret", "c.ts") })).rejects.toThrow(/not one this machine granted/);
    await expect(t["fs.rename"]!({ path: join(root, "secret", "key.pem"), to: join(granted, "repo", "key.pem") })).rejects.toThrow(/not one this machine granted/);
    expect(existsSync(join(granted, "repo", "c.ts"))).toBe(true);
    expect(await t["fs.delete"]!({ path: join(granted, "repo", "c.ts") })).toEqual({ ok: true });
    expect(trashed).toEqual([join(granted, "repo", "c.ts")]);
    await expect(t["fs.delete"]!({ path: join(root, "secret", "key.pem") })).rejects.toThrow(/not one this machine granted/);
    expect(trashed).toHaveLength(1);
  });

  it("serves git status and the diff of a granted repo, one file or all, and says when it is not a repo", async () => {
    const t = table();
    const repo = join(granted, "repo");
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "."], { cwd: repo });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "one"], { cwd: repo });
    writeFileSync(join(repo, "a.ts"), "export const a = 2;\n");
    writeFileSync(join(repo, "new.ts"), "new\n");
    const st = await t["git.status"]!({ path: repo }) as { branch?: string; entries: Array<{ status: string; path: string }> };
    expect(st.branch).toBe("main");
    expect(st.entries).toEqual([{ status: " M", path: "a.ts" }, { status: "??", path: "new.ts" }]);
    const all = (await t["fs.gitDiff"]!({ root: repo }) as { text: string }).text;
    expect(all).toContain("-export const a = 1;");
    expect(all).toContain("+new");
    const one = (await t["fs.gitDiff"]!({ root: repo, file: "a.ts" }) as { text: string }).text;
    expect(one).toContain("+export const a = 2;");
    expect(one).not.toContain("new.ts");
    await expect(t["fs.gitDiff"]!({ root: repo, file: "../../secret/key.pem" })).rejects.toThrow(/not one this machine granted/);
    expect(await t["git.status"]!({ path: granted })).toEqual({ entries: [], error: "not a git repo" });
    await expect(t["git.status"]!({ path: root })).rejects.toThrow(/not one this machine granted/);
  });

  it("never names a folder outside the grant as the cwd", async () => {
    const t = table();
    // The desktop works in the temp root, which is NOT granted: the first grant answers instead.
    expect(await t["fs.cwd"]!({})).toEqual({ cwd: granted, explicit: granted });
    desktopCwd = join(granted, "repo");
    expect(await t["fs.cwd"]!({})).toEqual({ cwd: join(granted, "repo"), explicit: join(granted, "repo") });
    expect(await t["fs.watch"]!({ channel: "fsw-1" })).toEqual({ watching: true, cwd: join(granted, "repo") });
    expect(await t["fs.unwatch"]!({ channel: "fsw-1" })).toEqual({ watching: false, had: true });
  });
});
