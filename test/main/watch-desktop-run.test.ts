/**
 * watch-desktop-run.test.ts — the web watching a desktop thread over the relay
 * (renderer/help/remote-run.ts watchDesktopRun): discover by thread, follow by
 * runId from the last seq, skip a run already finished, close on done, and
 * finish honestly when the ring is gone.
 */
import { describe, it, expect } from "vitest";
import { watchDesktopRun, type DesktopFramesReply, type RemoteRunCallbacks } from "../../src/renderer/help/remote-run.js";

type Call = { params: Record<string, unknown>; opts?: { machineId?: string } };
function fakeRelay(script: DesktopFramesReply[]) {
  const calls: Call[] = [];
  let i = 0;
  const dispatch = async <T,>(_m: string, params?: Record<string, unknown>, opts?: { machineId?: string }): Promise<T> => {
    calls.push({ params: params ?? {}, opts });
    const r = script[Math.min(i, script.length - 1)]; i++;
    return r as unknown as T;
  };
  return { calls, dispatch };
}
const f = (seq: number, o: Record<string, unknown>) => ({ seq, runId: "r1", at: 0, ...o }) as DesktopFramesReply["frames"][number];
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("watchDesktopRun", () => {
  it("discovers a running turn by thread, follows it by runId from the last seq, closes on done", async () => {
    const relay = fakeRelay([
      { runId: "r1", status: "running", frames: [f(0, { type: "prompt", text: "hi" }), f(1, { type: "delta", delta: "he" })] },
      { runId: "r1", status: "running", frames: [f(2, { type: "delta", delta: "llo" })] },
      { runId: "r1", status: "done", frames: [f(3, { type: "done", stopped: false })] },
      { runId: null, status: "idle", frames: [] },
    ]);
    const log: string[] = [];
    const cb: RemoteRunCallbacks = { onUserPrompt: (t) => log.push(`prompt:${t}`), onToken: (d) => log.push(`tok:${d}`), onDone: (t) => log.push(`done:${t}`) };
    const runs: string[] = [];
    let waits = 0;
    const h = watchDesktopRun(relay.dispatch, "chat-a", "m1", cb, (id) => runs.push(id), async () => { waits++; if (waits > 3) h.stop(); await tick(); });
    for (let n = 0; n < 12; n++) await tick();
    expect(runs).toEqual(["r1"]);
    expect(log).toEqual(["prompt:hi", "tok:he", "tok:llo", "done:hello"]);
    expect(relay.calls[0].params).toEqual({ threadId: "chat-a", from: -1 });
    expect(relay.calls[0].opts).toEqual({ machineId: "m1" });
    expect(relay.calls[1].params).toEqual({ runId: "r1", from: 1 });
    expect(relay.calls[2].params).toEqual({ runId: "r1", from: 2 });
    // After the close it is back to discovery by thread.
    expect(relay.calls[3].params).toEqual({ threadId: "chat-a", from: -1 });
  });

  it("a run already finished at discovery is history, not a replay", async () => {
    const relay = fakeRelay([{ runId: "old", status: "done", frames: [f(0, { type: "prompt", text: "then" }), f(1, { type: "done", stopped: false })] }]);
    const log: string[] = [];
    let waits = 0;
    const h = watchDesktopRun(relay.dispatch, "chat-a", undefined, { onUserPrompt: (t) => log.push(t), onDone: () => log.push("done") }, undefined, async () => { waits++; if (waits > 2) h.stop(); await tick(); });
    for (let n = 0; n < 8; n++) await tick();
    expect(log).toEqual([]);
    expect(relay.calls[0].opts).toEqual({});
  });

  it("a ring that went away mid-run ends the turn with what was streamed", async () => {
    const relay = fakeRelay([
      { runId: "r1", status: "running", frames: [f(0, { type: "delta", delta: "part" })] },
      { runId: "r1", status: "gone", frames: [] },
    ]);
    const log: string[] = [];
    let waits = 0;
    const h = watchDesktopRun(relay.dispatch, "chat-a", undefined, { onToken: (d) => log.push(d), onDone: (t) => log.push(`done:${t}`) }, undefined, async () => { waits++; if (waits > 2) h.stop(); await tick(); });
    for (let n = 0; n < 8; n++) await tick();
    expect(log).toEqual(["part", "done:part"]);
  });
});
