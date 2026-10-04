/**
 * library-sync-core.test.ts — the member library's sync loop (main/library-
 * sync-core.ts) against a fake SDK: a local save pushes, a server row pulls,
 * a local tombstone removes (and a stale delete pulls the row BACK), a server
 * tombstone removes locally, a stale push takes the server's copy, and a
 * folder kind moves its files through the presigned URLs.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, utimesSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type MemberLibraryItem, type MemberLibraryRow } from "@glyphh/sdk";
import { syncKind, type KindAdapter, type LibraryApi, type LocalItem, type PulledFile, type SyncContext } from "../../src/main/library-sync-core.js";
import type { MemberLibraryKind } from "../../src/shared/member-library.js";

// ── A fake server: rows by kind:id, LWW on put/remove, tombstones on the since page ──
function fakeApi(seed: Array<{ kind: MemberLibraryKind; id: string; updatedAt: number; data: unknown; files?: MemberLibraryItem["files"] }> = []) {
  const rows = new Map<string, MemberLibraryItem & { deletedMs: number | null }>();
  const key = (k: string, id: string) => `${k}:${id}`;
  for (const r of seed) rows.set(key(r.kind, r.id), { kind: r.kind, id: r.id, updatedAt: r.updatedAt, deletedAt: null, deletedMs: null, data: r.data, files: r.files ?? [], createdAt: "" });
  const notFound = () => new ApiError({ code: "not_found", message: "not found", httpStatus: 404 });
  const r2 = new Map<string, Uint8Array>();
  const api: LibraryApi = {
    list: vi.fn(async (kind, opts) => {
      const all = [...rows.values()].filter((r) => r.kind === kind);
      if (opts?.since === undefined) return all.filter((r) => r.deletedMs === null).map((r) => ({ kind, id: r.id, updatedAt: r.updatedAt, deletedAt: null, data: r.data })) as MemberLibraryRow[];
      // The since page: tombstones carry deletedAt as a NUMBER and no data.
      return all.filter((r) => r.updatedAt > opts.since!).map((r) => (r.deletedMs !== null
        ? { kind, id: r.id, updatedAt: r.updatedAt, deletedAt: r.deletedMs as unknown as string }
        : { kind, id: r.id, updatedAt: r.updatedAt, deletedAt: null, data: r.data })) as MemberLibraryRow[];
    }),
    get: vi.fn(async (kind, id) => { const r = rows.get(key(kind, id)); if (!r || r.deletedMs !== null) throw notFound(); return r; }),
    put: vi.fn(async (kind, id, input) => {
      const cur = rows.get(key(kind, id));
      const applied = !cur || input.updatedAt > cur.updatedAt;
      if (applied) rows.set(key(kind, id), { kind, id, updatedAt: input.updatedAt, deletedAt: null, deletedMs: null, data: input.data, files: input.files ?? [], createdAt: "" });
      return { applied, item: rows.get(key(kind, id))! };
    }),
    remove: vi.fn(async (kind, id, input = {}) => {
      const cur = rows.get(key(kind, id));
      if (!cur || cur.deletedMs !== null) throw notFound();
      const at = input.updatedAt ?? Date.now();
      if (at <= cur.updatedAt) throw new ApiError({ code: "stale", message: "a newer row stands", httpStatus: 409 });
      rows.set(key(kind, id), { ...cur, updatedAt: at, deletedMs: at, deletedAt: new Date(at).toISOString() });
    }),
    files: vi.fn(async (kind, id, paths) => ({
      put: Object.fromEntries(paths.map((p) => [p, `r2://put/${kind}/${id}/${p}`])),
      get: Object.fromEntries(paths.map((p) => [p, `r2://get/${kind}/${id}/${p}`])),
    })),
  };
  const fetchImpl: SyncContext["fetchImpl"] = vi.fn(async (url, init) => {
    const m = /^r2:\/\/(put|get)\/[^/]+\/[^/]+\/(.+)$/.exec(url)!;
    if (m[1] === "put") { r2.set(m[2], init!.body!); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }; }
    const b = r2.get(m[2]);
    if (!b) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
  });
  return { api, rows, r2, fetchImpl, seedFile: (p: string, text: string) => r2.set(p, new TextEncoder().encode(text)) };
}

// ── A plain (no-files) adapter over a Map ──
function plainAdapter(kind: MemberLibraryKind, seed: Array<{ id: string; updatedAt: number; data: unknown }> = []) {
  const store = new Map(seed.map((r) => [r.id, r]));
  const adapter: KindAdapter = {
    kind, hasFiles: false,
    list: () => [...store.values()].map((r) => ({ id: r.id, updatedAt: r.updatedAt, data: r.data })),
    apply: (item) => { store.set(item.id, { id: item.id, updatedAt: item.updatedAt, data: item.data }); },
    remove: (id) => { store.delete(id); },
  };
  return { adapter, store };
}

// ── A folder adapter over a temp dir (what library-adapters' bundleAdapter does, minimal) ──
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function folderAdapter(kind: "skill" | "task", root: string) {
  const synced = new Map<string, { updatedAt: number; files: { path: string; size: number; mtime: number; sha256: string }[] }>();
  const dirOf = (id: string) => join(root, id);
  const manifest = (id: string) => {
    const dir = dirOf(id);
    if (!existsSync(dir)) return null;
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    return readdirSync(dir).map((name) => { const abs = join(dir, name); const st = statSync(abs); return { path: name, size: st.size, mtime: Math.floor(st.mtimeMs), sha256: sha(readFileSync(abs)), abs }; });
  };
  const adapter: KindAdapter = {
    kind, hasFiles: true,
    list: (): LocalItem[] => {
      const { readdirSync } = require("node:fs") as typeof import("node:fs");
      return readdirSync(root).map((id) => {
        const files = manifest(id)!;
        const held = synced.get(id);
        const sig = files.map((f) => `${f.path}@${f.sha256}`).sort().join();
        const heldSig = held?.files.map((f) => `${f.path}@${f.sha256}`).sort().join();
        const updatedAt = held && heldSig === sig ? held.updatedAt : Math.max(...files.map((f) => f.mtime), (held?.updatedAt ?? 0) + 1);
        return { id, updatedAt, data: { name: id, enabled: true }, files };
      });
    },
    apply: (item, files: PulledFile[] = []) => {
      mkdirSync(dirOf(item.id), { recursive: true });
      for (const f of files) {
        const abs = join(dirOf(item.id), f.path);
        if (f.bytes) writeFileSync(abs, f.bytes);
        utimesSync(abs, new Date(f.mtime), new Date(f.mtime));
      }
    },
    remove: (id) => { require("node:fs").rmSync(dirOf(id), { recursive: true, force: true }); },
    noteSynced: (id, updatedAt, files = []) => { synced.set(id, { updatedAt, files }); },
    lastSyncedFiles: (id) => synced.get(id)?.files ?? null,
    localFiles: (id) => manifest(id)?.map(({ path, size, mtime, sha256 }) => ({ path, size, mtime, sha256 })) ?? null,
  };
  return { adapter, synced };
}

const tombstoneStore = () => {
  const t = new Map<string, number>();
  return {
    t,
    list: (kind: MemberLibraryKind) => [...t.entries()].filter(([k]) => k.startsWith(`${kind}:`)).map(([k, at]) => ({ id: k.slice(kind.length + 1), updatedAt: at })),
    drop: (kind: MemberLibraryKind, id: string) => { t.delete(`${kind}:${id}`); },
    add: (kind: MemberLibraryKind, id: string, at: number) => { t.set(`${kind}:${id}`, at); },
  };
};

describe("the sync loop — plain kinds", () => {
  it("a local row the server lacks is PUSHED; a server row the machine lacks is PULLED; equal clocks are a no-op", async () => {
    const srv = fakeApi([{ kind: "workspace", id: "grid", updatedAt: 2_000, data: { name: "Grid" } }, { kind: "workspace", id: "same", updatedAt: 5_000, data: { name: "Same" } }]);
    const { adapter, store } = plainAdapter("workspace", [{ id: "desk", updatedAt: 3_000, data: { name: "Desk" } }, { id: "same", updatedAt: 5_000, data: { name: "Same" } }]);
    const tomb = tombstoneStore();
    const r = await syncKind({ api: srv.api, adapter, tombstones: tomb, lastSyncAt: null, fetchImpl: srv.fetchImpl });
    expect(r.pushed).toEqual(["desk"]);
    expect(r.pulled).toEqual(["grid"]);
    expect(srv.rows.get("workspace:desk")).toMatchObject({ updatedAt: 3_000, data: { name: "Desk" } });
    expect(store.get("grid")).toEqual({ id: "grid", updatedAt: 2_000, data: { name: "Grid" } });
    expect(srv.api.put).toHaveBeenCalledTimes(1);            // "same" never re-put
    expect(srv.api.list).toHaveBeenCalledTimes(1);           // no since cursor yet → no changed page
  });

  it("a stale push (the server strictly newer) TAKES the server's copy; a newer local edit wins", async () => {
    const srv = fakeApi([{ kind: "agent", id: "ada", updatedAt: 9_000, data: { name: "Ada (web)" } }, { kind: "agent", id: "bob", updatedAt: 1_000, data: { name: "Bob" } }]);
    const { adapter, store } = plainAdapter("agent", [{ id: "ada", updatedAt: 4_000, data: { name: "Ada (old desktop)" } }, { id: "bob", updatedAt: 8_000, data: { name: "Bob 2" } }]);
    const r = await syncKind({ api: srv.api, adapter, tombstones: tombstoneStore(), lastSyncAt: null, fetchImpl: srv.fetchImpl });
    expect(r.pulled).toEqual(["ada"]);                        // reconcile itself routes the older local row to a pull
    expect(r.pushed).toEqual(["bob"]);
    expect(store.get("ada")).toMatchObject({ updatedAt: 9_000, data: { name: "Ada (web)" } });
    expect(srv.rows.get("agent:bob")).toMatchObject({ updatedAt: 8_000, data: { name: "Bob 2" } });
  });

  it("a local tombstone REMOVES on the server (and retires); one the server never knew retires on 404", async () => {
    const srv = fakeApi([{ kind: "tab", id: "crm", updatedAt: 1_000, data: { slug: "crm" } }]);
    const { adapter } = plainAdapter("tab");
    const tomb = tombstoneStore();
    tomb.add("tab", "crm", 2_000);
    tomb.add("tab", "ghost", 2_000);
    const r = await syncKind({ api: srv.api, adapter, tombstones: tomb, lastSyncAt: null, fetchImpl: srv.fetchImpl });
    expect(r.deletedRemote).toEqual(["crm"]);
    expect(srv.rows.get("tab:crm")!.deletedMs).toBe(2_000);
    expect(srv.api.remove).toHaveBeenCalledWith("tab", "crm", { updatedAt: 2_000 });
    expect(tomb.t.size).toBe(0);                              // both retired
  });

  it("a tombstone OLDER than the server's live row loses: reconcile pulls the row back and the tombstone retires — never a delete", async () => {
    const srv = fakeApi([{ kind: "tab", id: "crm", updatedAt: 9_000, data: { slug: "crm", name: "CRM (renamed on web)" } }]);
    const { adapter, store } = plainAdapter("tab");
    const tomb = tombstoneStore();
    tomb.add("tab", "crm", 5_000);
    const log = vi.fn();
    const r = await syncKind({ api: srv.api, adapter, tombstones: tomb, lastSyncAt: null, fetchImpl: srv.fetchImpl, log });
    expect(r.deletedRemote).toEqual([]);
    expect(r.pulled).toEqual(["crm"]);
    expect(srv.api.remove).not.toHaveBeenCalled();
    expect(store.get("crm")).toMatchObject({ updatedAt: 9_000, data: { name: "CRM (renamed on web)" } });
    expect(tomb.t.size).toBe(0);                              // the tombstone lost — retired
    expect(log).not.toHaveBeenCalled();
  });

  it("a STALE delete (409: the server's row moved past the tombstone BETWEEN the list and the delete) pulls the row BACK — never a failure", async () => {
    const srv = fakeApi([{ kind: "tab", id: "crm", updatedAt: 1_000, data: { slug: "crm", name: "CRM" } }]);
    // The race: the web renames the tab right after this machine listed the server.
    const realList = srv.api.list;
    srv.api.list = vi.fn(async (kind, opts) => { const rows = await realList(kind, opts); srv.rows.get("tab:crm")!.updatedAt = 9_000; srv.rows.get("tab:crm")!.data = { slug: "crm", name: "CRM (renamed on web)" }; return rows; });
    const { adapter, store } = plainAdapter("tab");
    const tomb = tombstoneStore();
    tomb.add("tab", "crm", 5_000);
    const log = vi.fn();
    const r = await syncKind({ api: srv.api, adapter, tombstones: tomb, lastSyncAt: null, fetchImpl: srv.fetchImpl, log });
    expect(srv.api.remove).toHaveBeenCalledWith("tab", "crm", { updatedAt: 5_000 });   // asked, refused 409 stale
    expect(r.deletedRemote).toEqual([]);
    expect(r.pulled).toEqual(["crm"]);
    expect(store.get("crm")).toMatchObject({ updatedAt: 9_000, data: { name: "CRM (renamed on web)" } });
    expect(srv.rows.get("tab:crm")!.deletedMs).toBeNull();   // still live on the server
    expect(tomb.t.size).toBe(0);                              // the tombstone lost — retired
    expect(log).not.toHaveBeenCalled();
  });

  it("a SERVER tombstone (on the changed-since page, deletedAt numeric) removes the local row", async () => {
    const srv = fakeApi([{ kind: "workspace", id: "gone", updatedAt: 1_000, data: { name: "Gone" } }, { kind: "workspace", id: "kept", updatedAt: 1_000, data: { name: "Kept" } }]);
    await srv.api.remove("workspace", "gone", { updatedAt: 7_000 });
    const { adapter, store } = plainAdapter("workspace", [{ id: "gone", updatedAt: 1_000, data: { name: "Gone" } }, { id: "kept", updatedAt: 1_000, data: { name: "Kept" } }]);
    const r = await syncKind({ api: srv.api, adapter, tombstones: tombstoneStore(), lastSyncAt: 6_000, fetchImpl: srv.fetchImpl });
    expect(r.deletedLocal).toEqual(["gone"]);
    expect(store.has("gone")).toBe(false);
    expect(store.has("kept")).toBe(true);
    expect(srv.api.list).toHaveBeenCalledWith("workspace", { since: 0 });  // 6_000 − the minute of slack, floored at 0
    expect(r.pushed).toEqual([]);                             // the row the server tombstoned is NOT pushed back
  });

  it("a server tombstone OLDER than a local edit loses: the local row is pushed and revives it", async () => {
    const srv = fakeApi([{ kind: "workspace", id: "w", updatedAt: 1_000, data: { name: "W" } }]);
    await srv.api.remove("workspace", "w", { updatedAt: 3_000 });
    const { adapter } = plainAdapter("workspace", [{ id: "w", updatedAt: 5_000, data: { name: "W edited after" } }]);
    const r = await syncKind({ api: srv.api, adapter, tombstones: tombstoneStore(), lastSyncAt: 2_000, fetchImpl: srv.fetchImpl });
    expect(r.pushed).toEqual(["w"]);
    expect(srv.rows.get("workspace:w")).toMatchObject({ deletedMs: null, updatedAt: 5_000 });
  });
});

describe("the sync loop — folder kinds (skills, tasks)", () => {
  const tmp = () => mkdtempSync(join(tmpdir(), "glyphh-sync-"));

  it("PUSH: the record carries the manifest; every changed file is uploaded to its PUT url after the put", async () => {
    const root = tmp();
    mkdirSync(join(root, "notes"));
    writeFileSync(join(root, "notes", "SKILL.md"), "---\nname: notes\n---\nBody");
    writeFileSync(join(root, "notes", "run.sh"), "echo hi");
    utimesSync(join(root, "notes", "SKILL.md"), new Date(4_000), new Date(4_000));
    utimesSync(join(root, "notes", "run.sh"), new Date(3_000), new Date(3_000));
    const srv = fakeApi();
    const { adapter, synced } = folderAdapter("skill", root);
    const r = await syncKind({ api: srv.api, adapter, tombstones: tombstoneStore(), lastSyncAt: null, fetchImpl: srv.fetchImpl });
    expect(r.pushed).toEqual(["notes"]);
    const row = srv.rows.get("skill:notes")!;
    expect(row.updatedAt).toBe(4_000);                        // the folder's clock = the newest mtime
    expect(row.files.map((f) => f.path).sort()).toEqual(["SKILL.md", "run.sh"]);
    expect(row.files.find((f) => f.path === "run.sh")).toMatchObject({ size: 7, mtime: 3_000, sha256: sha(new TextEncoder().encode("echo hi")) });
    expect(new TextDecoder().decode(srv.r2.get("SKILL.md"))).toBe("---\nname: notes\n---\nBody");
    expect(srv.api.files).toHaveBeenCalledWith("skill", "notes", expect.arrayContaining(["SKILL.md", "run.sh"]));
    expect(synced.get("notes")).toMatchObject({ updatedAt: 4_000 });
    // A second pass: nothing moved → nothing sent.
    const r2 = await syncKind({ api: srv.api, adapter, tombstones: tombstoneStore(), lastSyncAt: r.startedAt, fetchImpl: srv.fetchImpl });
    expect(r2.pushed).toEqual([]); expect(r2.pulled).toEqual([]);
    expect(srv.api.put).toHaveBeenCalledTimes(1);
    // An edit: only the changed file rides, with a clock strictly after the synced one.
    writeFileSync(join(root, "notes", "run.sh"), "echo changed");
    utimesSync(join(root, "notes", "run.sh"), new Date(9_000), new Date(9_000));
    const r3 = await syncKind({ api: srv.api, adapter, tombstones: tombstoneStore(), lastSyncAt: r2.startedAt, fetchImpl: srv.fetchImpl });
    expect(r3.pushed).toEqual(["notes"]);
    expect(srv.rows.get("skill:notes")!.updatedAt).toBe(9_000);
    const puts = (srv.fetchImpl as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[1]?.method === "PUT").map((c) => c[0]);
    expect(puts.filter((u) => u.endsWith("/run.sh"))).toHaveLength(2);
    expect(puts.filter((u) => u.endsWith("/SKILL.md"))).toHaveLength(1);
  });

  it("PULL: the item is read for its manifest, each file downloaded from its GET url and stamped with the manifest's mtime; unchanged bytes are not re-fetched", async () => {
    const root = tmp();
    const srv = fakeApi([{ kind: "task", id: "digest", updatedAt: 8_000, data: { name: "digest", enabled: true }, files: [
      { path: "SKILL.md", size: 5, mtime: 7_000, sha256: sha(new TextEncoder().encode("hello")) },
      { path: "run.js", size: 2, mtime: 7_500, sha256: sha(new TextEncoder().encode("ok")) },
    ] }]);
    srv.seedFile("SKILL.md", "hello"); srv.seedFile("run.js", "ok");
    const { adapter, synced } = folderAdapter("task", root);
    const r = await syncKind({ api: srv.api, adapter, tombstones: tombstoneStore(), lastSyncAt: null, fetchImpl: srv.fetchImpl });
    expect(r.pulled).toEqual(["digest"]);
    expect(readFileSync(join(root, "digest", "SKILL.md"), "utf-8")).toBe("hello");
    expect(Math.floor(statSync(join(root, "digest", "run.js")).mtimeMs)).toBe(7_500);
    expect(synced.get("digest")).toMatchObject({ updatedAt: 8_000 });
    // Stable afterwards: the folder's clock is the server's, nothing pushes.
    const r2 = await syncKind({ api: srv.api, adapter, tombstones: tombstoneStore(), lastSyncAt: r.startedAt, fetchImpl: srv.fetchImpl });
    expect(r2.pushed).toEqual([]); expect(r2.pulled).toEqual([]);
    // The web edits run.js: only that file is fetched again.
    srv.rows.get("task:digest")!.updatedAt = 12_000;
    srv.rows.get("task:digest")!.files = [srv.rows.get("task:digest")!.files[0], { path: "run.js", size: 3, mtime: 12_000, sha256: sha(new TextEncoder().encode("new")) }];
    srv.seedFile("run.js", "new");
    const gets = () => (srv.fetchImpl as ReturnType<typeof vi.fn>).mock.calls.filter((c) => !c[1]?.method).map((c) => c[0]);
    const before = gets().length;
    const r3 = await syncKind({ api: srv.api, adapter, tombstones: tombstoneStore(), lastSyncAt: r2.startedAt, fetchImpl: srv.fetchImpl });
    expect(r3.pulled).toEqual(["digest"]);
    expect(readFileSync(join(root, "digest", "run.js"), "utf-8")).toBe("new");
    expect(gets().slice(before)).toEqual(["r2://get/task/digest/run.js"]);
  });

  it("DELETE: a folder tombstoned here is removed on the server; one tombstoned on the server goes here", async () => {
    const root = tmp();
    mkdirSync(join(root, "gone")); writeFileSync(join(root, "gone", "SKILL.md"), "x");
    utimesSync(join(root, "gone", "SKILL.md"), new Date(1_000), new Date(1_000)); // older than the server's tombstone
    const srv = fakeApi([{ kind: "skill", id: "gone", updatedAt: 1_000, data: {}, files: [] }, { kind: "skill", id: "mine", updatedAt: 1_000, data: {}, files: [] }]);
    await srv.api.remove("skill", "gone", { updatedAt: 5_000 });
    const { adapter } = folderAdapter("skill", root);
    const tomb = tombstoneStore();
    tomb.add("skill", "mine", 6_000);
    const r = await syncKind({ api: srv.api, adapter, tombstones: tomb, lastSyncAt: 4_000, fetchImpl: srv.fetchImpl });
    expect(r.deletedLocal).toEqual(["gone"]);
    expect(existsSync(join(root, "gone"))).toBe(false);
    expect(r.deletedRemote).toEqual(["mine"]);
    expect(srv.rows.get("skill:mine")!.deletedMs).toBe(6_000);
  });
});

describe("the sync loop — drips and schedules (2026-10-04: db rows with cloud storage)", () => {
  it("a preset saved on the desktop PUSHES; one saved on the web PULLS into the table; a web delete lands as a local remove; a desktop delete tombstones the server", async () => {
    const srv = fakeApi([
      { kind: "drip", id: "aurora", updatedAt: 4_000, data: { name: "aurora", recipe: "-1 0.5 aurora" } },
      { kind: "drip", id: "gone", updatedAt: 1_000, data: { name: "gone", recipe: "hearts" } },
    ]);
    const { adapter, store } = plainAdapter("drip", [{ id: "party", updatedAt: 3_000, data: { name: "party", recipe: "3 confetti" } }, { id: "gone", updatedAt: 1_000, data: { name: "gone", recipe: "hearts" } }]);
    const tomb = tombstoneStore();
    tomb.add("drip", "old", 2_500);
    // The web deleted "gone" after the last sync; the since page carries its tombstone.
    await srv.api.remove("drip", "gone", { updatedAt: 6_000 });
    const r = await syncKind({ api: srv.api, adapter, tombstones: tomb, lastSyncAt: 5_000, fetchImpl: srv.fetchImpl });
    expect(r.pushed).toEqual(["party"]);
    expect(r.pulled).toEqual(["aurora"]);
    expect(r.deletedLocal).toEqual(["gone"]);
    expect(srv.rows.get("drip:party")).toMatchObject({ updatedAt: 3_000, data: { name: "party", recipe: "3 confetti" } });
    expect(store.get("aurora")).toEqual({ id: "aurora", updatedAt: 4_000, data: { name: "aurora", recipe: "-1 0.5 aurora" } });
    expect(store.has("gone")).toBe(false);
    expect(tomb.t.size).toBe(0);                              // "old": the server never knew it → retired on 404
  });

  it("a schedule made on the web PULLS whole (the desktop arms it); a desktop edit newer than the server's PUSHES; a desktop delete REMOVES on the server", async () => {
    const web = { name: "Nightly", cron: "0 2 * * *", kind: "task", target: "backup", agentId: null, ownerAgentId: null, args: {}, enabled: true };
    const srv = fakeApi([
      { kind: "schedule", id: "web1", updatedAt: 7_000, data: web },
      { kind: "schedule", id: "s1", updatedAt: 1_000, data: { ...web, name: "Digest", target: "digest" } },
      { kind: "schedule", id: "s2", updatedAt: 1_000, data: { ...web, name: "Brief", target: "brief" } },
    ]);
    const { adapter, store } = plainAdapter("schedule", [{ id: "s1", updatedAt: 8_000, data: { ...web, name: "Digest", target: "digest", enabled: false } }]);
    const tomb = tombstoneStore();
    tomb.add("schedule", "s2", 9_000);
    const r = await syncKind({ api: srv.api, adapter, tombstones: tomb, lastSyncAt: null, fetchImpl: srv.fetchImpl });
    expect(r.pulled).toEqual(["web1"]);
    expect(r.pushed).toEqual(["s1"]);
    expect(r.deletedRemote).toEqual(["s2"]);
    expect(store.get("web1")).toEqual({ id: "web1", updatedAt: 7_000, data: web });
    expect(srv.rows.get("schedule:s1")).toMatchObject({ updatedAt: 8_000, data: { enabled: false } });
    expect(srv.rows.get("schedule:s2")!.deletedMs).toBe(9_000);
    expect(tomb.t.size).toBe(0);
    // A pull never reads the item for a plain kind: the list row carried the data.
    expect(srv.api.get).not.toHaveBeenCalled();
  });
});
