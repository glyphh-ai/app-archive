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
import {
  callPathOf, instanceCardOf, instanceDetailOf, instanceKeyOfRow, instanceRequestOf, instanceTabRow, instanceToolRows,
  mergeAppRows, panelPathOf, panelUrlOf, resolveInstance, tabConfigOf, instanceCardId, isInstanceCardId, instanceKeyOfCardId,
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
  it("a tab that names an instance carries its live status", () => {
    const named = tab({ id: "expense-desk", kind: "glyphh", slug: "expense-desk", name: "Expense Desk", config: { instance: "expense-desk" } });
    const rows = mergeAppRows([{ ...ORG, status: "stopped" }], [named]);
    expect(rows[0].launchConfig).toMatchObject({ instance: "expense-desk", instanceStatus: "stopped" });
  });
});

describe("the panel URL", () => {
  it("is the server's proxy at the bundle's entry, the key encoded", () => {
    expect(panelPathOf("expense-desk")).toBe("/app-host/expense-desk/ui/index.html");
    expect(panelPathOf("notes~u1")).toBe("/app-host/notes~u1/ui/index.html");
    expect(panelUrlOf("https://api.glyphh.ai/", "expense-desk")).toBe("https://api.glyphh.ai/app-host/expense-desk/ui/index.html");
    expect(callPathOf("a b")).toBe("/app-host/a%20b/call");
  });
});

describe("the Apps-page card and the tool rows", () => {
  it("a card stands for the instance, with no folder", () => {
    const card = instanceCardOf(ORG, "2026-10-04T00:00:00.000Z");
    expect(card).toMatchObject({ id: "app-instance:expense-desk", type: "app", source: "app", dir: "", fileCount: 0, enabled: true, author: "your organization" });
    expect(card.instance.tools).toEqual(["list_expenses"]);
    expect(isInstanceCardId(card.id)).toBe(true);
    expect(instanceKeyOfCardId(instanceCardId("notes~u1"))).toBe("notes~u1");
    const detail = instanceDetailOf(ORG);
    expect(detail.frontmatter).toMatchObject({ instance: "expense-desk", kind: "org", status: "ready" });
    expect(detail.body).toContain("`list_expenses` — Every expense");
    expect(detail.files).toEqual([]);
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
vi.mock("electron", () => ({ ipcMain: { handle: () => undefined } }));
vi.mock("../../src/main/glyphh-client.js", () => ({
  SERVER_URL: "https://api.test",
  appCache: { cached: async (_k: string, fn: () => Promise<unknown>) => fn(), invalidate: () => undefined },
  getClient: () => ({
    token: async () => { if (!token) throw new Error("signed out"); return token; },
    http: {
      get: async (path: string) => { calls.push({ method: "GET", path }); return path === "/api/app-instances" ? [ORG] : []; },
      post: async (path: string, body?: unknown) => {
        calls.push({ method: "POST", path, body });
        if (path === "/api/app-instances") {
          if (forbidOrg && (body as { kind: string }).kind === "org") { const e = new Error("org admin only") as Error & { code: string }; e.code = "E_FORBIDDEN"; throw e; }
          return { instance: { ...ORG, status: "pending", kind: (body as { kind: "org" | "personal" }).kind }, upload: { url: "https://r2.test/put", key: "bundles/x" } };
        }
        if (path.endsWith("/ready")) return { ...ORG, status: "ready" };
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
  it("the panel URL is the server's proxy", () => {
    expect(main.instancePanelUrl("expense-desk")).toBe("https://api.test/app-host/expense-desk/ui/index.html");
  });
});
