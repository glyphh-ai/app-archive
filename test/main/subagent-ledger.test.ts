import { describe, it, expect, vi, beforeEach } from "vitest";

// The ledger announces through broadcast(); what it announces is the thing
// under test, so the seam records every send instead of reaching Electron.
const sent: Array<{ channel: string; payload: unknown }> = [];
vi.mock("electron", () => ({
  ipcMain: { handle: () => {} },
  webContents: { getAllWebContents: () => [] },
}));
vi.mock("../../src/main/broadcast", () => ({
  broadcast: (channel: string, payload: unknown) => { sent.push({ channel, payload }); },
}));

const ledger = await import("../../src/main/subagent-ledger");

const ref = (n: number, slug = "researcher") => ({ childId: `run#${n}`, slug, name: slug, model: "cheap-model" });

describe("subagent ledger — the Agents panel's source (his order, 2026-09-29)", () => {
  beforeEach(() => {
    for (const r of ledger.list()) ledger.endRun(r.runId);
    sent.length = 0;
  });

  it("streams an agent's words into ONE text entry, not one per token", () => {
    ledger.start(ref(1), "chat", "run", "find pricing");
    ledger.text(ref(1), "pricing ");
    ledger.text(ref(1), "is at ");
    ledger.text(ref(1), "/pricing");
    const [r] = ledger.list();
    expect(r!.feed).toEqual([expect.objectContaining({ kind: "text", text: "pricing is at /pricing" })]);
  });

  it("closes the RIGHT step when several of its tools run at once", () => {
    // The engine runs tool calls in parallel now: two steps can be open and
    // they finish in any order.
    ledger.start(ref(2), "chat", "run", "t");
    // The FIRST one started finishes first: closing "the newest open step"
    // would close b.ts and leave a.ts spinning forever.
    ledger.tool(ref(2), "start", "read_file", "read_file a.ts");
    ledger.tool(ref(2), "start", "read_file", "read_file b.ts");
    ledger.tool(ref(2), "done", "read_file", "read_file a.ts", false, "40 lines");
    const tools = ledger.list()[0]!.feed.filter((e) => e.kind === "tool");
    expect(tools.map((t) => t.kind === "tool" && [t.title, t.state])).toEqual([
      ["read_file a.ts", "done"],
      ["read_file b.ts", "running"],
    ]);
  });

  it("an approval makes the agent WAITING, and its next step makes it working again", () => {
    ledger.start(ref(3), "chat", "run", "t");
    ledger.approval(ref(3), "run npm test");
    expect(ledger.list()[0]!.status).toBe("waiting");
    ledger.tool(ref(3), "start", "bash", "bash npm test");
    expect(ledger.list()[0]!.status).toBe("working");
  });

  it("a finished agent keeps no step marked running, and says how it ended", () => {
    ledger.start(ref(4), "chat", "run", "t");
    ledger.tool(ref(4), "start", "scrape_page", "scrape_page x");
    ledger.finish(ref(4), true, "403 Forbidden");
    const r = ledger.list()[0]!;
    expect(r.status).toBe("failed");
    expect(r.summary).toBe("403 Forbidden");
    expect(r.endedAt).not.toBeNull();
    expect(r.feed[0]).toMatchObject({ kind: "tool", state: "failed" });
  });

  it("a swarm lives while its PARENT works, finished children included, and leaves with it", () => {
    // His correction, 2026-09-29: "just the list of agents running at any
    // given time tied to an active glyphh agent panel as the parent id".
    ledger.start(ref(5), "chat-a", "run-a", "still going");
    ledger.start(ref(6), "chat-a", "run-a", "done already");
    ledger.finish(ref(6), false, "ok");
    ledger.start({ childId: "run-b#1", slug: "x", name: "x", model: "m" }, "chat-b", "run-b", "other session");
    // A child that finished while its siblings work is still there to read.
    expect(ledger.list().map((r) => r.childId)).toEqual(["run#5", "run#6", "run-b#1"]);
    // The parent's turn ends: its swarm goes, the other session's stays.
    ledger.endRun("run-a");
    expect(ledger.list().map((r) => [r.childId, r.parentChatId])).toEqual([["run-b#1", "chat-b"]]);
  });

  it("announces to every surface, throttled to a frame rather than a token", async () => {
    ledger.start(ref(7), "chat", "run", "t");
    for (let i = 0; i < 50; i++) ledger.text(ref(7), "x");
    await new Promise((res) => setTimeout(res, 200));
    const updates = sent.filter((s) => s.channel === "subagents:update");
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates.length).toBeLessThan(5);
    const last = updates[updates.length - 1]!.payload as Array<{ childId: string; feed: Array<{ text?: string }> }>;
    expect(last.find((r) => r.childId === "run#7")!.feed[0]!.text).toBe("x".repeat(50));
  });
});
