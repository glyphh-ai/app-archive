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
// The house door's real stores (office store, deck cache, media library) are
// house-deps.ts's; the door itself is pinned bare in house-doors.test.ts.
vi.mock("../../src/main/house-deps.js", () => ({ realHouseDeps: () => ({ listDesigns: async () => [{ file: "brand.json", title: "Brand", size: 1, mtime: 2 }] }) }));
// The hub install itself (hub-ipc.ts installHubItem) is the desktop's own door;
// here only that apps.install hands it the item, routed as an app.
const hubInstalls: Array<[string, string]> = [];
vi.mock("../../src/main/hub-ipc.js", () => ({
  installHubItem: async (ref: string, kind: string) => { hubInstalls.push([ref, kind]); return { id: `app:${ref.split(":")[1]}` }; },
}));
// The apps' tools (glyphh-app-host.ts): the rows the local MCP's app_list_tools
// answers and the call its app_call_tool runs; pinned there, relayed here.
const toolCalls: Array<[string, string, unknown]> = [];
vi.mock("../../src/main/glyphh-app-host.js", () => ({
  listInstalledAppTools: async () => [
    { app: "recall", name: "Recall", data: "cloud", tools: [{ name: "ask" }] },
    { app: "images", name: "Images", data: "local", tools: [{ name: "save_image", description: "File an image", inputSchema: { type: "object" } }, { name: "list_images" }] },
  ],
  callAppTool: async (app: string, tool: string, args: unknown) => { toolCalls.push([app, tool, args]); return { files: [] }; },
  installGlyphhAppBundle: async (path: string) => { bundleInstalls.push(["path", path]); return { ok: true, name: "Recall", connectors: ["slack"] }; },
  installGlyphhAppBundleFromBase64: async (b64: string) => { bundleInstalls.push(["base64", b64]); return { ok: true, name: "Recall", updated: true }; },
}));
const bundleInstalls: Array<[string, string]> = [];
vi.mock("../../src/main/glyphh-app-services.js", () => ({
  connectorStatus: async (names: Set<string>) => [...names].map((connector) => ({ connector, connected: false })),
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

  it("apps.install installs a hub app on this machine through the desktop's own hub door (his verdict, 2026-10-05: a local-data app installs only on a desktop)", async () => {
    const h = handlers.get("apps.install")!;
    expect(await h({ itemId: "pub-9", from: "glyphh" })).toEqual({ id: "app:pub-9" });
    expect(await h({ itemId: "org-3", from: "org" })).toEqual({ id: "app:org-3" });
    // No `from` reads as the Glyphh catalog; a stray word never becomes a route.
    expect(await h({ itemId: "pub-1", from: "../../etc" })).toEqual({ id: "app:pub-1" });
    expect(hubInstalls).toEqual([["glyphh:pub-9", "app"], ["org:org-3", "app"], ["glyphh:pub-1", "app"]]);
    await expect(h({})).rejects.toThrow(/requires \{ itemId \}/);
  });

  it("apps.install also takes a .glyphh bundle — ONE handler for the hub form and the local MCP's app_install (the two registrations had been overwriting each other)", async () => {
    const h = handlers.get("apps.install")!;
    expect(await h({ bundleBase64: "UEs=" })).toEqual({ installed: "Recall", updated: true, requiredConnections: [] });
    expect(bundleInstalls).toEqual([["base64", "UEs="]]);
    await expect(h({ path: "/nowhere/app.glyphh" })).rejects.toThrow(/bundle not found/);
    expect(hubInstalls.length).toBe(3);
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

  it("apps.listTools answers the local MCP's app_list_tools rows, house apps and cloud instances alike, each saying where it answers (his report, 2026-10-05)", async () => {
    expect(await handlers.get("apps.listTools")!({})).toEqual([
      { app: "recall", name: "Recall", data: "cloud", tools: [{ name: "ask" }] },
      { app: "images", name: "Images", data: "local", tools: [{ name: "save_image", description: "File an image", inputSchema: { type: "object" } }, { name: "list_images" }] },
    ]);
  });

  it("apps.callTool runs an app's tool through the desktop's own callAppTool and answers { result }", async () => {
    const h = handlers.get("apps.callTool")!;
    expect(await h({ app: "images", tool: "list_images", args: { q: "sunset" } })).toEqual({ result: { files: [] } });
    // No args is an empty object; a non-object is never handed to the app.
    expect(await h({ app: "images", tool: "list_images" })).toEqual({ result: { files: [] } });
    expect(await h({ app: "images", tool: "list_images", args: "q=sunset" })).toEqual({ result: { files: [] } });
    expect(toolCalls).toEqual([["images", "list_images", { q: "sunset" }], ["images", "list_images", {}], ["images", "list_images", {}]]);
    await expect(h({ app: "images" })).rejects.toThrow(/requires \{ app, tool \}/);
    await expect(h({ tool: "list_images" })).rejects.toThrow(/requires \{ app, tool \}/);
  });

  it("app.call is registered for the web's own house panels and answers through house-doors (his order, 2026-10-05)", async () => {
    expect(handlers.has("app.call")).toBe(true);
    expect(await handlers.get("app.call")!({ app: "design", tool: "list" })).toEqual({ designs: [{ file: "brand.json", title: "Brand", size: 1, mtime: 2 }] });
    await expect(handlers.get("app.call")!({ app: "crm", tool: "list" })).rejects.toThrow(/house apps only/);
  });
});
