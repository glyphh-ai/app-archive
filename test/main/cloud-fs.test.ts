/**
 * cloud-fs.test.ts — the desktop's cloud fs/git lane (main/cloud-fs.ts)
 * against a fake harness client: every verb reaches the SDK's harness fs
 * with the SESSION's scope and the pod's own argument names, answers ride
 * the desktop's shapes, a transport failure becomes the same shape with its
 * message (never a rejected invoke), and signed out / no scope refuse the
 * same way without touching the client.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: () => undefined } }));
vi.mock("../../src/main/auth.js", () => ({ isAuthenticated: () => true }));
vi.mock("../../src/main/glyphh-client.js", () => ({ getClient: () => ({}) }));

import { CLOUD_FS_NO_SCOPE, CLOUD_FS_SIGNED_OUT, createCloudFsLane, type CloudFsHarness } from "../../src/main/cloud-fs.js";

function fakeHarness(over: Partial<CloudFsHarness> = {}) {
  const hc: CloudFsHarness = {
    fsInfo: vi.fn(async () => ({ root: "/ws/th-1", isRepo: true, branch: "main" })),
    fsList: vi.fn(async (o: { dir?: string }) => ({ entries: [{ name: "src", path: `${o.dir ?? "/ws/th-1"}/src`, kind: "dir" }, { name: "a.ts", path: `${o.dir ?? "/ws/th-1"}/a.ts`, kind: "file" }] })),
    fsRead: vi.fn(async () => ({ content: "hello" })),
    fsWrite: vi.fn(async () => ({ ok: true })),
    fsDiff: vi.fn(async () => ({ text: "diff --git a/a.ts b/a.ts\n" })),
    fsSearch: vi.fn(async () => ({ entries: [{ name: "a.ts", rel: "a.ts", path: "/ws/th-1/a.ts", kind: "file" }], truncated: false })),
    fsEvents: vi.fn(async () => ({ seq: 7, root: "/ws/th-1", events: [{ type: "file-changed", path: "/ws/th-1/a.ts" }, { type: "git-changed" }] })),
    ...over,
  };
  return hc;
}

function lane(hc = fakeHarness(), signedIn = true) {
  const harnessViaApi = vi.fn(() => hc);
  const log = vi.fn();
  return { lane: createCloudFsLane({ client: () => ({ harnessViaApi }), signedIn: () => signedIn, log }), hc, harnessViaApi, log };
}

describe("every verb carries the session's scope to the pod", () => {
  it("info → fsInfo({scope}) as root + git identity", async () => {
    const { lane: l, hc } = lane();
    expect(await l.info("th-1")).toEqual({ root: "/ws/th-1", isRepo: true, branch: "main" });
    expect(hc.fsInfo).toHaveBeenCalledWith({ scope: "th-1" });
  });
  it("list → fsList({scope, dir?})", async () => {
    const { lane: l, hc } = lane();
    const r = await l.list("th-1", "/ws/th-1/src");
    expect(r.entries.map((e) => e.name)).toEqual(["src", "a.ts"]);
    expect(hc.fsList).toHaveBeenCalledWith({ scope: "th-1", dir: "/ws/th-1/src" });
    await l.list("th-1");
    expect(hc.fsList).toHaveBeenLastCalledWith({ scope: "th-1" });
  });
  it("read → fsRead({scope, path})", async () => {
    const { lane: l, hc } = lane();
    expect(await l.read("th-1", "/ws/th-1/a.ts")).toEqual({ content: "hello" });
    expect(hc.fsRead).toHaveBeenCalledWith({ scope: "th-1", path: "/ws/th-1/a.ts" });
  });
  it("write → fsWrite({scope, path, content}) — the Editor's save", async () => {
    const { lane: l, hc } = lane();
    expect(await l.write("th-1", "/ws/th-1/a.ts", "x = 1")).toEqual({ ok: true });
    expect(hc.fsWrite).toHaveBeenCalledWith({ scope: "th-1", path: "/ws/th-1/a.ts", content: "x = 1" });
  });
  it("search → fsSearch({scope, query}); an empty query asks nothing", async () => {
    const { lane: l, hc } = lane();
    expect((await l.search("th-1", "a.t")).entries).toHaveLength(1);
    expect(hc.fsSearch).toHaveBeenCalledWith({ scope: "th-1", query: "a.t" });
    expect(await l.search("th-1", "  ")).toEqual({ entries: [] });
    expect(hc.fsSearch).toHaveBeenCalledTimes(1);
  });
  it("events → fsEvents({scope, from}) with the cursor, -1 to establish it", async () => {
    const { lane: l, hc } = lane();
    const page = await l.events("th-1", 3);
    expect(page.seq).toBe(7);
    expect(page.root).toBe("/ws/th-1");
    expect(page.events).toHaveLength(2);
    expect(hc.fsEvents).toHaveBeenCalledWith({ scope: "th-1", from: 3 });
    await l.events("th-1");
    expect(hc.fsEvents).toHaveBeenLastCalledWith({ scope: "th-1", from: -1 });
  });
  it("gitInfo → fsInfo({scope}) as the desktop's git-info shape", async () => {
    const { lane: l, hc } = lane();
    expect(await l.gitInfo("th-1")).toEqual({ isRepo: true, branch: "main" });
    expect(hc.fsInfo).toHaveBeenCalledWith({ scope: "th-1" });
  });
  it("gitDiff → fsDiff({scope}) — the Diff panel", async () => {
    const { lane: l, hc } = lane();
    expect(await l.gitDiff("th-1")).toEqual({ text: "diff --git a/a.ts b/a.ts\n" });
    expect(hc.fsDiff).toHaveBeenCalledWith({ scope: "th-1" });
  });
  it("a scope is trimmed, never padded", async () => {
    const { lane: l, hc } = lane();
    await l.info("  th-1 ");
    expect(hc.fsInfo).toHaveBeenCalledWith({ scope: "th-1" });
  });
});

describe("failures ride in the shape", () => {
  it("the pod's own error shapes pass through", async () => {
    const { lane: l } = lane(fakeHarness({ fsRead: vi.fn(async () => ({ content: "", error: "file too large (2.1MB)" })), fsWrite: vi.fn(async () => ({ ok: false, error: "escape" })) }));
    expect(await l.read("th-1", "/ws/th-1/big")).toEqual({ content: "", error: "file too large (2.1MB)" });
    expect(await l.write("th-1", "/ws/th-1/../x", "")).toEqual({ ok: false, error: "escape" });
  });
  it("a transport failure becomes the same shape with its message", async () => {
    const boom = vi.fn(async () => { throw new Error("503 worker_unavailable"); });
    const { lane: l, log } = lane(fakeHarness({ fsList: boom, fsDiff: boom, fsInfo: boom, fsEvents: boom }));
    expect(await l.list("th-1")).toEqual({ entries: [], error: "503 worker_unavailable" });
    expect(await l.gitDiff("th-1")).toEqual({ text: "", error: "503 worker_unavailable" });
    expect(await l.info("th-1")).toEqual({ root: "", isRepo: false, error: "503 worker_unavailable" });
    expect(await l.gitInfo("th-1")).toEqual({ isRepo: false, error: "503 worker_unavailable" });
    expect(await l.events("th-1", 0)).toEqual({ seq: -1, events: [], error: "503 worker_unavailable" });
    expect(log).toHaveBeenCalled();
  });
  it("a missing path never reaches the pod", async () => {
    const { lane: l, hc } = lane();
    expect(await l.read("th-1", "")).toEqual({ content: "", error: "missing path" });
    expect(await l.write("th-1", "", "x")).toEqual({ ok: false, error: "missing path" });
    expect(hc.fsRead).not.toHaveBeenCalled();
    expect(hc.fsWrite).not.toHaveBeenCalled();
  });
});

describe("the gate", () => {
  it("signed out refuses every verb without a client", async () => {
    const { lane: l, harnessViaApi } = lane(fakeHarness(), false);
    expect(await l.info("th-1")).toEqual({ root: "", isRepo: false, error: CLOUD_FS_SIGNED_OUT });
    expect(await l.list("th-1")).toEqual({ entries: [], error: CLOUD_FS_SIGNED_OUT });
    expect(await l.read("th-1", "/a")).toEqual({ content: "", error: CLOUD_FS_SIGNED_OUT });
    expect(await l.write("th-1", "/a", "")).toEqual({ ok: false, error: CLOUD_FS_SIGNED_OUT });
    expect(await l.search("th-1", "a")).toEqual({ entries: [], error: CLOUD_FS_SIGNED_OUT });
    expect(await l.events("th-1")).toEqual({ seq: -1, events: [], error: CLOUD_FS_SIGNED_OUT });
    expect(await l.gitInfo("th-1")).toEqual({ isRepo: false, error: CLOUD_FS_SIGNED_OUT });
    expect(await l.gitDiff("th-1")).toEqual({ text: "", error: CLOUD_FS_SIGNED_OUT });
    expect(harnessViaApi).not.toHaveBeenCalled();
  });
  it("no scope refuses the same way — a local session has none", async () => {
    const { lane: l, harnessViaApi } = lane();
    expect(await l.list("")).toEqual({ entries: [], error: CLOUD_FS_NO_SCOPE });
    expect(await l.gitDiff(undefined as unknown as string)).toEqual({ text: "", error: CLOUD_FS_NO_SCOPE });
    expect(harnessViaApi).not.toHaveBeenCalled();
  });
});
