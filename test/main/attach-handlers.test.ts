/**
 * attach-handlers.test.ts — the Customize libraries over the attach socket
 * (his report, 2026-10-04: "none of my workspaces, app tabs, etc. are showing
 * on the web"). A workspace is a folder under ~/.glyphh/workspaces and an app
 * tab a row the local apps store holds — this machine's files, never the
 * server's — so layouts.list / layouts.get / panelApps.list hand the web the
 * SAME rows the desktop's own layouts-list / panel-apps-list IPC hand the
 * renderer. Real layout manager over a temp folder; the apps read is the
 * org-apps projection, mocked at its seam.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
vi.mock("../../src/main/agent-ipc.js", () => ({
  listStoredChats: () => [], getStoredChat: () => undefined, upsertStoredChat: () => ({ id: "c" }), deleteStoredChat: () => false,
}));
const TAB = { id: "crm", orgId: "", createdBy: "", name: "CRM", slug: "crm", system: false, url: "https://crm.example", isBrowser: true, execPath: null, appArchetype: "web", launchConfig: null, access: "members", owned: true, latestVersion: null, version: "", secretNames: [], requiredConnections: [], connectionIds: [], iconUrl: null, listing: null, mcp: null, commands: {}, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
vi.mock("../../src/main/org-apps.js", () => ({ fetchOrgApps: async () => [TAB] }));
// The bundle install (glyphh-app-host.ts): a .glyphh becomes a cloud instance; pinned there, relayed here.
const bundleInstalls: Array<[string, string]> = [];
vi.mock("../../src/main/glyphh-app-host.js", () => ({
  installGlyphhAppBundle: async (path: string) => { bundleInstalls.push(["path", path]); return { ok: true, name: "Recall", connectors: ["slack"], instance: "recall~u1", tools: [{ name: "ask", description: "" }] }; },
  installGlyphhAppBundleFromBase64: async (b64: string) => { bundleInstalls.push(["base64", b64]); return { ok: true, name: "Recall", updated: true, instance: "recall~u1", tools: [] }; },
}));
vi.mock("../../src/main/cli-agents.js", () => ({
  listCliSessions: () => [
    { id: "s-claude", cli: "claude", title: "fix the sync bug", cwd: "/Users/me/code/app", mtime: 20 },
    { id: "c-glyphh", cli: "glyphh", title: "triage", cwd: "", mtime: 10 },
  ],
}));

const GRID = {
  name: "Research", version: 2, cols: 2, rows: 1, colWidths: [0.5, 0.5], rowHeights: [1],
  cells: [
    { panelId: "tool:coding", col: 0, row: 0, colSpan: 1, rowSpan: 1, sticky: true },
    { panelId: "app:crm", col: 1, row: 0, colSpan: 1, rowSpan: 1, config: { url: "https://crm.example" } },
  ],
  folderMode: "single", loop: "glyphh", modelSelections: { default: "claude-sonnet" }, sessionMode: "new", folder: "/Users/me/code", space: "code",
};

beforeAll(async () => {
  const dir = join(root, "workspaces", "research");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "workspace.json"), JSON.stringify(GRID));
  // A folder that is not a workspace is skipped, never listed.
  mkdirSync(join(root, "workspaces", "notes"), { recursive: true });
  const { installAttachHandlers } = await import("../../src/main/attach-handlers.js");
  installAttachHandlers();
});

describe("the Customize libraries over the attach socket", () => {
  it("registers the three reads beside the sessions.* four", () => {
    for (const m of ["sessions.list", "sessions.get", "layouts.list", "layouts.get", "panelApps.list", "cliSessions.list"]) expect(handlers.has(m)).toBe(true);
    expect(handlers.has("layouts.save")).toBe(false);
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

  it("cliSessions.list hands the web the vendor CLIs' sessions with their resume handles (his report, 2026-10-04)", async () => {
    const { sessions } = (await handlers.get("cliSessions.list")!({})) as { sessions: Array<Record<string, unknown>> };
    expect(sessions).toEqual([
      { id: "s-claude", cli: "claude", title: "fix the sync bug", cwd: "/Users/me/code/app", mtime: 20, updatedAt: 20, resume: "s-claude" },
      { id: "c-glyphh", cli: "glyphh", title: "triage", cwd: "", mtime: 10, updatedAt: 10, resume: "c-glyphh" },
    ]);
  });

  it("layouts.list hands the web the desktop's layouts-list rows, read off the files", async () => {
    const { layouts } = (await handlers.get("layouts.list")!({})) as { layouts: Array<Record<string, unknown>> };
    expect(layouts).toEqual([{
      name: "Research", cols: 2, rows: 1, colWidths: [0.5, 0.5], rowHeights: [1],
      target: "glyphh", loop: "glyphh", modelSelections: { default: "claude-sonnet" }, sessionMode: "new", folder: "/Users/me/code", space: "code",
      splits: [
        { panelId: "tool:coding", col: 0, row: 0, colSpan: 1, rowSpan: 1, sticky: true, config: undefined },
        { panelId: "app:crm", col: 1, row: 0, colSpan: 1, rowSpan: 1, sticky: undefined, config: { url: "https://crm.example" } },
      ],
    }]);
  });

  it("layouts.list re-scans: a workspace saved after the first read is listed", async () => {
    const dir = join(root, "workspaces", "triage");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "workspace.json"), JSON.stringify({ name: "Triage", version: 2, cols: 1, rows: 1, colWidths: [1], rowHeights: [1], cells: [{ panelId: "app:mail", col: 0, row: 0, colSpan: 1, rowSpan: 1 }] }));
    const { layouts } = (await handlers.get("layouts.list")!({})) as { layouts: Array<{ name: string; loop: string | null; modelSelections: Record<string, string>; sessionMode: string; folder: string | null; space: string | null }> };
    expect(layouts.map((l) => l.name).sort()).toEqual(["Research", "Triage"]);
    // Absent fields answer the IPC's defaults, never undefined.
    expect(layouts.find((l) => l.name === "Triage")).toMatchObject({ loop: null, modelSelections: {}, sessionMode: "keep", folder: null, space: null });
  });

  it("layouts.get answers one workspace by name and refuses an unknown one", async () => {
    const { layout } = (await handlers.get("layouts.get")!({ name: "Research" })) as { layout: { name: string; splits: unknown[] } };
    expect(layout.name).toBe("Research");
    expect(layout.splits).toHaveLength(2);
    await expect(handlers.get("layouts.get")!({})).rejects.toThrow(/requires \{ name \}/);
    await expect(handlers.get("layouts.get")!({ name: "Nope" })).rejects.toThrow(/no workspace "Nope"/);
  });

  it("panelApps.list hands the web the desktop's panel-apps-list rows", async () => {
    expect(await handlers.get("panelApps.list")!({})).toEqual({ apps: [TAB] });
  });
});
