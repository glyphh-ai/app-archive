/**
 * thread-publish-cloud.test.ts — a CLOUD thread's transcript is the pod's
 * (main/thread-publish.ts): the renderer's push of a cloud thread sends its
 * INDEX only, never its messages, even when the local store holds a cached
 * copy with messages; a local thread goes through the publisher as before.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: () => undefined } }));
vi.mock("../../src/main/auth.js", () => ({ isAuthenticated: () => true }));
const pushed: Array<{ id: string; body: Record<string, unknown> }> = [];
vi.mock("../../src/main/glyphh-client.js", () => ({
  getClient: () => ({ sessions: {
    pushThread: async (id: string, body: Record<string, unknown>) => { pushed.push({ id, body }); return { applied: true, thread: { id, updatedAt: body.updatedAt, messageCount: 0 } }; },
    appendMessages: async () => { throw new Error("a cloud thread must never append here"); },
  } }),
}));
vi.mock("../../src/main/agent-ipc.js", () => ({
  listStoredChats: () => [
    { id: "cloud-1", title: "In the cloud", mode: "code", source: { kind: "cloud-new" }, createdAt: 1, updatedAt: 2, messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }] },
  ],
}));
vi.mock("../../src/main/app-paths.js", () => ({ userScopedPath: (s: string) => `/tmp/cloud-lane-test-${process.pid}-${s}` }));

import { threadsPush } from "../../src/main/thread-publish.js";

describe("a cloud thread on the desktop", () => {
  it("pushes its index only — the messages the renderer sent are dropped, the pod owns the transcript", async () => {
    const r = await threadsPush("cloud-1", { title: "In the cloud", mode: "code", source: { kind: "cloud-new", locus: "cloud" }, messages: [{ role: "user", text: "hi" }], updatedAt: 5 });
    expect(r.applied).toBe(true);
    expect(pushed).toEqual([{ id: "cloud-1", body: { title: "In the cloud", mode: "code", source: { kind: "cloud-new", locus: "cloud" }, updatedAt: 5 } }]);
    expect("messages" in pushed[0]!.body).toBe(false);
  });
});
