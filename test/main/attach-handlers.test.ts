/**
 * attach-handlers.test.ts — the machine's relay handlers: a bundle install
 * into the cloud, the folder picker's browse, and NOTHING that reads data
 * off this machine (his order, 2026-10-06: the threads, the CLI sessions, the
 * workspaces and the app tabs are the server's; the relay drives a session).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const root = mkdtempSync(join(tmpdir(), "glyphh-attach-lib-"));
const handlers = new Map<string, (params: unknown) => Promise<unknown>>();

vi.mock("electron", () => ({ BrowserWindow: class {}, shell: { openExternal: async () => undefined } }));
vi.mock("../../src/main/relay-client.js", () => ({
  registerRelayHandler: (m: string, h: (params: unknown) => Promise<unknown>) => { handlers.set(m, h); },
}));
vi.mock("../../src/main/app-paths.js", () => ({ userScopedPath: (seg: string) => join(root, seg) }));
vi.mock("../../src/main/installed-apps.js", () => ({ listInstalledApps: () => [], findInstalledApp: () => null, launchInstalledApp: () => undefined }));
// The bundle install (glyphh-app-host.ts): a .glyphh becomes a cloud instance; pinned there, relayed here.
const bundleInstalls: Array<[string, string]> = [];
vi.mock("../../src/main/cli-agents.js", () => ({
  listCliSessions: () => [
    { id: "s-claude", cli: "claude", title: "fix the sync bug", cwd: "/Users/me/code/app", mtime: 20 },
    { id: "c-glyphh", cli: "glyphh", title: "triage", cwd: "", mtime: 10 },
  ],
}));
vi.mock("../../src/main/glyphh-app-host.js", () => ({
  installGlyphhAppBundle: async (path: string) => { bundleInstalls.push(["path", path]); return { ok: true, name: "Recall", connectors: ["slack"], instance: "recall~u1", tools: [{ name: "ask", description: "" }] }; },
  installGlyphhAppBundleFromBase64: async (b64: string) => { bundleInstalls.push(["base64", b64]); return { ok: true, name: "Recall", updated: true, instance: "recall~u1", tools: [] }; },
}));
beforeAll(async () => {
  const { installAttachHandlers } = await import("../../src/main/attach-handlers.js");
  installAttachHandlers();
});

describe("the machine's relay handlers", () => {
  it("reads no record off this machine: no sessions.*, layouts.*, panelApps.list (his order, 2026-10-06)", () => {
    for (const m of ["sessions.list", "sessions.get", "sessions.put", "sessions.delete", "layouts.list", "layouts.get", "layouts.save", "panelApps.list"]) expect(handlers.has(m)).toBe(false);
    for (const m of ["apps.install", "fs.list", "fs.gitInfo", "fs.mkdir", "machine.appsList", "scrape.page", "cliSessions.list"]) expect(handlers.has(m)).toBe(true);
  });

  it("cliSessions.list hands the web the vendor CLIs' sessions with their resume handles — the one read that rides the relay (his order, 2026-10-07)", async () => {
    const { sessions } = (await handlers.get("cliSessions.list")!({})) as { sessions: Array<Record<string, unknown>> };
    expect(sessions).toEqual([
      { id: "s-claude", cli: "claude", title: "fix the sync bug", cwd: "/Users/me/code/app", mtime: 20, updatedAt: 20, resume: "s-claude" },
      { id: "c-glyphh", cli: "glyphh", title: "triage", cwd: "", mtime: 10, updatedAt: 10, resume: "c-glyphh" },
    ]);
  });

  it("apps.install takes a .glyphh bundle into the cloud — the local MCP's app_install — and nothing else (a hub item installs through hub-ipc, never the relay)", async () => {
    const h = handlers.get("apps.install")!;
    expect(await h({ bundleBase64: "UEs=" })).toEqual({ installed: "Recall", instance: "recall~u1", updated: true, requiredConnections: [], tools: [] });
    expect(bundleInstalls).toEqual([["base64", "UEs="]]);
    await expect(h({ path: "/nowhere/app.glyphh" })).rejects.toThrow(/bundle not found/);
    await expect(h({ itemId: "pub-9", from: "glyphh" })).rejects.toThrow(/requires \{ path \}/);
    await expect(h({})).rejects.toThrow(/requires \{ path \}/);
  });

  it("the apps' tools never ride the relay: an app is a cloud instance, listed and run by the gateway (his order, 2026-10-06)", () => {
    expect(handlers.has("apps.listTools")).toBe(false);
    expect(handlers.has("apps.callTool")).toBe(false);
  });
});
