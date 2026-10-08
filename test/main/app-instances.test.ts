/**
 * app-instances.test.ts — APPS ARE INSTALLED IN THE CLOUD (his decision,
 * 2026-10-04). The pure side (src/shared/app-instances.ts): the create
 * request a bundle makes, the tab row an instance gets, the one list
 * (instances + tabs, one row per slug), the panel URL, the Apps-page
 * card; and the desktop door (src/main/app-instances.ts) over a fake client:
 * install = create → PUT → ready, the org/personal fallback, the panel's
 * `glyphh.call` as the member.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { list as tarList } from "tar";
import {
  callPathOf, instanceCardOf, instanceDetailOf, instanceKeyOfRow, instanceRequestOf, instanceTabOpen, instanceTabRow, instanceToolRows,
  mergeAppRows, panelPathOf, panelUrlOf, resolveInstance, tabConfigOf, instanceCardId, isInstanceCardId, instanceKeyOfCardId,
  releaseOf, rollbackTargetOf,
  type AppInstanceSummary,
} from "../../src/shared/app-instances.js";
import type { TabRowLike } from "../../src/shared/member-library.js";

const SHA = "a".repeat(64);
const MANIFEST = {
  manifestVersion: 2, kind: "glyphh-app", name: "Expense Desk", slug: "expense-desk", entry: "index.html",
  capabilities: ["db.exec", "notify.send"], connectors: ["gmail"],
  tools: [{ name: "list_expenses", description: "Every expense", capability: "db.exec", inputSchema: { type: "object" } }],
  window: { width: 900 }, release: { version: "1.2.0" }, description: "Expenses, filed.",
};
const ORG: AppInstanceSummary = {
  key: "expense-desk", slug: "expense-desk", kind: "org", access: "everyone", public: false, status: "ready", members: [], orgConnectionId: null,
  bundle: { sha256: SHA, bytes: 1234 }, manifest: { name: "Expense Desk", tools: MANIFEST.tools, capabilities: MANIFEST.capabilities, connectors: ["gmail"], description: "Expenses, filed." },
  url: "/app-host/expense-desk/",
};
const PERSONAL: AppInstanceSummary = { ...ORG, key: "notes~u1", slug: "notes", kind: "personal", manifest: { name: "Notes", tools: [], capabilities: [], connectors: [] }, url: "/app-host/notes~u1/" };
const tab = (over: Partial<TabRowLike>): TabRowLike => ({
  id: "crm", kind: "web", slug: "crm", name: "CRM", prodUrl: "https://crm", nativeRef: null, config: null, description: "", access: "members", owned: true,
  latestVersion: null, version: "0.1.0", secretNames: [], requiredConnections: [], listing: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", ...over,
});
/** A glyphh row from before the cloud: its entry a file on a machine. */
const LOCAL = tab({ id: "expense-desk", kind: "glyphh", slug: "expense-desk", name: "Expense Desk (local)", nativeRef: "/Users/me/.glyphh/apps/expense-desk/index.html", config: { capabilities: ["db.exec"], secrets: { K: "v" } } });

describe("instanceRequestOf — the create body a bundle makes", () => {
  it("carries slug, kind, the zip's identity and the manifest as it is", () => {
    const req = instanceRequestOf(MANIFEST, { sha256: SHA, sizeBytes: 1234 }, "org");
    expect(req).toEqual({ slug: "expense-desk", kind: "org", bundle: { sha256: SHA, sizeBytes: 1234 }, manifest: { ...MANIFEST, slug: "expense-desk" } });
  });
  it("refuses what the server would: a bad slug, kind, sha or size", () => {
    expect(() => instanceRequestOf({ ...MANIFEST, slug: "Bad Slug" }, { sha256: SHA, sizeBytes: 1 }, "org")).toThrow(/slug/);
    expect(() => instanceRequestOf(MANIFEST, { sha256: "nope", sizeBytes: 1 }, "org")).toThrow(/sha256/);
    expect(() => instanceRequestOf(MANIFEST, { sha256: SHA, sizeBytes: 0 }, "org")).toThrow(/sizeBytes/);
    expect(() => instanceRequestOf(MANIFEST, { sha256: SHA, sizeBytes: 1 }, "team" as never)).toThrow(/kind/);
  });
});

describe("instanceTabRow — the tab record an instance gets", () => {
  it("is a glyphh row with no local entry whose config names the instance", () => {
    const row = instanceTabRow(ORG, MANIFEST, null, "2026-10-04T10:00:00.000Z");
    expect(row.kind).toBe("glyphh");
    expect(row.nativeRef).toBeNull();
    expect(row.prodUrl).toBeNull();
    expect(row.config).toMatchObject({ instance: "expense-desk", instanceKind: "org", capabilities: ["db.exec", "notify.send"], connectors: ["gmail"], workbench: true, release: { version: "1.2.0" } });
    expect(row.version).toBe("1.2.0");
    expect(row.requiredConnections).toEqual([{ slug: "gmail", actAs: "user", connected: false }]);
    expect(instanceKeyOfRow(row)).toBe("expense-desk");
  });
  it("retargets a row from before the cloud: entry gone, identity, dates and config vars kept", () => {
    const row = instanceTabRow(ORG, MANIFEST, LOCAL, "2026-10-04T10:00:00.000Z");
    expect(row.nativeRef).toBeNull();
    expect(row.id).toBe("expense-desk");
    expect(row.createdAt).toBe(LOCAL.createdAt);
    expect(row.config).toMatchObject({ instance: "expense-desk", secrets: { K: "v" } });
    expect(instanceKeyOfRow(row)).toBe("expense-desk");
  });
  it("with no manifest, reads the instance's own summary", () => {
    const row = instanceTabRow(PERSONAL, null, null, "2026-10-04T10:00:00.000Z");
    expect(row.name).toBe("Notes");
    expect(tabConfigOf(PERSONAL)).toMatchObject({ instance: "notes~u1", instanceKind: "personal", tools: [] });
  });
});

describe("mergeAppRows — THE LIST", () => {
  it("lists tab rows and every instance no tab names, one row per slug (an old row never beside its instance)", () => {
    const rows = mergeAppRows([ORG, PERSONAL], [tab({}), LOCAL], "2026-10-04T00:00:00.000Z");
    expect(rows.map((r) => r.slug).sort()).toEqual(["crm", "expense-desk", "notes"]);
    const desk = rows.find((r) => r.slug === "expense-desk")!;
    // The instance is the app; the local copy is hidden behind it.
    expect(desk.execPath).toBeNull();
    expect(desk.appArchetype).toBe("glyphh-app");
    expect(desk.launchConfig).toMatchObject({ instance: "expense-desk", instanceStatus: "ready", instanceAccess: "everyone" });
    const notes = rows.find((r) => r.slug === "notes")!;
    expect(notes.launchConfig).toMatchObject({ instance: "notes~u1", instanceKind: "personal" });
  });
  it("lists an old row that has no instance once, as it is, with no extra flag", () => {
    const rows = mergeAppRows([], [LOCAL, LOCAL]);
    expect(rows).toHaveLength(1);
    expect(rows[0].execPath).toBe(LOCAL.nativeRef);
    expect(rows[0].launchConfig).not.toHaveProperty("data");
    expect(rows[0].launchConfig).not.toHaveProperty("legacyLocal");
  });
  it("an org instance wins a personal one of the same slug for the row", () => {
    const mine = { ...PERSONAL, key: "expense-desk~u1", slug: "expense-desk" };
    const rows = mergeAppRows([mine, ORG], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].launchConfig?.instance).toBe("expense-desk");
  });
  it("a glyphh tab with no instance behind it and no bundle on this machine is not listed — it is a row left over from a delete (his report, 2026-10-07)", () => {
    const dead = tab({ id: "daily-brief", kind: "glyphh", slug: "daily-brief", name: "Daily Brief", config: { instance: "daily-brief~u1" }, nativeRef: null });
    const bare = tab({ id: "messages", kind: "glyphh", slug: "messages", name: "Messages", config: null, nativeRef: null });
    expect(mergeAppRows([], [dead, bare]).map((r) => r.slug)).toEqual([]);
    // Its instance back → the row lists with the instance; a local bundle lists on its own.
    expect(mergeAppRows([{ ...PERSONAL, key: "daily-brief~u1", slug: "daily-brief" }], [dead]).map((r) => r.slug)).toEqual(["daily-brief"]);
    expect(mergeAppRows([], [LOCAL]).map((r) => r.slug)).toEqual([LOCAL.slug]);
    // A URL tab is never an app row's business.
    expect(mergeAppRows([], [tab({ id: "mail", kind: "web", slug: "mail", name: "Mail", prodUrl: "https://mail" })]).map((r) => r.slug)).toEqual(["mail"]);
  });
  it("a tab that names an instance carries its live status", () => {
    const named = tab({ id: "expense-desk", kind: "glyphh", slug: "expense-desk", name: "Expense Desk", config: { instance: "expense-desk" } });
    const rows = mergeAppRows([{ ...ORG, status: "stopped" }], [named]);
    expect(rows[0].launchConfig).toMatchObject({ instance: "expense-desk", instanceStatus: "stopped" });
  });

  // THE HOUSE APPS ARE APPS (his law, 2026-10-06): Images, Drive and the rest
  // are instances the server installs for every member, listed like any
  // instance — nothing synthesizes a row for them. What is theirs: the slug
  // names the built-in panel, stamped on the tab as `tool`, the one key every
  // open door reads (the wall tile, the ⋮ menu, Settings → Apps → Open).
  it("a HOUSE app's instance names its built-in panel (`tool`) — on its own tab, and on a tab the server wrote without it; no instance, no row", () => {
    const images: AppInstanceSummary = { ...PERSONAL, key: "images~u1", slug: "images", manifest: { name: "Images", tools: [{ name: "save_image" }], capabilities: ["library.*"], connectors: [] }, url: "/app-host/images~u1/" };
    const at = "2026-10-06T00:00:00.000Z";
    expect(instanceTabRow(images, null, null, at).config).toMatchObject({ instance: "images~u1", instanceKind: "personal", tool: "gimage", workbench: true });
    expect(instanceTabRow(PERSONAL, null, null, at).config).not.toHaveProperty("tool");
    // Settings → Apps → Open: the panel for a house app, the instance's UI for any other.
    expect(instanceTabOpen(instanceTabRow(images, null, null, at))).toEqual({ slug: "images", name: "Images", tool: "gimage" });
    expect(instanceTabOpen(instanceTabRow(PERSONAL, null, null, at))).toEqual({ slug: "notes", name: "Notes" });
    // The list: a bare tab the server wrote for the instance still carries the panel.
    const bare = tab({ id: "images", kind: "glyphh", slug: "images", name: "Images", config: { instance: "images~u1" } });
    const rows = mergeAppRows([images, PERSONAL], [bare], at);
    expect(rows.map((r) => r.slug)).toEqual(["images", "notes"]);
    expect(rows[0].launchConfig).toMatchObject({ instance: "images~u1", tool: "gimage", instanceStatus: "ready" });
    expect(rows[1].launchConfig).not.toHaveProperty("tool");
    // A tab's own tool wins; nothing is listed that is not installed.
    const own = tab({ id: "drive", kind: "glyphh", slug: "drive", name: "Drive", config: { instance: "drive~u1", tool: "gdrive" } });
    expect(mergeAppRows([{ ...images, key: "drive~u1", slug: "drive" }], [own], at)[0].launchConfig).toMatchObject({ tool: "gdrive" });
    expect(mergeAppRows([], [], at)).toEqual([]);
  });
});

describe("the panel URL", () => {
  it("is the server's proxy at the release's ui/ tree with a trailing slash (the app server resolves index.html), the key encoded", () => {
    expect(panelPathOf("expense-desk")).toBe("/app-host/expense-desk/ui/");
    expect(panelPathOf("notes~u1")).toBe("/app-host/notes~u1/ui/");
    expect(panelUrlOf("https://api.glyphh.ai/", "expense-desk")).toBe("https://api.glyphh.ai/app-host/expense-desk/ui/");
    expect(callPathOf("a b")).toBe("/app-host/a%20b/call");
  });
});

describe("releases on the summary", () => {
  it("release n reads off the row; rollback = n-1, nothing before release 1 or with nothing deployed", () => {
    expect(releaseOf(ORG)).toBeNull();
    expect(releaseOf({ release: 3 })).toBe(3);
    expect(releaseOf({ release: 0 })).toBeNull();
    expect(rollbackTargetOf({ release: 3 })).toBe(2);
    expect(rollbackTargetOf({ release: 1 })).toBeNull();
    expect(rollbackTargetOf({ release: null })).toBeNull();
    expect(rollbackTargetOf(null)).toBeNull();
  });
});

describe("the Apps-page card and the tool rows", () => {
  it("a card stands for the instance, with no folder", () => {
    const card = instanceCardOf(ORG, "2026-10-04T00:00:00.000Z");
    expect(card).toMatchObject({ id: "app-instance:expense-desk", type: "app", source: "app", dir: "", fileCount: 0, enabled: true, author: "your organization", tool: null });
    // A house app's card is Glyphh's and wears its panel's mark; the manifest's description rides (his report, 2026-10-07).
    const house = instanceCardOf({ ...ORG, slug: "design", kind: "personal", manifest: { ...ORG.manifest, name: "Design", description: "The member's design systems" } });
    expect(house).toMatchObject({ author: "Glyphh", tool: "gdesign", description: "The member's design systems", name: "Design" });
    expect(card.instance.tools).toEqual(["list_expenses"]);
    expect(card.instance.release).toBeNull();
    expect(isInstanceCardId(card.id)).toBe(true);
    expect(instanceKeyOfCardId(instanceCardId("notes~u1"))).toBe("notes~u1");
    const detail = instanceDetailOf(ORG);
    expect(detail.frontmatter).toMatchObject({ instance: "expense-desk", kind: "org", status: "ready" });
    expect(detail.frontmatter).not.toHaveProperty("release");
    expect(detail.body).toContain("nothing deployed yet");
    expect(detail.body).toContain("`list_expenses` — Every expense");
    expect(detail.files).toEqual([]);
  });
  it("the detail's page is the release's SKILL.md when it ships one, frontmatter stripped (his order, 2026-10-07)", () => {
    const skill = "---\nname: app-expense-desk\ndescription: Expenses.\n---\n\n# Expense Desk\n\nFile and find expenses.\n\n## Tools\n\n- `list_expenses` — every expense.\n";
    const detail = instanceDetailOf({ ...ORG, release: 2, skill });
    expect(detail.body.startsWith("# Expense Desk")).toBe(true);
    expect(detail.body).not.toContain("name: app-expense-desk");
    expect(detail.body).not.toContain("Installed in the cloud"), "the app's own page, not the synthesized one";
    expect(instanceDetailOf({ ...ORG, skill: "  " }).body).toContain("Installed in the cloud");
  });
  it("the card and the detail carry the pinned release", () => {
    const live = { ...ORG, release: 4 };
    expect(instanceCardOf(live).instance.release).toBe(4);
    const detail = instanceDetailOf(live);
    expect(detail.frontmatter.release).toBe("4");
    expect(detail.body).toContain("release 4");
  });
  it("tool rows are the gateway's shape, keyed by instance, instances without tools left out", () => {
    expect(instanceToolRows([ORG, PERSONAL])).toEqual([
      { app: "expense-desk", name: "Expense Desk", kind: "org", status: "ready", tools: [{ name: "list_expenses", description: "Every expense", inputSchema: { type: "object" } }] },
    ]);
  });
  it("resolves a ref by key, by slug (org first), or the member's personal one", () => {
    const mine = { ...PERSONAL, key: "expense-desk~u1", slug: "expense-desk" };
    expect(resolveInstance([mine, ORG], "expense-desk", "u1")?.key).toBe("expense-desk");
    expect(resolveInstance([mine, ORG], "expense-desk~u1", "u1")?.key).toBe("expense-desk~u1");
    expect(resolveInstance([mine], "expense-desk", "u1")?.key).toBe("expense-desk~u1");
    expect(resolveInstance([ORG], "nothing", "u1")).toBeUndefined();
  });
});

// ── the desktop door, over a fake client ─────────────────────────────────────
const calls: Array<{ method: string; path: string; body?: unknown }> = [];
let forbidOrg = false;
let token: string | null = "tok-1";
/** What GET /api/app-instances answers (the deploy tests swap it). */
let listed: AppInstanceSummary[] = [ORG];
const RELEASE = { n: 2, sha256: "b".repeat(64), sizeBytes: 4096, note: "second", at: "2026-10-06T00:00:00.000Z", by: "u1", pinned: true };
/** The SDK's appInstances resource (sdk/src/resources/app-instances.ts), recorded. */
const sdk = {
  create: async (input: { slug: string; kind: "org" | "personal"; bundle: { sha256: string; sizeBytes: number }; manifest: Record<string, unknown> }) => {
    calls.push({ method: "SDK", path: "create", body: input });
    if (forbidOrg && input.kind === "org") { const e = new Error("org admin only") as Error & { code: string }; e.code = "E_FORBIDDEN"; throw e; }
    const key = input.kind === "personal" ? `${input.slug}~u1` : input.slug;
    return { instance: { ...ORG, key, slug: input.slug, kind: input.kind, status: "pending" as const, release: null }, upload: { url: "https://r2.test/put-bundle", key: `apps/o/${input.slug}/releases/1/bundle.zip` } };
  },
  builds: async (key: string) => { calls.push({ method: "SDK", path: `builds ${key}` }); return { build: { n: 3 }, upload: { url: "https://r2.test/put-source", key: `apps/o/${key}/builds/3/source.tgz` } }; },
  runBuild: async (key: string, n: number, opts?: { note?: string }) => { calls.push({ method: "SDK", path: `runBuild ${key} ${n}`, body: opts }); return { release: RELEASE, log: "x".repeat(10_000) + "\nbuild ok" }; },
  releases: async (key: string) => { calls.push({ method: "SDK", path: `releases ${key}` }); return [{ ...RELEASE, n: 1, pinned: false }, RELEASE]; },
  pin: async (key: string, n: number) => { calls.push({ method: "SDK", path: `pin ${key} ${n}` }); return { ...ORG, key, release: n }; },
};
const JOB_ID = "job_0123456789abcdef01234567";
let jobReads = 0;
let jobFails = false;
const readyBodies: unknown[] = [];
vi.mock("electron", () => ({ ipcMain: { handle: () => undefined } }));
vi.mock("../../src/main/org-apps.js", () => ({ invalidateOrgApps: () => undefined }));
vi.mock("../../src/main/broadcast.js", () => ({ broadcast: () => undefined }));
vi.mock("../../src/main/glyphh-client.js", () => ({
  SERVER_URL: "https://api.test",
  appCache: { cached: async (_k: string, fn: () => Promise<unknown>) => fn(), invalidate: () => undefined },
  getClient: () => ({
    appInstances: sdk,
    token: async () => { if (!token) throw new Error("signed out"); return token; },
    http: {
      get: async (path: string) => {
        calls.push({ method: "GET", path });
        if (path === "/api/app-instances") return listed;
        if (path === `/api/app-instances/jobs/${JOB_ID}`) {
          jobReads += 1;
          if (jobFails) return { id: JOB_ID, key: "recall", status: "failed", log: "npm ERR! boom", release: null, error: "next build exited 1" };
          return jobReads >= 2 ? { id: JOB_ID, key: "recall", status: "ready", log: "x".repeat(10_000) + "\nbuild ok", release: RELEASE, error: null } : { id: JOB_ID, key: "recall", status: "building", log: "npm ci", release: null, error: null };
        }
        return [];
      },
      post: async (path: string, body?: unknown) => {
        calls.push({ method: "POST", path, body });
        if (path === "/api/app-instances") {
          if (forbidOrg && (body as { kind: string }).kind === "org") { const e = new Error("org admin only") as Error & { code: string }; e.code = "E_FORBIDDEN"; throw e; }
          return { instance: { ...ORG, status: "pending", kind: (body as { kind: "org" | "personal" }).kind }, upload: { url: "https://r2.test/put", key: "bundles/x" } };
        }
        if (path.endsWith("/ready")) { readyBodies.push(body); return { ...ORG, status: "ready", release: 7 }; }
        // THE BUILD IS A JOB (2026-10-07): /run answers the job at once.
        const run = path.match(/^\/api\/app-instances\/([^/]+)\/builds\/(\d+)\/run$/);
        if (run) { jobReads = 0; return { job: { id: JOB_ID, key: run[1], status: "queued", log: "", release: null, error: null } }; }
        if (path.endsWith("/invoke")) return { ok: true, tool: "list_expenses", result: [{ id: 1 }] };
        return {};
      },
      del: async (path: string) => { calls.push({ method: "DELETE", path }); },
    },
  }),
}));
vi.mock("../../src/main/apps-store.js", () => ({ readRow: () => null, createEntry: async (i: unknown) => i, updateEntry: async (_s: string, p: unknown) => p, removeEntry: async () => undefined }));
vi.mock("../../src/main/app-paths.js", () => ({ getActiveUserId: () => "u1" }));

const main = await import("../../src/main/app-instances.js");

describe("installBundleAsInstance — create → PUT → ready", () => {
  it("uploads the zip to the presigned URL and readies the instance", async () => {
    calls.length = 0;
    const puts: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => { puts.push({ url: String(url), init: init! }); return new Response(null, { status: 200 }); }) as typeof fetch;
    const live = await main.installBundleAsInstance(Buffer.from("zipbytes"), MANIFEST, { kind: "org", fetchImpl });
    expect(live.status).toBe("ready");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/app-instances", "POST /api/app-instances/expense-desk/ready"]);
    expect((calls[0].body as { bundle: { sizeBytes: number } }).bundle.sizeBytes).toBe(8);
    expect(puts[0].url).toBe("https://r2.test/put");
    expect(puts[0].init.method).toBe("PUT");
  });
  it("tries an org instance first and falls back to personal when refused", async () => {
    calls.length = 0; forbidOrg = true;
    const fetchImpl = (async () => new Response(null, { status: 200 })) as typeof fetch;
    await main.installBundleAsInstance(Buffer.from("zipbytes"), MANIFEST, { fetchImpl });
    expect(calls.filter((c) => c.path === "/api/app-instances").map((c) => (c.body as { kind: string }).kind)).toEqual(["org", "personal"]);
    forbidOrg = false;
  });
  it("a refused upload is an error, not a half-made instance", async () => {
    const fetchImpl = (async () => new Response(null, { status: 403 })) as typeof fetch;
    await expect(main.installBundleAsInstance(Buffer.from("z"), MANIFEST, { kind: "org", fetchImpl })).rejects.toThrow(/upload was refused/);
  });
});

describe("the instance's tools and the panel bridge", () => {
  it("app_call_tool invokes the instance by key, slug, or the member's own", async () => {
    calls.length = 0;
    expect(await main.callInstanceTool("expense-desk", "list_expenses", { q: 1 })).toEqual([{ id: 1 }]);
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/api/app-instances/expense-desk/invoke", body: { tool: "list_expenses", args: { q: 1 } } });
    await expect(main.callInstanceTool("missing", "x", {})).rejects.toThrow(/not installed in the cloud/);
    expect(await main.listInstanceTools()).toHaveLength(1);
  });
  it("glyphh.call from a panel is POST /app-host/<key>/call as the member, the pod's answer passed through", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ ok: true, result: { pong: true } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    expect(await main.callInstanceBridge("expense-desk", "ping", { a: 1 }, fetchImpl)).toEqual({ ok: true, result: { pong: true } });
    expect(seen[0].url).toBe("https://api.test/app-host/expense-desk/call");
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ method: "ping", args: { a: 1 } });
  });
  it("a refusal is the pod's error line; signed out is said plainly", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: "forbidden", detail: "app expense-desk is not open to you" }), { status: 403 })) as typeof fetch;
    expect(await main.callInstanceBridge("expense-desk", "ping", {}, fetchImpl)).toEqual({ ok: false, error: "app expense-desk is not open to you" });
    token = null;
    expect(await main.callInstanceBridge("expense-desk", "ping", {}, fetchImpl)).toEqual({ ok: false, error: "signed out" });
    token = "tok-1";
  });
  it("the panel URL is the server's proxy, ui/ with a trailing slash", () => {
    expect(main.instancePanelUrl("expense-desk")).toBe("https://api.test/app-host/expense-desk/ui/");
  });
});

// ── app_deploy: the thread's folder → a release ──────────────────────────────
/** A fake fs for the folder rules: which paths exist, what manifest.json holds. */
const fakeFs = (files: Record<string, string>, dirs: string[] = ["/work/recall"]) => ({
  existsSync: (p: fs.PathLike) => Object.prototype.hasOwnProperty.call(files, String(p)) || dirs.includes(String(p)),
  statSync: ((p: fs.PathLike) => { if (dirs.includes(String(p))) return { isDirectory: () => true } as fs.Stats; throw new Error("ENOENT"); }) as typeof fs.statSync,
  readFileSync: ((p: fs.PathLike) => { if (!(String(p) in files)) throw new Error("ENOENT"); return files[String(p)]; }) as typeof fs.readFileSync,
});
const PROJECT_MANIFEST = JSON.stringify({ manifestVersion: 3, kind: "glyphh-app", name: "Recall", slug: "recall", capabilities: ["db.exec"], connectors: [], tools: [{ name: "ask", handler: "ask" }] });
const GOOD = { "/work/recall/manifest.json": PROJECT_MANIFEST, "/work/recall/package.json": "{}" };

describe("checkDeployFolder — the thread's folder is the sandbox", () => {
  it("refuses with no folder set, a folder that is not a directory, no manifest.json or no package.json", () => {
    expect(() => main.checkDeployFolder(null, "recall", fakeFs(GOOD))).toThrow(/no folder is set/);
    expect(() => main.checkDeployFolder("", "recall", fakeFs(GOOD))).toThrow(/no folder is set/);
    expect(() => main.checkDeployFolder("/work/else", "recall", fakeFs(GOOD))).toThrow(/not a directory/);
    expect(() => main.checkDeployFolder("/work/recall", "recall", fakeFs({ "/work/recall/package.json": "{}" }))).toThrow(/no manifest\.json/);
    expect(() => main.checkDeployFolder("/work/recall", "recall", fakeFs({ "/work/recall/manifest.json": PROJECT_MANIFEST }))).toThrow(/no package\.json/);
  });
  it("refuses a manifest that is not JSON, names no slug, or names another app than the call", () => {
    expect(() => main.checkDeployFolder("/work/recall", "recall", fakeFs({ ...GOOD, "/work/recall/manifest.json": "{nope" }))).toThrow(/not valid JSON/);
    expect(() => main.checkDeployFolder("/work/recall", "recall", fakeFs({ ...GOOD, "/work/recall/manifest.json": "[]" }))).toThrow(/JSON object/);
    expect(() => main.checkDeployFolder("/work/recall", "recall", fakeFs({ ...GOOD, "/work/recall/manifest.json": JSON.stringify({ name: "Recall" }) }))).toThrow(/names no slug/);
    expect(() => main.checkDeployFolder("/work/recall", "other", fakeFs(GOOD))).toThrow(/is the app "recall" but the call named "other"/);
    expect(() => main.checkDeployFolder("/work/recall", "", fakeFs(GOOD))).toThrow(/needs the app's slug/);
  });
  it("answers the folder and the manifest (slug lowercased) when the shape holds", () => {
    const p = main.checkDeployFolder("/work/recall", "Recall", fakeFs(GOOD));
    expect(p.folder).toBe("/work/recall");
    expect(p.manifest).toMatchObject({ slug: "recall", name: "Recall", tools: [{ name: "ask" }] });
  });
});

describe("packProjectFolder — the source tgz", () => {
  it("tars the folder minus node_modules, .next, out and .git at any depth", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glyphh-deploy-"));
    try {
      for (const rel of ["manifest.json", "package.json", "app/page.js", "worker.js", "node_modules/next/index.js", ".next/cache/x", "out/index.html", ".git/HEAD", "lib/.git/config", "lib/node_modules/y.js", "lib/util.js"]) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), rel);
      }
      const tgz = await main.packProjectFolder(dir);
      expect(tgz.length).toBeGreaterThan(0);
      const file = path.join(dir, "..", path.basename(dir) + ".tgz");
      fs.writeFileSync(file, tgz);
      const entries: string[] = [];
      await tarList({ file, onReadEntry: (e) => { entries.push(e.path); } });
      fs.rmSync(file, { force: true });
      const files = entries.filter((e) => !e.endsWith("/")).sort();
      expect(files).toEqual(["app/page.js", "lib/util.js", "manifest.json", "package.json", "worker.js"]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("deployFolderAsInstance — builds → PUT the source → runBuild", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glyphh-deploy-"));
  fs.writeFileSync(path.join(dir, "manifest.json"), PROJECT_MANIFEST);
  fs.writeFileSync(path.join(dir, "package.json"), "{}");
  const pack = async () => Buffer.from("tgzbytes");
  const puts: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => { puts.push({ url: String(url), init: init! }); return new Response(null, { status: 200 }); }) as typeof fetch;
  const RECALL: AppInstanceSummary = { ...ORG, key: "recall", slug: "recall", manifest: { name: "Recall", tools: [{ name: "ask" }, { name: "ingest" }], capabilities: ["db.exec"], connectors: [] }, release: 1 };

  const sleep = async () => undefined;
  it("deploys onto the existing instance of that slug: no create, source PUT as gzip, the build run with the note AS A JOB that is followed to ready, the log a tail", async () => {
    calls.length = 0; puts.length = 0; listed = [RECALL];
    const logs: string[] = [];
    const out = await main.deployFolderAsInstance(dir, { slug: "recall", note: "second", fetchImpl, pack, sleep, onLog: (l) => logs.push(l) });
    expect(calls.filter((c) => c.method === "SDK").map((c) => c.path)).toEqual(["builds recall"]);
    expect(calls.find((c) => c.path === "/api/app-instances/recall/builds/3/run")?.body).toEqual({ note: "second" });
    expect(calls.filter((c) => c.path === `/api/app-instances/jobs/${JOB_ID}`)).toHaveLength(2);
    expect(logs[0]).toBe("npm ci");
    expect(out.mode).toBe("source");
    expect(out.job?.status).toBe("ready");
    expect(out.url).toBe("/app-host/recall/ui/");
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe("https://r2.test/put-source");
    expect(puts[0].init.method).toBe("PUT");
    expect((puts[0].init.headers as Record<string, string>)["content-type"]).toBe("application/gzip");
    expect(out.key).toBe("recall");
    expect(out.release).toEqual(RELEASE);
    expect(out.log.length).toBe(main.DEPLOY_LOG_TAIL_CHARS);
    expect(out.log.endsWith("build ok")).toBe(true);
    expect(out.tools).toEqual(["ask", "ingest"]);
  });
  it("with no instance yet, creates one first (org, falling back to personal when refused) with the source's identity standing in for the bundle", async () => {
    calls.length = 0; puts.length = 0; listed = []; forbidOrg = true;
    const out = await main.deployFolderAsInstance(dir, { slug: "recall", fetchImpl, pack, sleep });
    const made = calls.filter((c) => c.path === "create").map((c) => c.body as { kind: string; slug: string; bundle: { sizeBytes: number } });
    expect(made.map((m) => m.kind)).toEqual(["org", "personal"]);
    expect(made[1]).toMatchObject({ slug: "recall", bundle: { sizeBytes: 8 } });
    expect(calls.filter((c) => c.method === "SDK").map((c) => c.path)).toEqual(["create", "create", "builds recall~u1"]);
    expect(calls.some((c) => c.path === "/api/app-instances/recall~u1/builds/3/run")).toBe(true);
    expect(out.key).toBe("recall~u1");
    // No live row answers yet: the folder's declared tools stand in.
    expect(out.tools).toEqual(["ask"]);
    forbidOrg = false;
  });
  it("`kind` names the instance: a personal deploy never touches the org's", async () => {
    calls.length = 0; listed = [RECALL];
    await main.deployFolderAsInstance(dir, { slug: "recall", kind: "personal", fetchImpl, pack, sleep });
    expect(calls.filter((c) => c.method === "SDK").map((c) => c.path)).toEqual(["create", "builds recall~u1"]);
    expect((calls.find((c) => c.path === "create")!.body as { kind: string }).kind).toBe("personal");
  });
  it("refuses the folder rules before any call, and a refused upload before the build", async () => {
    calls.length = 0; listed = [RECALL];
    await expect(main.deployFolderAsInstance(null, { slug: "recall", fetchImpl, pack })).rejects.toThrow(/no folder is set/);
    await expect(main.deployFolderAsInstance(dir, { slug: "other", fetchImpl, pack })).rejects.toThrow(/the call named "other"/);
    expect(calls.filter((c) => c.method === "SDK")).toHaveLength(0);
    const refuse = (async () => new Response(null, { status: 403 })) as typeof fetch;
    await expect(main.deployFolderAsInstance(dir, { slug: "recall", fetchImpl: refuse, pack })).rejects.toThrow(/source upload was refused/);
    expect(calls.filter((c) => c.method === "SDK").map((c) => c.path)).toEqual(["builds recall"]);
    listed = [ORG];
  });
  it("wait: false answers at once with the job and no release; a failed job is an error that carries the log", async () => {
    calls.length = 0; listed = [RECALL];
    const out = await main.deployFolderAsInstance(dir, { slug: "recall", fetchImpl, pack, wait: false });
    expect(out.release).toBeNull();
    expect(out.job).toMatchObject({ id: JOB_ID, status: "queued" });
    expect(calls.filter((c) => c.path === `/api/app-instances/jobs/${JOB_ID}`)).toHaveLength(0);
    jobFails = true;
    await expect(main.deployFolderAsInstance(dir, { slug: "recall", fetchImpl, pack, sleep })).rejects.toThrow(/the build failed: next build exited 1[\s\S]*npm ERR! boom/);
    jobFails = false;
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("ONE DOOR, BY PATH (2026-10-07): installFolderAsInstance", () => {
  const RECALL: AppInstanceSummary = { ...ORG, key: "recall", slug: "recall", manifest: { name: "Recall", tools: [{ name: "ask" }], capabilities: ["db.exec"], connectors: [] }, release: 1 };
  const fetchImpl = (async () => new Response(null, { status: 200 })) as typeof fetch;
  it("a folder with a build script is SOURCE: the build job lane", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glyphh-src-"));
    fs.writeFileSync(path.join(dir, "manifest.json"), PROJECT_MANIFEST);
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { build: "next build" } }));
    expect(main.folderShapeOf(dir)).toBe("source");
    calls.length = 0; listed = [RECALL];
    const out = await main.installFolderAsInstance(dir, { fetchImpl, pack: async () => Buffer.from("tgz"), sleep: async () => undefined });
    expect(out.mode).toBe("source");
    expect(out.key).toBe("recall");
    expect(out.release).toEqual(RELEASE);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("a folder with manifest.json + its entry is a BUNDLE: zipped, created, PUT, readied with the note; the slug must agree", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glyphh-bundle-"));
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ manifestVersion: 2, kind: "glyphh-app", name: "Recall", slug: "recall", entry: "index.html", capabilities: [], tools: [{ name: "ask" }] }));
    fs.writeFileSync(path.join(dir, "index.html"), "<html></html>");
    fs.mkdirSync(path.join(dir, "node_modules/x"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules/x/i.js"), "1");
    expect(main.folderShapeOf(dir)).toBe("bundle");
    const zipped = main.zipBundleFolder(dir);
    expect(zipped.length).toBeGreaterThan(0);
    calls.length = 0; readyBodies.length = 0; listed = [];
    const out = await main.installFolderAsInstance(dir, { fetchImpl, kind: "org", note: "first" });
    expect(out.mode).toBe("bundle");
    expect(out.job).toBeNull();
    expect(out.release?.n).toBe(7);
    // The LIVE summary's tools win over the folder's declared ones (the fixture's /ready answers the org row).
    expect(out.tools).toEqual(["list_expenses"]);
    expect(readyBodies).toEqual([{ note: "first" }]);
    expect(calls.map((c) => `${c.method} ${c.path}`).slice(0, 2)).toEqual(["POST /api/app-instances", "POST /api/app-instances/expense-desk/ready"]);
    await expect(main.installFolderAsInstance(dir, { fetchImpl, slug: "other" })).rejects.toThrow(/is the app "recall" but the call named "other"/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("refuses what it cannot read: no folder, no manifest, a bundle whose entry is missing", async () => {
    await expect(main.installFolderAsInstance("", {})).rejects.toThrow(/no folder/);
    await expect(main.installFolderAsInstance("/nope/none", {})).rejects.toThrow(/not a directory/);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glyphh-empty-"));
    await expect(main.installFolderAsInstance(dir, {})).rejects.toThrow(/no manifest\.json/);
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ kind: "glyphh-app", name: "X", slug: "x", entry: "ui/index.html" }));
    await expect(main.installFolderAsInstance(dir, {})).rejects.toThrow(/entry "ui\/index\.html" is not in it/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("the base64 door is capped: a flood is refused with the path door named", () => {
    expect(() => main.refuseBase64Flood("a".repeat(main.BASE64_INPUT_CAP))).not.toThrow();
    expect(() => main.refuseBase64Flood("a".repeat(main.BASE64_INPUT_CAP + 1))).toThrow(/Pass `dir` instead/);
  });
  it("a build job id is checked before any read; waiting stops at the deadline with the job as it stands", async () => {
    expect(() => main.readBuildJob("nope")).toThrow(/not a build job id/);
    calls.length = 0; jobReads = 0;
    // one read (building), the deadline already passed: answered still building
    const j = await main.waitBuildJob(JOB_ID, { timeoutMs: 0, sleep: async () => undefined });
    expect(j.status).toBe("building");
  });
});

describe("app_releases / app_pin / the Rollback IPC", () => {
  it("lists the releases of the instance a ref names", async () => {
    calls.length = 0; listed = [ORG];
    const rows = await main.listInstanceReleases("expense-desk");
    expect(rows.map((r) => [r.n, r.pinned])).toEqual([[1, false], [2, true]]);
    await expect(main.listInstanceReleases("missing")).rejects.toThrow(/not installed in the cloud/);
  });
  it("pins a release by key; n must be a release number", async () => {
    calls.length = 0;
    expect((await main.pinInstanceRelease("expense-desk", 1)).release).toBe(1);
    expect(calls.at(-1)?.path).toBe("pin expense-desk 1");
    await expect(main.pinInstanceRelease("expense-desk", 0)).rejects.toThrow(/release number/);
    await expect(main.pinInstanceRelease("expense-desk", 1.5)).rejects.toThrow(/release number/);
  });
  it("the app-instance-pin IPC takes the card id or the key and answers the envelope", async () => {
    calls.length = 0;
    const ok = await main.appInstancePinHandler(instanceCardId("expense-desk"), 1);
    expect(ok).toMatchObject({ ok: true, data: { key: "expense-desk", release: 1 } });
    expect(calls.at(-1)?.path).toBe("pin expense-desk 1");
    expect(await main.appInstancePinHandler("expense-desk", 2)).toMatchObject({ ok: true, data: { release: 2 } });
    expect(await main.appInstancePinHandler("missing", 1)).toMatchObject({ ok: false, error: expect.stringMatching(/not installed in the cloud/) });
    expect(await main.appInstancePinHandler("expense-desk", NaN)).toMatchObject({ ok: false, error: expect.stringMatching(/release number/) });
  });
});
