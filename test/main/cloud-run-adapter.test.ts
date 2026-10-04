/**
 * cloud-run-adapter.test.ts — the renderer's HarnessRunHandle over the desktop's
 * cloud lane (remote-run.ts createIpcCloudRun), pure over a fake preload
 * bridge: the start payload crosses verbatim, frames reach subscribers in
 * order (a late subscriber replays the tape), another chat's frames are not
 * ours, `done` settles with the result, an error FRAME resolves (with error
 * set) while a transport failure rejects, and answer / stop / setPermission
 * ride back by the acked run id — a signal abort stops too.
 */
import { describe, expect, it, vi } from "vitest";
import { createIpcCloudRun, type CloudRunIpc, type CloudRunDoneEvent, type CloudRunStartPayload } from "../../src/renderer/help/remote-run.js";

type Frame = { type: string; seq: number; runId: string; at: number; [k: string]: unknown };

function fakeBridge(startReply: { ok: true; runId: string } | { ok: false; error: string } = { ok: true, runId: "run-1" }) {
  const frameCbs = new Set<(p: { chatId: string; runId: string; frame: Frame }) => void>();
  const doneCbs = new Set<(p: CloudRunDoneEvent) => void>();
  const calls = { start: [] as CloudRunStartPayload[], answer: [] as unknown[], stop: [] as unknown[], permission: [] as unknown[] };
  const ipc: CloudRunIpc = {
    cloudRunStart: async (p) => { calls.start.push(p); return startReply; },
    cloudRunAnswer: async (p) => { calls.answer.push(p); return { ok: true }; },
    cloudRunStop: async (p) => { calls.stop.push(p); return { ok: true }; },
    cloudRunPermission: async (p) => { calls.permission.push(p); return { ok: true }; },
    onCloudRunFrame: (cb) => { frameCbs.add(cb as never); return () => { frameCbs.delete(cb as never); }; },
    onCloudRunDone: (cb) => { doneCbs.add(cb); return () => { doneCbs.delete(cb); }; },
  };
  let seq = 0;
  return {
    ipc, calls,
    frame: (chatId: string, f: { type: string; [k: string]: unknown }) => { const frame = { seq: seq++, runId: "run-1", at: 1, ...f } as Frame; for (const cb of frameCbs) cb({ chatId, runId: "run-1", frame }); },
    done: (ev: CloudRunDoneEvent) => { for (const cb of doneCbs) cb(ev); },
    listeners: () => frameCbs.size + doneCbs.size,
  };
}

const start: CloudRunStartPayload = { chatId: "c1", threadId: "c1", prompt: "hello", mode: "code", model: "m", permission: "ask" };
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("createIpcCloudRun", () => {
  it("sends the start payload verbatim, acks whenStarted with the run id, streams frames in order and settles done", async () => {
    const b = fakeBridge();
    const run = createIpcCloudRun(b.ipc, start);
    const seen: string[] = [];
    run.on((f) => seen.push(`${f.type}:${f.seq}`));
    expect(b.calls.start).toEqual([start]);
    expect(await run.whenStarted).toEqual({ runId: "run-1", sessionId: "c1", wire: "glyphh.harness/v1" });
    b.frame("c1", { type: "setup", phase: "model" });
    b.frame("c2", { type: "delta", delta: "not ours" });
    b.frame("c1", { type: "delta", delta: "Hi" });
    b.done({ chatId: "c1", runId: "run-1", ok: true, result: { runId: "run-1", stopped: false, text: "Hi" } });
    expect(seen).toEqual(["setup:0", "delta:2"]);
    expect(await run.done).toEqual({ runId: "run-1", stopped: false, text: "Hi" });
    expect(b.listeners()).toBe(0);
  });

  it("a late subscriber replays the tape first; a frame after done is ignored", async () => {
    const b = fakeBridge();
    const run = createIpcCloudRun(b.ipc, start);
    b.frame("c1", { type: "delta", delta: "a" });
    b.frame("c1", { type: "delta", delta: "b" });
    const seen: string[] = [];
    run.on((f) => seen.push(String(f.delta)));
    expect(seen).toEqual(["a", "b"]);
    b.done({ chatId: "c1", runId: "run-1", ok: true, result: { runId: "run-1", stopped: false, text: "ab" } });
    b.frame("c1", { type: "delta", delta: "c" });
    expect(seen).toEqual(["a", "b"]);
    await run.done;
  });

  it("an error FRAME resolves done with error set; a transport failure rejects it", async () => {
    const b = fakeBridge();
    const run = createIpcCloudRun(b.ipc, start);
    b.frame("c1", { type: "error", error: "boom" });
    b.done({ chatId: "c1", runId: "run-1", ok: true, result: { runId: "run-1", stopped: false, text: "", error: "boom" } });
    expect(await run.done).toMatchObject({ error: "boom" });

    const b2 = fakeBridge();
    const run2 = createIpcCloudRun(b2.ipc, start);
    await run2.whenStarted;
    b2.done({ chatId: "c1", runId: "run-1", ok: false, error: "harness reconnect exhausted" });
    await expect(run2.done).rejects.toThrow("harness reconnect exhausted");
  });

  it("a refused start rejects BOTH whenStarted and done — the typed unavailable path", async () => {
    const b = fakeBridge({ ok: false, error: "worker_unavailable" });
    const run = createIpcCloudRun(b.ipc, start);
    await expect(run.whenStarted).rejects.toThrow("worker_unavailable");
    await expect(run.done).rejects.toThrow("worker_unavailable");
    expect(b.listeners()).toBe(0);
  });

  it("answer, setPermission and stop ride back by the acked run id", async () => {
    const b = fakeBridge();
    const run = createIpcCloudRun(b.ipc, start);
    await run.answer("a1", { allow: true });
    await run.setPermission("auto");
    await run.stop();
    expect(b.calls.answer).toEqual([{ runId: "run-1", id: "a1", reply: { allow: true } }]);
    expect(b.calls.permission).toEqual([{ runId: "run-1", mode: "auto" }]);
    expect(b.calls.stop).toEqual([{ runId: "run-1" }]);
  });

  it("a stop before the ack goes by chatId; an aborted signal stops; a settled run ignores both", async () => {
    const b = fakeBridge();
    const ac = new AbortController();
    const run = createIpcCloudRun(b.ipc, start, ac.signal);
    ac.abort();
    await tick();
    expect(b.calls.stop).toEqual([{ chatId: "c1" }]);
    b.done({ chatId: "c1", runId: "run-1", ok: true, result: { runId: "run-1", stopped: true, text: "" } });
    await run.stop();
    await run.setPermission("auto");
    expect(b.calls.stop).toHaveLength(1);
    expect(b.calls.permission).toHaveLength(0);
    expect(await run.done).toMatchObject({ stopped: true });
  });

  it("a bridge that refuses an answer surfaces as a rejection (remote-run reports it as `late`)", async () => {
    const b = fakeBridge();
    b.ipc.cloudRunAnswer = vi.fn(async () => ({ ok: false, error: "404" }));
    const run = createIpcCloudRun(b.ipc, start);
    await expect(run.answer("a1", { allow: false })).rejects.toThrow("404");
  });
});
