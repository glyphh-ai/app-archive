/**
 * cloud-run.test.ts — the desktop's cloud lane (main/cloud-run.ts) against a
 * fake SDK client: a start goes to `client.run({ target: "cloud" })` with the
 * turn's fields, every frame reaches the calling WebContents keyed by chatId
 * and runId, the live ledger is driven like the local loop drives it (working
 * at once, waiting on an approval, red on an error, cleared on done), answer /
 * stop / permission route by runId, an observer replays this desktop's own
 * run, and the picker's spaces + folder browse read the harness fs.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: () => undefined } }));
vi.mock("../../src/main/auth.js", () => ({ isAuthenticated: () => true }));
vi.mock("../../src/main/glyphh-client.js", () => ({ getClient: () => ({}) }));
vi.mock("../../src/main/agent-live.js", () => ({ agentLive: {}, noteRunDelta: () => undefined }));

import { createCloudLane, type CloudLaneClient, type CloudLiveLedger, type CloudRunHandle, type CloudSender } from "../../src/main/cloud-run.js";

/** A fake HarnessRun: the test feeds frames and settles it by hand. */
function fakeHandle(runId = "run-1") {
  const subs = new Set<(f: { type: string; [k: string]: unknown }) => void>();
  let resolveDone!: (r: { runId: string; text?: string; stopped?: boolean; error?: string }) => void;
  let rejectDone!: (e: unknown) => void;
  const done = new Promise<{ runId: string; text?: string; stopped?: boolean; error?: string }>((res, rej) => { resolveDone = res; rejectDone = rej; });
  void done.catch(() => {});
  const tape: Array<{ type: string; [k: string]: unknown }> = [];
  const calls = { answer: [] as unknown[], stop: 0, permission: [] as string[] };
  const handle: CloudRunHandle = {
    runId,
    whenStarted: Promise.resolve({ runId }),
    done,
    on(cb) { for (const f of tape) cb(f); subs.add(cb); return () => { subs.delete(cb); }; },
    answer: async (id, reply) => { calls.answer.push({ id, reply }); },
    stop: async () => { calls.stop += 1; resolveDone({ runId, stopped: true, text: "" }); },
    setPermission: async (mode) => { calls.permission.push(mode); },
  };
  let seq = 0;
  const emit = (f: { type: string; [k: string]: unknown }): void => {
    const frame = { seq: seq++, runId, at: 1, ...f };
    tape.push(frame);
    for (const cb of subs) cb(frame);
  };
  return { handle, emit, calls, finish: (r: { text?: string; stopped?: boolean; error?: string }) => resolveDone({ runId, ...r }), fail: (e: unknown) => rejectDone(e) };
}

function fakeClient(h = fakeHandle()) {
  const runs: unknown[] = [];
  const fs = { spaces: vi.fn(async () => ({ spaces: [{ id: "t1", updatedAt: 5, top: ["src"] }] })), info: vi.fn(async () => ({ root: "/ws" })), list: vi.fn(async (o: { dir?: string }) => ({ entries: [{ name: "src", path: `${o.dir}/src`, kind: "dir" }, { name: "a.ts", path: `${o.dir}/a.ts`, kind: "file" }] })), stopRun: vi.fn(async () => undefined) };
  const stream = { activeRun: vi.fn(async (): Promise<string | null> => { throw new Error("404 not found"); }), attach: vi.fn() };
  const token = vi.fn(async () => "sess-token");
  const client: CloudLaneClient = {
    run: (opts) => { runs.push(opts); return h.handle; },
    harnessViaApi: () => ({ fsSpaces: fs.spaces, fsInfo: fs.info, fsList: fs.list, stopRun: fs.stopRun }),
    token,
    runStream: stream,
  };
  return { client, runs, fs, stream, h, token };
}

function fakeLedger() {
  const rows = new Map<string, { chatId: string; status: string; runId: string; senderId: number }>();
  const events: string[] = [];
  const live: CloudLiveLedger = {
    start: (r) => { rows.set(r.chatId, { chatId: r.chatId, status: "working", runId: r.runId, senderId: r.senderId }); events.push(`start:${r.chatId}`); },
    update: (chatId, patch) => { const cur = rows.get(chatId); if (!cur) return; rows.set(chatId, { ...cur, ...patch } as typeof cur); if (patch.status) events.push(`${patch.status}:${chatId}`); },
    done: (chatId, runId) => { const cur = rows.get(chatId); if (!cur) return; if (runId && cur.runId && runId !== cur.runId) return; events.push(`done:${chatId}`); if (cur.status !== "error") rows.delete(chatId); },
    list: () => [...rows.values()],
  };
  return { live, rows, events };
}

function fakeSender(id = 7) {
  const sent: Array<{ channel: string; payload: unknown }> = [];
  let destroyed = false;
  const sender: CloudSender = { id, send: (channel: string, payload: unknown) => { sent.push({ channel, payload }); }, isDestroyed: () => destroyed };
  return { sender, sent, destroy: () => { destroyed = true; } };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("a cloud turn from the desktop", () => {
  it("starts on the SDK's cloud target with the turn's fields and forwards every frame to the caller, keyed by chatId + runId", async () => {
    const { client, runs, h } = fakeClient();
    const { live, rows } = fakeLedger();
    const deltas: string[] = [];
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: (_c, d) => deltas.push(d) });
    const { sender, sent } = fakeSender();

    const r = await lane.start(sender, { chatId: "c1", threadId: "space-9", prompt: "hello", mode: "code", model: "claude-opus-5", permission: "ask", effort: "high", subdir: "api", repo: "glyphh-ai/app" });
    expect(r).toEqual({ ok: true, runId: "run-1" });
    expect(runs[0]).toEqual({ target: "cloud", threadId: "space-9", prompt: "hello", mode: "code", model: "claude-opus-5", permission: "ask", effort: "high", subdir: "api", repo: "glyphh-ai/app" });
    expect(rows.get("c1")).toMatchObject({ status: "working", runId: "run-1", senderId: 7 });

    h.emit({ type: "setup", phase: "model" });
    h.emit({ type: "delta", delta: "Hi" });
    h.emit({ type: "delta", delta: " there" });
    h.finish({ text: "Hi there" });
    await tick();

    const frames = sent.filter((s) => s.channel === "glyphh-cloud-run:frame").map((s) => s.payload as { chatId: string; runId: string; frame: { type: string } });
    expect(frames.map((f) => [f.chatId, f.runId, f.frame.type])).toEqual([["c1", "run-1", "setup"], ["c1", "run-1", "delta"], ["c1", "run-1", "delta"]]);
    expect(deltas).toEqual(["Hi", " there"]);
    const done = sent.find((s) => s.channel === "glyphh-cloud-run:done")!.payload;
    expect(done).toEqual({ chatId: "c1", runId: "run-1", ok: true, result: { runId: "run-1", stopped: false, text: "Hi there" } });
    expect(rows.has("c1")).toBe(false);
    expect(lane.has("c1")).toBe(false);
  });

  it("drives the rail like the local loop: waiting on an approval, working again on a delta, red on an error frame and kept red after done", async () => {
    const { client, h } = fakeClient();
    const { live, rows, events } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    const { sender } = fakeSender();
    await lane.start(sender, { chatId: "c1", threadId: "c1", prompt: "go", mode: "work" });
    h.emit({ type: "approval", id: "a1", kind: "shell", title: "rm", detail: "" });
    expect(rows.get("c1")?.status).toBe("waiting");
    h.emit({ type: "delta", delta: "ok" });
    expect(rows.get("c1")?.status).toBe("working");
    h.emit({ type: "error", error: "boom" });
    expect(rows.get("c1")?.status).toBe("error");
    h.finish({ text: "ok", error: "boom" });
    await tick();
    expect(rows.get("c1")?.status).toBe("error");
    expect(events).toEqual(["start:c1", "waiting:c1", "working:c1", "error:c1", "done:c1"]);
  });

  it("routes answer, stop and a permission flip by runId; an unknown id is refused", async () => {
    const { client, h } = fakeClient();
    const { live } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    const { sender, sent } = fakeSender();
    await lane.start(sender, { chatId: "c1", threadId: "c1", prompt: "go", mode: "code" });
    expect(await lane.answer({ runId: "run-1", id: "a1", reply: { allow: true } })).toEqual({ ok: true });
    expect(h.calls.answer).toEqual([{ id: "a1", reply: { allow: true } }]);
    expect(await lane.setPermission({ runId: "run-1", mode: "auto" })).toEqual({ ok: true });
    expect(h.calls.permission).toEqual(["auto"]);
    expect(await lane.answer({ runId: "nope", id: "a1", reply: {} })).toMatchObject({ ok: false });
    expect(await lane.stop({ runId: "run-1" })).toEqual({ ok: true });
    expect(h.calls.stop).toBe(1);
    await tick();
    expect(sent.find((s) => s.channel === "glyphh-cloud-run:done")!.payload).toMatchObject({ ok: true, result: { stopped: true } });
  });

  it("a stop by chatId before the ack lands still finds the run", async () => {
    const { client, h } = fakeClient();
    const { live } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    const { sender } = fakeSender();
    const started = lane.start(sender, { chatId: "c1", threadId: "c1", prompt: "go", mode: "code" });
    expect(await lane.stop({ chatId: "c1" })).toEqual({ ok: true });
    expect(h.calls.stop).toBe(1);
    await started;
  });

  it("a worker that cannot be had is a typed failure, the ledger goes red and the caller hears done{ok:false}", async () => {
    const h = fakeHandle();
    const handle = { ...h.handle, whenStarted: Promise.reject(new Error("worker_unavailable")) } as CloudRunHandle;
    void handle.whenStarted!.catch(() => {});
    const { client } = fakeClient({ ...h, handle });
    const { live, rows } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    const { sender, sent } = fakeSender();
    h.fail(new Error("worker_unavailable"));
    const r = await lane.start(sender, { chatId: "c1", threadId: "c1", prompt: "go", mode: "code" });
    expect(r).toEqual({ ok: false, error: "worker_unavailable" });
    await tick();
    expect(sent.find((s) => s.channel === "glyphh-cloud-run:done")!.payload).toEqual({ chatId: "c1", runId: "", ok: false, error: "worker_unavailable" });
    expect(rows.get("c1")?.status).toBe("error");
    expect(lane.has("c1")).toBe(false);
  });

  it("refuses signed out, a missing prompt, and a second turn on a running thread", async () => {
    const { client } = fakeClient();
    const { live } = fakeLedger();
    const { sender } = fakeSender();
    const out = createCloudLane({ client: () => client, signedIn: () => false, live, noteDelta: () => undefined });
    expect(await out.start(sender, { chatId: "c1", threadId: "c1", prompt: "go", mode: "code" })).toEqual({ ok: false, error: "signed out" });
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    expect(await lane.start(sender, { chatId: "c1", threadId: "c1", prompt: "  ", mode: "code" })).toMatchObject({ ok: false });
    await lane.start(sender, { chatId: "c1", threadId: "c1", prompt: "go", mode: "code" });
    expect(await lane.start(sender, { chatId: "c1", threadId: "c1", prompt: "again", mode: "code" })).toEqual({ ok: false, error: "a turn is already running on this thread" });
  });
});

describe("observing a run in flight", () => {
  it("another panel attaching to this desktop's own run gets the run id, the tape so far and the frames after, until it detaches", async () => {
    const { client, h } = fakeClient();
    const { live } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    const owner = fakeSender(1);
    await lane.start(owner.sender, { chatId: "c1", threadId: "space-9", prompt: "go", mode: "code" });
    h.emit({ type: "delta", delta: "first" });
    const watcher = fakeSender(2);
    expect(await lane.attach(watcher.sender, { threadId: "space-9", token: "tok", from: "0" })).toEqual({ ok: true, running: true });
    await tick();
    h.emit({ type: "delta", delta: "second" });
    expect(watcher.sent.map((s) => s.channel)).toEqual(["glyphh-cloud-run:observe-run", "glyphh-cloud-run:observe", "glyphh-cloud-run:observe"]);
    expect(watcher.sent[0]!.payload).toEqual({ token: "tok", runId: "run-1" });
    expect((watcher.sent[2]!.payload as { frame: { delta: string } }).frame.delta).toBe("second");
    expect(lane.detach({ token: "tok" })).toEqual({ ok: true });
    h.emit({ type: "delta", delta: "third" });
    expect(watcher.sent).toHaveLength(3);
    // The owner kept every frame throughout.
    expect(owner.sent.filter((s) => s.channel === "glyphh-cloud-run:frame")).toHaveLength(3);
  });

  it("with nothing running here, a server without a run broker is asked once and never polled", async () => {
    const { client, stream } = fakeClient();
    const { live } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    const { sender } = fakeSender();
    expect(await lane.attach(sender, { threadId: "t-else", token: "tok" })).toEqual({ ok: true, running: false });
    expect(stream.activeRun).toHaveBeenCalledWith("t-else");
    expect(stream.attach).not.toHaveBeenCalled();
    expect(lane.detach({ token: "tok" })).toEqual({ ok: false });
  });

  it("with a run broker, the SDK's watch streams the thread's runs to the token until detached", async () => {
    const { client, stream } = fakeClient();
    stream.activeRun.mockResolvedValue(null);
    let onRun: (id: string) => void = () => undefined;
    let onFrame: (f: { type: string }) => void = () => undefined;
    const stop = vi.fn();
    stream.attach.mockReturnValue({ on: (cb: typeof onFrame) => { onFrame = cb; return () => undefined; }, onRun: (cb: typeof onRun) => { onRun = cb; return () => undefined; }, stop });
    const { live } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    const { sender, sent } = fakeSender();
    expect(await lane.attach(sender, { threadId: "t-web", token: "tok", from: "0" })).toEqual({ ok: true, running: false });
    expect(stream.attach).toHaveBeenCalledWith("t-web", { from: "0" });
    onRun("run-w");
    onFrame({ type: "delta" });
    expect(sent.map((s) => [s.channel, s.payload])).toEqual([
      ["glyphh-cloud-run:observe-run", { token: "tok", runId: "run-w" }],
      ["glyphh-cloud-run:observe", { token: "tok", frame: { type: "delta" } }],
    ]);
    lane.detach({ token: "tok" });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("the cross-surface stop reaches the pod for a run this desktop did not launch, and the local handle for one it did", async () => {
    const { client, fs, h } = fakeClient();
    const { live } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    expect(await lane.stopRun("run-elsewhere")).toEqual({ ok: true });
    expect(fs.stopRun).toHaveBeenCalledWith("run-elsewhere");
    await lane.start(fakeSender().sender, { chatId: "c1", threadId: "c1", prompt: "go", mode: "code" });
    expect(await lane.stopRun("run-1")).toEqual({ ok: true });
    expect(h.calls.stop).toBe(1);
    expect(fs.stopRun).toHaveBeenCalledTimes(1);
  });
});

describe("the picker's cloud sections", () => {
  it("cloud-spaces-list reads the member's spaces from the harness fs; signed out or unreachable lists none", async () => {
    const { client, fs } = fakeClient();
    const { live } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    expect(await lane.spaces()).toEqual({ spaces: [{ id: "t1", updatedAt: 5, top: ["src"] }] });
    fs.spaces.mockRejectedValueOnce(new Error("503"));
    expect(await lane.spaces()).toEqual({ spaces: [] });
    const out = createCloudLane({ client: () => client, signedIn: () => false, live, noteDelta: () => undefined });
    expect(await out.spaces()).toEqual({ spaces: [] });
    expect(fs.spaces).toHaveBeenCalledTimes(2);
  });

  it("cloud-fs-browse answers a workspace's folders in the web's shape, from the root when no dir is named", async () => {
    const { client, fs } = fakeClient();
    const { live } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    expect(await lane.fsBrowse("space-9")).toEqual({ root: "/ws", path: "/ws", entries: [{ name: "src", path: "/ws/src", kind: "dir" }] });
    expect(fs.info).toHaveBeenCalledWith({ scope: "space-9" });
    expect(fs.list).toHaveBeenCalledWith({ dir: "/ws", scope: "space-9" });
    expect(await lane.fsBrowse("space-9", "/ws/src")).toMatchObject({ path: "/ws/src" });
    expect(await lane.fsBrowse("")).toBeNull();
    fs.info.mockRejectedValueOnce(new Error("down"));
    expect(await lane.fsBrowse("space-9")).toBeNull();
  });
});

describe("the cloud terminal's bearer (glyphh-harness-token)", () => {
  it("hands the SDK's current session token to the renderer", async () => {
    const { client, token } = fakeClient();
    const { live } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    expect(await lane.token()).toBe("sess-token");
    expect(token).toHaveBeenCalledTimes(1);
  });

  it("answers null signed out, without asking the SDK", async () => {
    const { client, token } = fakeClient();
    const { live } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => false, live, noteDelta: () => undefined });
    expect(await lane.token()).toBeNull();
    expect(token).not.toHaveBeenCalled();
  });

  it("answers null when the SDK refuses (a refresh the server rejected)", async () => {
    const { client, token } = fakeClient();
    token.mockRejectedValueOnce(new Error("not authenticated"));
    const { live } = fakeLedger();
    const lane = createCloudLane({ client: () => client, signedIn: () => true, live, noteDelta: () => undefined });
    expect(await lane.token()).toBeNull();
  });
});
