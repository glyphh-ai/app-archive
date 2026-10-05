/**
 * remote-run-dispatch.test.ts — the relay frame → callback routing for the
 * SWARM (his report, 2026-10-05): a sub-agent's frames reach onAgentFrame and
 * never the thread's onToken/onTool; its approval reaches the dock, named;
 * the parent's thinking reaches the fold.
 */
import { describe, it, expect } from "vitest";
import { dispatchFrame, type HarnessWireFrame, type RemoteRunCallbacks } from "../../src/renderer/help/remote-run.js";

const child = { childId: "r#1", slug: "researcher", name: "Researcher", model: "cheap" };
const fr = (o: Record<string, unknown>): HarnessWireFrame => ({ seq: 1, runId: "r", at: 0, ...o } as unknown as HarnessWireFrame);

function harness() {
  const log: Array<[string, unknown]> = [];
  const cb: RemoteRunCallbacks = {
    onToken: (d) => log.push(["token", d]),
    onThinking: (t) => log.push(["thinking", t]),
    onTool: (t) => log.push(["tool", t.name]),
    onAgentFrame: (f) => log.push(["agent", `${f.type}:${f.agent?.childId ?? "-"}`]),
    onApproval: (a) => log.push(["approval", a.title]),
  };
  const state = { text: "", error: null as string | null };
  return { log, state, run: (f: HarnessWireFrame) => dispatchFrame(f, cb, state, {} as never) };
}

describe("dispatchFrame — the swarm's frames leave the thread", () => {
  it("a child's delta, thinking and tool go to the feed only; the parent's text and thinking to the thread", () => {
    const h = harness();
    h.run(fr({ type: "delta", delta: "swarm", agent: child }));
    h.run(fr({ type: "thinking", text: "child thinks", agent: child }));
    h.run(fr({ type: "tool", phase: "start", name: "read", agent: child }));
    h.run(fr({ type: "agent", phase: "start", agent: child, task: "t" }));
    h.run(fr({ type: "delta", delta: "parent" }));
    h.run(fr({ type: "thinking", text: "parent thinks" }));
    h.run(fr({ type: "tool", phase: "start", name: "bash" }));
    expect(h.log).toEqual([
      ["agent", "delta:r#1"], ["agent", "thinking:r#1"], ["agent", "tool:r#1"], ["agent", "agent:r#1"],
      ["token", "parent"], ["thinking", "parent thinks"], ["tool", "bash"],
    ]);
    expect(h.state.text).toBe("parent");
  });

  it("a child's approval reaches the feed AND the dock, titled with the child's name", () => {
    const h = harness();
    h.run(fr({ type: "approval", id: "a1", kind: "command", title: "rm -rf build", detail: "", agent: child }));
    h.run(fr({ type: "approval", id: "a2", kind: "command", title: "npm test", detail: "" }));
    expect(h.log).toEqual([["agent", "approval:r#1"], ["approval", "Researcher: rm -rf build"], ["approval", "npm test"]]);
  });
});
