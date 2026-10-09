/**
 * thread-publish.test.ts — the desktop's threads on the server (main/thread-
 * publish.ts): the index rides once per change, the transcript appends from a
 * per-thread `syncedUpTo` (a restart never re-sends what landed), a stale
 * append retries once with a fresh clock, a shrunk transcript is replaced
 * whole, a cloud thread is never the publisher's, and a tombstoned thread is
 * left alone. Pure over a fake `client.sessions`.
 */
import { describe, expect, it, vi } from "vitest";
import { ApiError, type PushThreadResult, type SessionThreadMessage } from "@glyphh/sdk";

vi.mock("electron", () => ({ ipcMain: { handle: () => undefined } }));
vi.mock("../../src/main/auth.js", () => ({ isAuthenticated: () => true }));
vi.mock("../../src/main/glyphh-client.js", () => ({ getClient: () => ({ sessions: {} }) }));
vi.mock("../../src/main/agent-ipc.js", () => ({ listStoredChats: () => [] }));
vi.mock("../../src/main/app-paths.js", () => ({ userScopedPath: (s: string) => `/tmp/${s}` }));

import { madeHere, createThreadPublisher, fetchTranscript, projectMessage, threadIndexOf, type ThreadStates, type ThreadsApi } from "../../src/main/thread-publish.js";
import type { RelayChat } from "../../src/main/agent-ipc.js";

function fakeSessions(opts: { stale?: (id: string, at: number) => boolean; dead?: string[] } = {}) {
  const threads = new Map<string, { updatedAt: number; messages: SessionThreadMessage[]; title: string; mode: string; source: unknown }>();
  const meta = (id: string) => { const t = threads.get(id)!; return { id, title: t.title, mode: t.mode, source: t.source, createdAt: 0, updatedAt: t.updatedAt, messageCount: t.messages.length }; };
  const api: ThreadsApi = {
    threads: vi.fn(async () => [...threads.keys()].map(meta)),
    thread: vi.fn(async (id) => ({ ...meta(id), messages: threads.get(id)!.messages.slice(-20) })),
    pushThread: vi.fn(async (id, body): Promise<PushThreadResult> => {
      if (opts.dead?.includes(id)) throw new ApiError({ code: "gone", message: "tombstoned", httpStatus: 410 });
      const cur = threads.get(id);
      const applied = !cur || body.updatedAt > cur.updatedAt;
      if (applied) threads.set(id, { updatedAt: body.updatedAt, messages: body.messages ? [...body.messages] : cur?.messages ?? [], title: body.title ?? cur?.title ?? "", mode: body.mode ?? cur?.mode ?? "code", source: body.source ?? cur?.source ?? null });
      return { applied, thread: meta(id) };
    }),
    appendMessages: vi.fn(async (id, body): Promise<PushThreadResult> => {
      const cur = threads.get(id);
      if (!cur) throw new ApiError({ code: "not_found", message: "no thread", httpStatus: 404 });
      if (opts.stale?.(id, body.updatedAt) || body.updatedAt <= cur.updatedAt) throw new ApiError({ code: "stale", message: "stale", httpStatus: 409 });
      cur.messages.push(...body.messages);
      cur.updatedAt = body.updatedAt;
      return { applied: true, thread: meta(id) };
    }),
    deleteThread: vi.fn(async (id) => { if (!threads.delete(id)) throw new ApiError({ code: "not_found", message: "no", httpStatus: 404 }); }),
  };
  return { api, threads };
}

const memState = (init: ThreadStates = {}) => { let s = init; return { read: () => JSON.parse(JSON.stringify(s)) as ThreadStates, write: (n: ThreadStates) => { s = n; }, get: () => s }; };
const chat = (id: string, n: number, extra: Partial<RelayChat> = {}): RelayChat => ({
  id, title: `Thread ${id}`, createdAt: 1_000, updatedAt: 1_000 + n, mode: "code", workdir: "/w",
  messages: Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: `m${i}` })), ...extra,
});

describe("the index", () => {
  it("a NEW thread is created in one PUT (index + first messages); afterwards the index rides alone, once per change, stamped local", async () => {
    const { api, threads } = fakeSessions();
    const chats = [chat("c1", 2)];
    const state = memState();
    const pub = createThreadPublisher({ api, chats: () => chats, state });
    const r = await pub.publishAll();
    expect(r.indexed).toEqual(["c1"]);
    expect(api.pushThread).toHaveBeenCalledWith("c1", { title: "Thread c1", mode: "code", source: { kind: "local", path: "/w", locus: "local" }, updatedAt: 1_002, messages: [{ role: "user", text: "m0" }, { role: "assistant", text: "m1" }] });
    expect(api.appendMessages).not.toHaveBeenCalled();
    expect(threads.get("c1")!.messages.map((m) => m.text)).toEqual(["m0", "m1"]);
    // Again, unchanged: nothing rides.
    await pub.publishAll();
    expect(api.pushThread).toHaveBeenCalledTimes(1);
    // A rename: the index rides again — WITHOUT messages.
    chats[0].title = "Renamed"; chats[0].updatedAt = 2_000;
    await pub.publishAll();
    expect(api.pushThread).toHaveBeenCalledTimes(2);
    expect((api.pushThread as ReturnType<typeof vi.fn>).mock.calls[1][1]).toEqual({ title: "Renamed", mode: "code", source: { kind: "local", path: "/w", locus: "local" }, updatedAt: 2_000 });
    expect(api.appendMessages).not.toHaveBeenCalled();
    expect(state.get().c1).toMatchObject({ syncedUpTo: 2, publishedAt: 2_000 });
  });

  it("threadIndexOf folds the type and the folder; projectMessage caps the text and drops non-messages", () => {
    expect(threadIndexOf({ id: "x", title: "  ", mode: "chat", source: { kind: "local", path: "/p", extra: 1 } })).toMatchObject({ title: "New session", mode: "code", source: { kind: "local", path: "/p", extra: 1, locus: "local" } });
    expect(projectMessage({ role: "user", text: "x".repeat(70_000), at: 5 })).toMatchObject({ role: "user", at: 5 });
    expect((projectMessage({ role: "user", text: "x".repeat(70_000) }) as { text: string }).text.length).toBe(60_001);
    expect(projectMessage({ text: "no role" })).toBeNull();
    expect(projectMessage("nope")).toBeNull();
  });
});

describe("the transcript", () => {
  it("appends only what is after syncedUpTo — across restarts (the state file) and in 500-message batches, each write strictly after the last", async () => {
    const { api, threads } = fakeSessions();
    const c = chat("c1", 3);
    const state = memState();
    await createThreadPublisher({ api, chats: () => [c], state }).publishAll();
    expect(threads.get("c1")!.messages).toHaveLength(3);
    // Two turns later, a NEW publisher over the same state (a restart):
    c.messages!.push({ role: "user", text: "m3" }, { role: "assistant", text: "m4" });
    c.updatedAt = 5_000;
    const r = await createThreadPublisher({ api, chats: () => [c], state }).publishAll();
    expect(r.appended).toEqual({ c1: 2 });
    expect(api.appendMessages).toHaveBeenCalledWith("c1", { messages: [{ role: "user", text: "m3" }, { role: "assistant", text: "m4" }], updatedAt: 5_000 });
    expect(threads.get("c1")!.messages.map((m) => m.text)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(threads.get("c1")!.updatedAt).toBe(5_000);         // the server's clock IS the thread's — no drift
    // A long thread: the first 500 ride with the PUT, the rest append in batches of 500, clocks strictly increasing.
    const big = chat("big", 1_203);
    const r2 = await createThreadPublisher({ api, chats: () => [big], state }).publishAll();
    expect(r2.appended).toEqual({ big: 703 });
    const appends = (api.appendMessages as ReturnType<typeof vi.fn>).mock.calls.filter((k) => k[0] === "big");
    expect(appends.map((k) => k[1].messages.length)).toEqual([500, 203]);
    expect(appends.map((k) => k[1].updatedAt)).toEqual([2_204, 2_205]);  // the PUT was at 2_203
    expect(threads.get("big")!.messages).toHaveLength(1_203);
  });

  it("a stale append (409: another surface moved the clock) retries ONCE strictly after the server's clock; refused twice, it waits for the next save", async () => {
    let refusals = 0;
    const { api, threads } = fakeSessions({ stale: (id, at) => id === "c1" && at === 1_002 });
    const c = chat("c1", 0);
    const state = memState();
    const pub = createThreadPublisher({ api, chats: () => [c], state, log: () => { refusals++; } });
    await pub.publishAll();                                    // created, empty
    c.messages = [{ role: "user", text: "m0" }, { role: "assistant", text: "m1" }]; c.updatedAt = 1_002;
    await pub.publishAll();
    expect(threads.get("c1")!.messages).toHaveLength(2);
    expect(api.appendMessages).toHaveBeenCalledTimes(2);
    expect((api.appendMessages as ReturnType<typeof vi.fn>).mock.calls[1][1].updatedAt).toBeGreaterThan(1_002);
    expect(state.get().c1.syncedUpTo).toBe(2);
    expect(refusals).toBe(0);
    // Refused on both tries: syncedUpTo stays, the next save re-tries.
    const always = fakeSessions({ stale: () => true });
    const c2 = chat("c2", 0);
    const s2 = memState();
    const log = vi.fn();
    const pub2 = createThreadPublisher({ api: always.api, chats: () => [c2], state: s2, log });
    await pub2.publishAll();
    c2.messages = [{ role: "user", text: "m0" }]; c2.updatedAt = 1_001;
    await pub2.publishAll();
    expect(s2.get().c2.syncedUpTo).toBe(0);
    expect(always.api.appendMessages).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/stale twice/));
  });

  it("a SHRUNK transcript (compaction) is replaced whole through pushThread's messages, and syncedUpTo resets", async () => {
    const { api, threads } = fakeSessions();
    const c = chat("c1", 6);
    const state = memState();
    const pub = createThreadPublisher({ api, chats: () => [c], state });
    await pub.publishAll();
    c.messages = [{ role: "assistant", text: "summary" }, { role: "user", text: "m5" }];
    c.updatedAt = 9_000;
    const r = await pub.publishAll();
    expect(r.replaced).toEqual(["c1"]);
    expect(threads.get("c1")!.messages.map((m) => m.text)).toEqual(["summary", "m5"]);
    expect(state.get().c1.syncedUpTo).toBe(2);
    expect(api.appendMessages).not.toHaveBeenCalled();        // created by PUT, replaced by PUT
    // Then a turn appends after the replacement.
    c.messages.push({ role: "assistant", text: "m6" }); c.updatedAt = 9_500;
    await pub.publishAll();
    expect(api.appendMessages).toHaveBeenCalledWith("c1", { messages: [{ role: "assistant", text: "m6" }], updatedAt: 9_500 });
    expect(threads.get("c1")!.messages.map((m) => m.text)).toEqual(["summary", "m5", "m6"]);
  });
});

describe("the loop that doubled every thread (2026-10-04)", () => {
  it("an index push the server refuses as stale adopts the server's message count: the transcript is NOT re-appended from zero", async () => {
    const { api, threads } = fakeSessions();
    threads.set("c1", { updatedAt: 50_000, messages: Array.from({ length: 6 }, (_, i) => ({ role: "user", text: `m${i}` })), title: "Thread c1", mode: "code", source: null });
    const c = chat("c1", 6);
    const state = memState({ c1: { syncedUpTo: 0, metaSig: "", publishedAt: 1 } });
    const pub = createThreadPublisher({ api, chats: () => [c], state });
    await pub.publishAll();
    expect(api.appendMessages).not.toHaveBeenCalled();
    expect(threads.get("c1")!.messages).toHaveLength(6);
    expect(state.get().c1.syncedUpTo).toBe(6);
  });
  it("a shrink to a transcript longer than one batch lands the tail and appends nothing after it", async () => {
    const { api, threads } = fakeSessions();
    const c = chat("c1", 4);
    const state = memState();
    const pub = createThreadPublisher({ api, chats: () => [c], state });
    await pub.publishAll();
    // Compacted, yet still 700 messages long: the last 500 replace the server copy.
    c.messages = Array.from({ length: 700 }, (_, i) => ({ role: "assistant", text: `k${i}` }));
    state.get().c1.syncedUpTo = 900;
    c.updatedAt = 9_000;
    await pub.publishAll();
    expect(threads.get("c1")!.messages).toHaveLength(500);
    expect(threads.get("c1")!.messages[0].text).toBe("k200");
    expect(api.appendMessages).not.toHaveBeenCalled();
    expect(state.get().c1.syncedUpTo).toBe(700);
  });
  it("publishThread and publishAll never run at once: two passes started together append the transcript once", async () => {
    const { api, threads } = fakeSessions();
    const c = chat("c1", 3);
    const state = memState();
    const pub = createThreadPublisher({ api, chats: () => [c], state });
    await pub.publishAll();
    c.messages.push({ role: "user", text: "m3" }); c.updatedAt = 5_000;
    await Promise.all([pub.publishThread("c1"), pub.publishAll(), pub.publishThread("c1")]);
    expect(threads.get("c1")!.messages.map((m) => m.text)).toEqual(["m0", "m1", "m2", "m3"]);
    expect(state.get().c1.syncedUpTo).toBe(4);
  });
});

describe("the server lost what was published (2026-10-06)", () => {
  it("a thread the server now counts fewer messages of than this side sent is re-sent whole on the next pass", async () => {
    const { api, threads } = fakeSessions();
    const state = memState();
    const chats = [chat("c1", 3)];
    const pub = createThreadPublisher({ api, chats: () => chats, state });
    await pub.publishAll();
    expect(state.get().c1.syncedUpTo).toBe(3);
    threads.get("c1")!.messages = [];            // zeroed on the server by a bad push
    (api.pushThread as ReturnType<typeof vi.fn>).mockClear();
    const r = await pub.publishAll();
    expect(r.replaced).toEqual(["c1"]);
    expect((api.pushThread as ReturnType<typeof vi.fn>).mock.calls[0][1].messages.map((m: { text: string }) => m.text)).toEqual(["m0", "m1", "m2"]);
    expect(threads.get("c1")!.messages.map((m) => m.text)).toEqual(["m0", "m1", "m2"]);
    expect(state.get().c1.syncedUpTo).toBe(3);
    expect(api.appendMessages).not.toHaveBeenCalled();
    const again = await pub.publishAll();
    expect(again.replaced).toEqual([]);          // whole again, nothing more to send
  });
  it("a server list that cannot be read repairs nothing and the pass still runs", async () => {
    const { api } = fakeSessions();
    (api.threads as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("list down"));
    const pub = createThreadPublisher({ api, chats: () => [chat("c1", 2)], state: memState() });
    const r = await pub.publishAll();
    expect(r.indexed).toEqual(["c1"]);
  });
});

describe("what is not the publisher's", () => {
  it("a cloud thread is skipped (the renderer's thread-store pushes its index; the pod holds its transcript)", async () => {
    const { api } = fakeSessions();
    const chats = [chat("cloud", 3, { workdir: undefined, source: { kind: "cloud-new" } }), chat("stub", 0, { workdir: undefined, source: undefined, messages: [] })];
    (chats[1] as { messageCount?: number }).messageCount = 4;
    await createThreadPublisher({ api, chats: () => chats, state: memState() }).publishAll();
    expect(api.pushThread).not.toHaveBeenCalled();
    expect(api.appendMessages).not.toHaveBeenCalled();
  });

  it("a thread the server tombstoned is marked dead and never retried; forget() tombstones and clears the state", async () => {
    const { api } = fakeSessions({ dead: ["dead"] });
    const state = memState({ live: { syncedUpTo: 1, metaSig: "", publishedAt: 1 } });
    const pub = createThreadPublisher({ api, chats: () => [chat("dead", 2)], state, log: () => undefined });
    const r = await pub.publishAll();
    expect(r.skipped).toEqual(["dead"]);
    expect(state.get().dead.dead).toBe(true);
    await pub.publishAll();
    expect(api.pushThread).toHaveBeenCalledTimes(1);
    await pub.forget("live");                                  // 404 = already gone
    expect(state.get().live).toBeUndefined();
    expect(api.deleteThread).toHaveBeenCalledWith("live");
  });

  it("a transport failure ends the pass with the state written so far", async () => {
    const { api } = fakeSessions();
    (api.pushThread as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error("boom"), { name: "x" }));
    const state = memState();
    const log = vi.fn();
    const r = await createThreadPublisher({ api, chats: () => [chat("a", 1), chat("b", 1)], state, log }).publishAll();
    expect(r.indexed).toEqual(["b"]);                          // a plain error skips the thread, the pass goes on
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/thread a: boom/));
  });
});

describe("the transcript url", () => {
  it("fetchTranscript parses NDJSON, skipping torn lines", async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => '{"role":"user","text":"hi"}\n{"role":"assistant","text":"yo"}\nnot json\n\n' });
    expect(await fetchTranscript("https://r2/t", fetchImpl)).toEqual([{ role: "user", text: "hi" }, { role: "assistant", text: "yo" }]);
    await expect(fetchTranscript("u", async () => ({ ok: false, status: 403, text: async () => "" }))).rejects.toThrow(/403/);
  });
});

describe("madeHere — the publisher's own threads (his report, 2026-10-05: a cloud session flipped to the desktop)", () => {
  it("is a thread with a local source, or no source but a folder of its own", () => {
    expect(madeHere({ source: { kind: "local", path: "/w" } })).toBe(true);
    expect(madeHere({ workdir: "/w" })).toBe(true);
    expect(madeHere({ source: null, workdir: "/w" })).toBe(true);
  });
  it("is never a cloud thread, nor a server-born one with no source and no folder, even once its messages were fetched", () => {
    expect(madeHere({ source: { kind: "cloud-new" } })).toBe(false);
    expect(madeHere({ source: { kind: "cloud-repo", repo: "o/r" }, workdir: "/w" })).toBe(false);
    expect(madeHere({})).toBe(false);
    expect(madeHere({ source: null, workdir: "" })).toBe(false);
    // A "local" stamp over the cloud workers' own session root is a cloud session someone republished.
    expect(madeHere({ source: { kind: "local", path: "/data/glyphh-harness/sessions/u_c1/workspace" } })).toBe(false);
    expect(madeHere({ workdir: "/data/glyphh-harness/sessions/u_c1/workspace" })).toBe(false);
  });
});

