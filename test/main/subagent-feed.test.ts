/**
 * subagent-feed.test.ts — the swarm view built from RELAY FRAMES (his report,
 * 2026-10-05: the web's Agents panel stayed empty). The same rows and rules as
 * main's ledger (subagent-ledger.test.ts), fed by the wire instead of the loop.
 */
import { describe, it, expect } from "vitest";
import { createSubAgentFeed } from "../../src/renderer/help/subagent-feed.js";
import type { SubAgentWireFrame } from "../../src/renderer/help/remote-run.js";

const ref = (n: number, slug = "researcher") => ({ childId: `run#${n}`, slug, name: slug, model: "cheap-model" });
let seq = 0;
const f = (o: Record<string, unknown>): SubAgentWireFrame => ({ seq: seq++, runId: "run-a", at: 0, ...o } as unknown as SubAgentWireFrame);

function feed() {
  let t = 1000;
  const due: Array<() => void> = [];
  const fd = createSubAgentFeed(() => t++, (fn) => { due.push(fn); });
  return { fd, flush: () => { for (const fn of due.splice(0)) fn(); } };
}

describe("subagent feed — the Agents panel's source for a relayed turn", () => {
  it("an agent frame starts a row with who, on what model, asked what; done says how it ended", () => {
    const { fd } = feed();
    fd.apply("chat", f({ type: "agent", phase: "start", agent: ref(1), task: "find pricing" }));
    expect(fd.list()).toEqual([expect.objectContaining({ childId: "run#1", parentChatId: "chat", runId: "run-a", name: "researcher", model: "cheap-model", task: "find pricing", status: "working", endedAt: null, feed: [] })]);
    fd.apply("chat", f({ type: "agent", phase: "done", agent: ref(1), failed: true, summary: "403 Forbidden" }));
    expect(fd.list()[0]).toMatchObject({ status: "failed", summary: "403 Forbidden", endedAt: expect.any(Number) });
  });

  it("streams an agent's words into ONE text entry, and a frame for an unknown child is ignored", () => {
    const { fd } = feed();
    fd.apply("chat", f({ type: "agent", phase: "start", agent: ref(1), task: "t" }));
    for (const d of ["pricing ", "is at ", "/pricing"]) fd.apply("chat", f({ type: "delta", delta: d, agent: ref(1) }));
    fd.apply("chat", f({ type: "delta", delta: "ghost", agent: ref(9) }));
    expect(fd.list()[0]!.feed).toEqual([expect.objectContaining({ kind: "text", text: "pricing is at /pricing" })]);
    expect(fd.list()).toHaveLength(1);
  });

  it("closes the RIGHT step when several tools run at once, keeping the step's record", () => {
    const { fd } = feed();
    fd.apply("chat", f({ type: "agent", phase: "start", agent: ref(2), task: "t" }));
    fd.apply("chat", f({ type: "tool", phase: "start", name: "read_file", title: "read_file a.ts", agent: ref(2) }));
    fd.apply("chat", f({ type: "tool", phase: "start", name: "read_file", title: "read_file b.ts", agent: ref(2) }));
    fd.apply("chat", f({ type: "tool", phase: "done", name: "read_file", title: "read_file a.ts", preview: "40 lines", output: "...", agent: ref(2) }));
    const tools = fd.list()[0]!.feed.filter((e) => e.kind === "tool");
    expect(tools.map((t) => t.kind === "tool" && [t.title, t.state])).toEqual([["read_file a.ts", "done"], ["read_file b.ts", "running"]]);
    expect(tools[0]).toMatchObject({ preview: "40 lines", output: "...", endedAt: expect.any(Number) });
    // A denied step is a failed step; a done with no open start still lands.
    fd.apply("chat", f({ type: "tool", phase: "done", name: "bash", title: "bash rm", denied: true, agent: ref(2) }));
    expect(fd.list()[0]!.feed.at(-1)).toMatchObject({ kind: "tool", title: "bash rm", state: "failed" });
  });

  it("an approval makes the agent WAITING; its next step makes it working; done fails any open step", () => {
    const { fd } = feed();
    fd.apply("chat", f({ type: "agent", phase: "start", agent: ref(3), task: "t" }));
    fd.apply("chat", f({ type: "approval", id: "a1", kind: "command", title: "run npm test", detail: "", agent: ref(3) }));
    expect(fd.list()[0]).toMatchObject({ status: "waiting", feed: [{ at: expect.any(Number), kind: "approval", title: "run npm test" }] });
    fd.apply("chat", f({ type: "tool", phase: "start", name: "bash", title: "bash npm test", agent: ref(3) }));
    expect(fd.list()[0]!.status).toBe("working");
    fd.apply("chat", f({ type: "agent", phase: "done", agent: ref(3), summary: "ok" }));
    expect(fd.list()[0]!.feed.at(-1)).toMatchObject({ kind: "tool", state: "failed" });
    expect(fd.list()[0]!.status).toBe("done");
  });

  it("a swarm lives while its PARENT works, finished children included, and leaves with it", () => {
    const { fd } = feed();
    fd.apply("chat-a", f({ type: "agent", phase: "start", agent: ref(5), task: "still going" }));
    fd.apply("chat-a", f({ type: "agent", phase: "start", agent: ref(6), task: "done already" }));
    fd.apply("chat-a", f({ type: "agent", phase: "done", agent: ref(6), summary: "ok" }));
    fd.apply("chat-b", f({ type: "agent", phase: "start", agent: { childId: "run-b#1", slug: "x", name: "x", model: "m" }, task: "other" }));
    expect(fd.list().map((r) => r.childId)).toEqual(["run#5", "run#6", "run-b#1"]);
    fd.endParent("chat-a");
    expect(fd.list().map((r) => [r.childId, r.parentChatId])).toEqual([["run-b#1", "chat-b"]]);
    fd.endParent("chat-a"); // nothing left: no announce, no throw
  });

  it("announces to its subscribers once per frame, not once per token, and thinking draws nothing", () => {
    const { fd, flush } = feed();
    const seen: number[] = [];
    const off = fd.subscribe((rows) => { seen.push(rows[0]?.feed.length ?? -1); });
    fd.apply("chat", f({ type: "agent", phase: "start", agent: ref(7), task: "t" }));
    for (let i = 0; i < 50; i++) fd.apply("chat", f({ type: "delta", delta: "x", agent: ref(7) }));
    fd.apply("chat", f({ type: "thinking", text: "hmm", agent: ref(7) }));
    flush();
    expect(seen).toEqual([1]);
    expect(fd.list()[0]!.feed).toEqual([expect.objectContaining({ kind: "text", text: "x".repeat(50) })]);
    off();
    fd.apply("chat", f({ type: "delta", delta: "y", agent: ref(7) }));
    flush();
    expect(seen).toEqual([1]);
  });
});
