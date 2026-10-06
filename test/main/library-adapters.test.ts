/**
 * library-adapters.test.ts — the desktop's local side of the member library
 * (main/library-adapters.ts): each store's rows project to `{ id, updatedAt,
 * data }` with the writer's clock, a pull lands in the store, a remote delete
 * removes it, and a tab's config vars stay on the machine. Real stores over a
 * temp root; the agents store is mocked at its seam. Drips and schedules
 * (2026-10-04: db rows with cloud storage) run over a temp SQLite — node's
 * own, standing in for better-sqlite3, whose binary here is Electron's.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { root, home, agents } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const root = mkdtempSync(join(tmpdir(), "glyphh-adapters-"));
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  return { root, home, agents: new Map<string, unknown>() };
});

vi.mock("os", async (orig) => ({ ...(await orig<typeof import("os")>()), homedir: () => home }));
vi.mock("electron", () => ({ app: { getPath: () => root }, BrowserWindow: class {}, dialog: {}, ipcMain: { handle: () => undefined }, shell: {}, safeStorage: {}, screen: {} }));
vi.mock("better-sqlite3", () => {
  const sqlite = (process as unknown as { getBuiltinModule: (id: string) => { DatabaseSync: new (p: string) => Record<string, unknown> } }).getBuiltinModule("node:sqlite");
  return {
    default: function Database(path: string) {
      const db = new sqlite.DatabaseSync(path) as Record<string, unknown>;
      db.pragma = () => undefined;
      return db;
    },
  };
});
vi.mock("../../src/main/glyphh-loop.js", () => ({ runGlyphhHeadless: async () => ({ ok: true, text: "" }) }));
vi.mock("../../src/main/app-paths.js", () => ({ userScopedPath: (...s: string[]) => join(root, "user", ...s), userScopedDir: () => join(root, "user"), glyphhPath: (...s: string[]) => join(root, ...s), GLYPHH_DIR: root }));
vi.mock("../../src/main/stores/preferences-db.js", () => ({ getPreference: (_k: string, d: unknown) => d }));
vi.mock("../../src/main/glyphh-app-host.js", () => ({ registerBundleApp: async () => ({ ok: true }), unregisterBundleApp: async () => undefined }));
vi.mock("../../src/main/glyphh-client.js", () => ({ appCache: { cached: async (_k: string, fn: () => unknown) => fn(), invalidate: () => undefined } }));
vi.mock("../../src/main/local-agents.js", () => ({
  listAgents: () => [...agents.values()],
  applyRemoteAgent: (row: { slug: string }) => { agents.set(row.slug, row); },
  removeAgentLocal: (slug: string) => { agents.delete(slug); },
  readAgentRow: (slug: string) => agents.get(slug) ?? null,
}));

import { getLayoutManager } from "../../src/main/layout-manager.js";
import * as appsStore from "../../src/main/apps-store.js";
import { readTombstones } from "../../src/main/library-events.js";
import { agentAdapter, bundleAdapter, dripAdapter, manifestOf, readSyncState, scheduleAdapter, tabAdapter, workspaceAdapter } from "../../src/main/library-adapters.js";
import { initLocalDb, getLocalDb } from "../../src/main/local-db.js";
import { DripManager, setDripManagerInstance } from "../../src/main/drip-manager.js";
import { deleteSchedule, listSchedulesView, saveSchedule, setScheduleEnabled, stopLoopScheduler } from "../../src/main/local-library.js";
import type { MemberLibraryItem } from "@glyphh/sdk";

const item = (kind: MemberLibraryItem["kind"], id: string, updatedAt: number, data: unknown, files: MemberLibraryItem["files"] = []): MemberLibraryItem => ({ kind, id, updatedAt, deletedAt: null, data, files, createdAt: "" });

describe("workspaces", () => {
  it("a save stamps the writer's clock; the row carries the grid; a delete tombstones; a pull lands; a remote delete removes", async () => {
    const lm = getLayoutManager();
    const before = Date.now();
    await lm.saveLayout({ name: "Research Desk", version: 2, cols: 1, rows: 1, colWidths: [1], rowHeights: [1], cells: [] });
    const file = JSON.parse(readFileSync(join(root, "user", "workspaces", "research-desk", "workspace.json"), "utf-8"));
    expect(file.updatedAt).toBeGreaterThanOrEqual(before);
    const rows = workspaceAdapter().list();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "research-desk", updatedAt: file.updatedAt, data: { name: "Research Desk", cols: 1, updatedAt: file.updatedAt } });
    // A pull: another machine's grid, at the server's clock.
    workspaceAdapter().apply(item("workspace", "web-made", 5_000, { name: "Web Made", version: 2, cols: 3, rows: 1, colWidths: [1, 1, 1], rowHeights: [1], cells: [] }));
    expect(workspaceAdapter().list().find((r) => r.id === "web-made")).toMatchObject({ updatedAt: 5_000, data: { cols: 3 } });
    expect(existsSync(join(root, "user", "workspaces", "web-made", "workspace.json"))).toBe(true);
    // TWO WORLDS (2026-10-05): a workspace born on the web (`home: "cloud"`) is never adopted here.
    workspaceAdapter().apply(item("workspace", "cloud-only", 6_000, { name: "Cloud Only", version: 2, home: "cloud", cols: 2, rows: 1, colWidths: [1, 1], rowHeights: [1], cells: [] }));
    expect(workspaceAdapter().list().find((r) => r.id === "cloud-only")).toBeUndefined();
    expect(existsSync(join(root, "user", "workspaces", "cloud-only", "workspace.json"))).toBe(false);
    // A local delete: the folder goes, a tombstone is written at the delete's clock.
    expect(await lm.deleteLayout("Research Desk")).toBe(true);
    expect(readTombstones()["workspace:research-desk"]).toBeGreaterThanOrEqual(before);
    // A remote delete: the folder goes, quietly.
    workspaceAdapter().remove("web-made");
    expect(workspaceAdapter().list()).toEqual([]);
    expect(readTombstones()["workspace:web-made"]).toBeUndefined();
  });
  it("a file written before stamps existed takes its mtime as the clock", () => {
    const dir = join(root, "user", "workspaces", "old");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "workspace.json"), JSON.stringify({ name: "Old", version: 2, cols: 1, rows: 1, colWidths: [1], rowHeights: [1], cells: [] }));
    utimesSync(join(dir, "workspace.json"), new Date(123_000), new Date(123_000));
    getLayoutManager().resetForUserChange();
    expect(workspaceAdapter().list().find((r) => r.id === "old")).toMatchObject({ updatedAt: 123_000 });
  });
});

describe("app tabs", () => {
  it("the record is tab.json minus its config vars; the ISO stamp is the clock; a pull keeps the machine's vars", async () => {
    const made = await appsStore.createEntry({ kind: "web", slug: "crm", name: "CRM", url: "https://crm", config: { iconUrl: "https://i", env: { TOKEN: "s3cret" } } });
    const [row] = tabAdapter().list();
    expect(row).toMatchObject({ id: "crm", updatedAt: Date.parse(made.updatedAt), data: { slug: "crm", config: { iconUrl: "https://i" } } });
    expect(JSON.stringify(row.data)).not.toContain("s3cret");
    // The web renamed it: the pull lands with the server's clock, the env stays local.
    tabAdapter().apply(item("tab", "crm", 9_000_000, { ...(row.data as object), name: "CRM (web)", config: { iconUrl: "https://new" } }));
    const after = appsStore.readRow("crm")!;
    expect(after).toMatchObject({ name: "CRM (web)", updatedAt: new Date(9_000_000).toISOString(), config: { iconUrl: "https://new", env: { TOKEN: "s3cret" } } });
    expect(tabAdapter().list()[0].updatedAt).toBe(9_000_000);
    await appsStore.removeEntry("crm");
    expect(readTombstones()["tab:crm"]).toBeGreaterThan(0);
    expect(tabAdapter().list()).toEqual([]);
  });
});

describe("agents", () => {
  it("the record is the agent file; the ISO stamp is the clock; a pull restamps it to the server's", () => {
    agents.set("ada", { id: "ada", slug: "ada", name: "Ada", description: "", prompt: "", provider: "", model: "", skills: [], apps: [], live: true, guardrails: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.500Z" });
    expect(agentAdapter().list()).toEqual([{ id: "ada", updatedAt: Date.parse("2026-10-04T00:00:00.500Z"), data: agents.get("ada") }]);
    agentAdapter().apply(item("agent", "ada", 7_000, { ...(agents.get("ada") as object), name: "Ada 2" }));
    expect(agents.get("ada")).toMatchObject({ name: "Ada 2", updatedAt: new Date(7_000).toISOString() });
    agentAdapter().remove("ada");
    expect(agents.size).toBe(0);
  });
});

describe("skills and tasks (folders)", () => {
  const skills = join(root, "user", "skills");
  beforeAll(() => { mkdirSync(skills, { recursive: true }); });

  it("the row is SKILL.md's data plus the manifest with hashes; the clock is the newest mtime, then the synced clock while nothing moves", () => {
    mkdirSync(join(skills, "notes"), { recursive: true });
    writeFileSync(join(skills, "notes", "SKILL.md"), "---\nname: notes\ndescription: Keep notes\n---\n\nBody\n");
    writeFileSync(join(skills, "notes", "run.sh"), "echo hi");
    utimesSync(join(skills, "notes", "SKILL.md"), new Date(4_000), new Date(4_000));
    utimesSync(join(skills, "notes", "run.sh"), new Date(3_000), new Date(3_000));
    const a = bundleAdapter("skill");
    const [row] = a.list();
    expect(row).toMatchObject({ id: "notes", updatedAt: 4_000, data: { name: "notes", description: "Keep notes", body: "\nBody\n", enabled: true, type: "skill" } });
    expect(row.files!.map((f) => f.path)).toEqual(["run.sh", "SKILL.md"]);   // walk()'s locale order
    const sh = row.files!.find((f) => f.path === "run.sh")!;
    expect(sh).toMatchObject({ size: 7, mtime: 3_000 });
    expect(sh.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Synced at the server's clock: the row holds that clock until a file moves.
    a.noteSynced!("notes", 8_000, row.files!);
    expect(a.list()[0].updatedAt).toBe(8_000);
    expect(readSyncState().bundles["skill:notes"]).toMatchObject({ updatedAt: 8_000 });
    expect(a.lastSyncedFiles!("notes")!.map((f) => f.path)).toEqual(["run.sh", "SKILL.md"]);
    writeFileSync(join(skills, "notes", "run.sh"), "echo changed");
    utimesSync(join(skills, "notes", "run.sh"), new Date(2_000), new Date(2_000)); // an old mtime still counts as AFTER the sync
    expect(a.list()[0].updatedAt).toBe(8_001);
    expect(a.localFiles!("notes")!.find((f) => f.path === "run.sh")!.size).toBe(12);
  });

  it("a pull writes the folder (stamping mtimes), parks it when the record says disabled, and a remote delete removes it", () => {
    const a = bundleAdapter("task");
    a.apply(item("task", "digest", 6_000, { name: "digest", enabled: false, type: "task" }, []), [
      { path: "SKILL.md", bytes: new TextEncoder().encode("---\nname: digest\n---\n"), mtime: 5_000 },
      { path: "task.json", bytes: new TextEncoder().encode('{"name":"digest","program":"run.js"}'), mtime: 5_000 },
    ]);
    const parked = join(root, "user", "skills-disabled", "task", "digest");
    expect(existsSync(join(parked, "task.json"))).toBe(true);
    expect(existsSync(join(root, "user", "tasks", "digest"))).toBe(false);
    expect(manifestOf(parked).map((f) => f.path)).toEqual(["SKILL.md", "task.json"]);
    expect(manifestOf(parked)[0].mtime).toBe(5_000);
    const [row] = a.list();
    expect(row).toMatchObject({ id: "digest", data: { enabled: false, manifest: { name: "digest", program: "run.js" } } });
    // Enabled on the web: the folder moves home, the unchanged file is kept (bytes: null).
    a.apply(item("task", "digest", 7_000, { name: "digest", enabled: true, type: "task" }, []), [
      { path: "SKILL.md", bytes: null, mtime: 5_000 }, { path: "task.json", bytes: null, mtime: 5_000 },
    ]);
    expect(existsSync(join(root, "user", "tasks", "digest", "task.json"))).toBe(true);
    expect(existsSync(parked)).toBe(false);
    a.remove("digest");
    expect(existsSync(join(root, "user", "tasks", "digest"))).toBe(false);
    expect(a.list()).toEqual([]);
  });
});

describe("drips (a SQLite row per preset)", () => {
  beforeAll(() => { initLocalDb(); });

  it("a save stamps the writer's clock and the row is the record; a pull lands at the server's clock (the command cache sees it); deletes tombstone or go quietly", () => {
    const mgr = new DripManager();
    setDripManagerInstance(mgr);
    const before = Date.now();
    expect(mgr.saveCustom("Party", "3  confetti fireworks")).toBe('saved drip "party" → 3 confetti fireworks');
    const [row] = dripAdapter().list();
    expect(row).toMatchObject({ id: "party", data: { name: "party", recipe: "3 confetti fireworks" } });
    expect(row.updatedAt).toBeGreaterThanOrEqual(before);
    // The web saved one: it lands at the server's clock and the `.drip` command knows it at once.
    dripAdapter().apply(item("drip", "webmade", 4_000, { name: "webmade", recipe: "-1 0.5 aurora" }));
    expect(dripAdapter().list().find((r) => r.id === "webmade")).toEqual({ id: "webmade", updatedAt: 4_000, data: { name: "webmade", recipe: "-1 0.5 aurora" } });
    expect(mgr.isEffect("webmade")).toBe(true);
    expect(() => dripAdapter().apply(item("drip", "junk", 1, "confetti"))).toThrow(/not a drip record/);
    // A local delete: the row goes, a tombstone is written at the delete's clock.
    expect(mgr.deleteCustom("party")).toBe('deleted drip "party"');
    expect(readTombstones()["drip:party"]).toBeGreaterThanOrEqual(before);
    // A remote delete: quietly.
    dripAdapter().remove("webmade");
    expect(dripAdapter().list()).toEqual([]);
    expect(readTombstones()["drip:webmade"]).toBeUndefined();
    expect(mgr.isEffect("webmade")).toBe(false);
  });

  it("a row written before the stamp existed takes its SQL datetime as the clock", () => {
    getLocalDb().prepare("INSERT INTO drips (name, recipe, updated_at) VALUES ('old', 'hearts', '2026-10-01 10:00:00')").run();
    expect(dripAdapter().list().find((r) => r.id === "old")).toMatchObject({ updatedAt: Date.parse("2026-10-01T10:00:00Z") });
    getLocalDb().prepare("DELETE FROM drips WHERE name = 'old'").run();
  });
});

describe("schedules (a loop_schedules row each; the clock reads the same table)", () => {
  beforeAll(() => { initLocalDb(); });
  afterAll(() => { stopLoopScheduler(); });

  it("a save stamps the clock and the row is the record (never the runs); arming re-stamps; a delete tombstones", () => {
    const before = Date.now();
    const { id } = saveSchedule({ name: "Digest", kind: "task", target: "digest", cron: "0 9 * * 1-5", args: { n: 1 } });
    const [row] = scheduleAdapter().list();
    expect(row).toMatchObject({ id, data: { name: "Digest", cron: "0 9 * * 1-5", kind: "task", target: "digest", agentId: null, ownerAgentId: null, args: { n: 1 }, enabled: true } });
    expect(Object.keys(row.data as object).sort()).toEqual(["agentId", "args", "cron", "enabled", "kind", "name", "ownerAgentId", "target"]);
    expect(row.updatedAt).toBeGreaterThanOrEqual(before);
    const stamped = row.updatedAt;
    expect(setScheduleEnabled(id, false)).toEqual({ updated: true });
    const after = scheduleAdapter().list()[0];
    expect(after.data).toMatchObject({ enabled: false });
    expect(after.updatedAt).toBeGreaterThanOrEqual(stamped);
    expect(deleteSchedule(id)).toEqual({ deleted: true });
    expect(readTombstones()[`schedule:${id}`]).toBeGreaterThanOrEqual(before);
    expect(scheduleAdapter().list()).toEqual([]);
  });

  it("a schedule made on the web lands in the table at the server's clock, on the clock (the page lists it); a remote delete takes it off", () => {
    const web = { name: "Nightly", cron: "0 2 * * *", kind: "task" as const, target: "backup", agentId: null, ownerAgentId: null, args: { deep: true }, enabled: true };
    scheduleAdapter().apply(item("schedule", "web1", 7_000, web));
    expect(scheduleAdapter().list()).toEqual([{ id: "web1", updatedAt: 7_000, data: web }]);
    expect(listSchedulesView().find((s) => s.id === "web1")).toMatchObject({ name: "Nightly", kind: "task", target: "backup", cron: "0 2 * * *", enabled: true, args: '{"deep":true}', lastRunAt: null });
    // Edited on the web: the same row, the new clock, nothing duplicated.
    scheduleAdapter().apply(item("schedule", "web1", 8_000, { ...web, enabled: false, name: "Nightly (off)" }));
    expect(scheduleAdapter().list()).toEqual([{ id: "web1", updatedAt: 8_000, data: { ...web, enabled: false, name: "Nightly (off)" } }]);
    expect(() => scheduleAdapter().apply(item("schedule", "bad", 1, { name: "x" }))).toThrow(/not a schedule record/);
    scheduleAdapter().remove("web1");
    expect(scheduleAdapter().list()).toEqual([]);
    expect(readTombstones()["schedule:web1"]).toBeUndefined();
  });

  it("a row written before the stamp existed takes its created_at as the clock", () => {
    getLocalDb().prepare("INSERT INTO loop_schedules (id, agent_id, name, loop_slug, cron, enabled, created_at, kind, target, args) VALUES ('old', '', 'Old', 'x', '0 9 * * *', 1, '2026-10-01 10:00:00', 'task', 'x', '{}')").run();
    expect(scheduleAdapter().list().find((r) => r.id === "old")).toMatchObject({ updatedAt: Date.parse("2026-10-01T10:00:00Z"), data: { target: "x" } });
    getLocalDb().prepare("DELETE FROM loop_schedules WHERE id = 'old'").run();
  });
});
