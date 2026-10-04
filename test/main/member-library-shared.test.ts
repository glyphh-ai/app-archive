/**
 * member-library-shared.test.ts — the member library's record shapes
 * (shared/member-library.ts): how each local record projects to its row, what
 * never rides (a tab's config vars), the agent row both surfaces build, the
 * server-first merge, and the thread locus the rail badges by.
 */
import { describe, expect, it } from "vitest";
import {
  agentClock, buildAgentRow, buildTabRow, bundleDataOf, bundleOfPageId, bundlePageId, bundleRowOf, filesClock, filesSignature,
  isGridLayout, layoutRowOf, mergeServerFirst, mergeTabLocal, normalizeRemoteRow, tabClock, tabRecordOf, tabRowOf, threadLocus,
  workspaceClock, workspaceId, type GridLayoutLike, type TabRowLike,
} from "../../src/shared/member-library.js";

const GRID: GridLayoutLike = { name: "Research Desk", version: 2, cols: 2, rows: 1, colWidths: [0.5, 0.5], rowHeights: [1], cells: [{ panelId: "tool:coding", col: 0, row: 0, colSpan: 1, rowSpan: 1, sticky: true, config: { folder: "/w" } }], loop: "glyphh", sessionMode: "new", updatedAt: 1_700_000 };
const TAB: TabRowLike = { id: "crm", kind: "web", slug: "crm", name: "CRM", prodUrl: "https://crm", nativeRef: null, config: { iconUrl: "https://i", env: { TOKEN: "s3cret" }, apiKey: "k", vars: { A: 1 } }, description: "", access: "members", owned: true, latestVersion: null, version: "0.1.0", secretNames: ["TOKEN"], requiredConnections: [{ slug: "gmail", actAs: "me", connected: true }], listing: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-04T10:00:00.123Z" };

describe("workspaces", () => {
  it("the folder id is the name, slugged; the row is layout-manager's layouts-list shape with the clock", () => {
    expect(workspaceId(" Research Desk ")).toBe("research-desk");
    expect(workspaceId("")).toBe("workspace");
    const row = layoutRowOf(GRID);
    expect(row).toEqual({ name: "Research Desk", cols: 2, rows: 1, colWidths: [0.5, 0.5], rowHeights: [1], target: "glyphh", loop: "glyphh", modelSelections: {}, sessionMode: "new", folder: null, space: null, splits: [{ panelId: "tool:coding", col: 0, row: 0, colSpan: 1, rowSpan: 1, sticky: true, config: { folder: "/w" } }], updatedAt: 1_700_000 });
    expect(workspaceClock(GRID)).toBe(1_700_000);
    expect(workspaceClock({ ...GRID, updatedAt: undefined })).toBe(0);
    expect(isGridLayout(GRID)).toBe(true);
    expect(isGridLayout({ name: "x" })).toBe(false);
  });
});

describe("app tabs", () => {
  it("config vars NEVER ride: env/vars and any secret-named key are stripped; the rest of the config does", () => {
    const rec = tabRecordOf(TAB);
    expect(rec.config).toEqual({ iconUrl: "https://i" });
    expect(rec.secretNames).toEqual(["TOKEN"]);      // the NAMES are library data; the values never were
    expect(tabRecordOf({ ...TAB, config: { env: {} } }).config).toEqual({});
    expect(tabRecordOf({ ...TAB, config: null }).config).toBeNull();
  });
  it("a pull keeps the machine's config vars under the server's fields", () => {
    const remote: TabRowLike = { ...tabRecordOf(TAB), name: "CRM 2", config: { iconUrl: "https://new" } };
    expect(mergeTabLocal(remote, TAB)).toMatchObject({ name: "CRM 2", config: { iconUrl: "https://new", env: { TOKEN: "s3cret" }, apiKey: "k", vars: { A: 1 } } });
    expect(mergeTabLocal(remote, null)).toBe(remote);
  });
  it("the clock is the ISO stamp, millisecond-exact; the row is org-apps' projection", () => {
    expect(tabClock(TAB)).toBe(Date.parse("2026-10-04T10:00:00.123Z"));
    expect(tabRowOf(TAB)).toMatchObject({ id: "crm", slug: "crm", isBrowser: true, url: "https://crm", appArchetype: "web", iconUrl: "https://i", connectionIds: ["gmail"], mcp: null, commands: {}, system: false });
    expect(tabRowOf({ ...TAB, kind: "glyphh" })).toMatchObject({ isBrowser: false, appArchetype: "glyphh-app" });
  });
  it("buildTabRow is apps-store's createEntry/updateEntry row", () => {
    const made = buildTabRow({ kind: "native", slug: "Mail", name: "Mail", nativeRef: "/Applications/Mail.app" }, null, "2026-10-04T00:00:00.000Z");
    expect(made).toMatchObject({ id: "mail", slug: "mail", kind: "native", nativeRef: "/Applications/Mail.app", prodUrl: null, owned: true, version: "0.1.0", access: "members", createdAt: "2026-10-04T00:00:00.000Z" });
    const edited = buildTabRow({ name: "Mail 2", access: "public" }, made, "2026-10-05T00:00:00.000Z");
    expect(edited).toMatchObject({ name: "Mail 2", access: "public", nativeRef: "/Applications/Mail.app", createdAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-05T00:00:00.000Z" });
    expect(() => buildTabRow({ name: "x" }, null, "")).toThrow(/slug/);
  });
});

describe("agents", () => {
  it("buildAgentRow is local-agents' saveAgent row — the same on both surfaces", () => {
    const made = buildAgentRow({ name: "Ada Lovelace", prompt: "p", guardrails: { maxInputTokens: "12" as unknown as number, windowCalls: 0 } }, null, "2026-10-04T00:00:00.000Z");
    expect(made).toEqual({ id: "ada-lovelace", slug: "ada-lovelace", name: "Ada Lovelace", description: "", prompt: "p", provider: "", model: "", skills: [], apps: [], live: true, guardrails: { maxInputTokens: 12, maxOutputTokens: null, windowSeconds: null, windowTokens: null, windowCalls: null, maxConcurrent: null }, createdAt: "2026-10-04T00:00:00.000Z", updatedAt: "2026-10-04T00:00:00.000Z" });
    const edited = buildAgentRow({ live: false, guardrails: {} }, made, "2026-10-05T00:00:00.000Z");
    expect(edited).toMatchObject({ slug: "ada-lovelace", name: "Ada Lovelace", prompt: "p", live: false, guardrails: null, createdAt: "2026-10-04T00:00:00.000Z" });
    expect(agentClock(edited)).toBe(Date.parse("2026-10-05T00:00:00.000Z"));
    expect(() => buildAgentRow({}, null, "")).toThrow(/name/);
  });
});

describe("skills and tasks", () => {
  it("the record's data is SKILL.md's frontmatter + body (+ task.json); the page id is the desktop's <source>:<name>", () => {
    const data = bundleDataOf("task", "digest", "---\nname: digest\ndescription: >-\n  Daily\n  digest\n---\n\nBody\n", false, { name: "digest", program: "run.js" });
    expect(data).toEqual({ name: "digest", description: "Daily digest", frontmatter: { name: "digest", description: "Daily digest" }, body: "\nBody\n", enabled: false, type: "task", manifest: { name: "digest", program: "run.js" } });
    expect(bundlePageId("skill", "notes")).toBe("glyphh:notes");
    expect(bundlePageId("task", "digest")).toBe("task:digest");
    expect(bundleOfPageId("glyphh:notes")).toEqual({ kind: "skill", id: "notes" });
    expect(bundleOfPageId("claude:notes")).toBeNull();
    expect(bundleOfPageId("app:x")).toBeNull();
    expect(bundleRowOf("skill", "notes", { ...data, type: "skill" }, 5_000, 3)).toMatchObject({ id: "glyphh:notes", source: "glyphh", type: "skill", name: "digest", fileCount: 3, updatedAt: new Date(5_000).toISOString() });
  });
  it("a manifest's signature is order-free; its clock is the newest mtime", () => {
    const a = [{ path: "b", size: 1, mtime: 5, sha256: "2" }, { path: "a", size: 1, mtime: 9, sha256: "1" }];
    expect(filesSignature(a)).toBe(filesSignature([...a].reverse()));
    expect(filesSignature(a)).not.toBe(filesSignature([{ ...a[0], sha256: "x" }, a[1]]));
    expect(filesClock(a)).toBe(9);
  });
});

describe("the remote row and the merge", () => {
  it("normalizeRemoteRow turns the since-page's numeric deletedAt into the ISO string reconcile wants", () => {
    expect(normalizeRemoteRow({ id: "x", updatedAt: 5, deletedAt: 5_000 })).toEqual({ id: "x", updatedAt: 5, deletedAt: new Date(5_000).toISOString() });
    expect(normalizeRemoteRow({ id: "x", updatedAt: 5, deletedAt: "2026-10-04T00:00:00.000Z" }).deletedAt).toBe("2026-10-04T00:00:00.000Z");
    expect(normalizeRemoteRow({ id: "x", updatedAt: 5 }).deletedAt).toBeNull();
    expect(normalizeRemoteRow({ id: "x", updatedAt: 5, deletedAt: null, data: 1 })).toEqual({ id: "x", updatedAt: 5, deletedAt: null, data: 1 });
  });
  it("mergeServerFirst: the server's row wins a tie; the relay fills what the server lacks", () => {
    const key = (r: { k: string }) => r.k;
    expect(mergeServerFirst([{ k: "a", from: "srv" }], [{ k: "a", from: "desk" }, { k: "b", from: "desk" }], key)).toEqual([{ k: "a", from: "srv" }, { k: "b", from: "desk" }]);
  });
});

describe("thread locus", () => {
  it("local = a local source, a bound folder, or this store's own chat; cloud = a cloud source or a server-adopted stub", () => {
    expect(threadLocus({ source: { kind: "local", path: "/w" } })).toBe("local");
    expect(threadLocus({ source: { kind: "cloud-new" } })).toBe("cloud");
    expect(threadLocus({ source: { kind: "cloud-repo", repo: "o/r" }, workdir: "/w" })).toBe("cloud");
    expect(threadLocus({ workdir: "/w" })).toBe("local");
    expect(threadLocus({ messages: [{ role: "user" }] })).toBe("local");
    expect(threadLocus({ messages: [], messageCount: 4 })).toBe("cloud");
    expect(threadLocus({})).toBe("local");
  });
});
