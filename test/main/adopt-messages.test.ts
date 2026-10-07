import { describe, it, expect } from "vitest";
import { adoptServerMessages, dropFlattenedTail } from "../../src/renderer/help/bound-messages.js";

describe("the flattened duplicate of a turn goes (his report, 2026-10-07)", () => {
  const u = { role: "user", text: "build it", at: 1 };
  const a1 = { role: "assistant", text: "I'll start by looking at the repo.", at: 2 };
  const t1 = { role: "assistant", kind: "tool", text: "Ran 2 tool calls", at: 3 };
  const a2 = { role: "assistant", text: "No template in the repo. Let me check the harness.", at: 4 };
  it("drops a trailing assistant message that is the turn's parts joined with nothing between", () => {
    const flat = { role: "assistant", text: a1.text + a2.text, at: 5 };
    expect(dropFlattenedTail([u, a1, t1, a2, flat])).toEqual([u, a1, t1, a2]);
    expect(adoptServerMessages([u], [u, a1, t1, a2, flat])).toEqual([u, a1, t1, a2]);
  });
  it("keeps a real closing message, a tool row, and a thread with no parts before the tail", () => {
    const real = { role: "assistant", text: "Done — the app is in glyphh-apps/inbox-pulse.", at: 5 };
    expect(dropFlattenedTail([u, a1, t1, a2, real])).toEqual([u, a1, t1, a2, real]);
    expect(dropFlattenedTail([u, a1, t1])).toEqual([u, a1, t1]);
    expect(dropFlattenedTail([u, a1])).toEqual([u, a1]);
    expect(dropFlattenedTail([])).toEqual([]);
  });
});

const m = (role: string, text: string, at: number) => ({ role, text, at });

describe("adoptServerMessages — a newer server clock never empties a thread", () => {
  it("keeps the window's messages when the server's copy has fewer (a run that bumped the clock but never wrote)", () => {
    const local = [m("user", "build me a site", 1), m("assistant", "on it", 2)];
    expect(adoptServerMessages(local, [])).toBe(local);
    expect(adoptServerMessages(local, [m("user", "build me a site", 1)])).toBe(local);
  });
  it("takes the server's copy when it has at least as many, bounded", () => {
    const local = [m("user", "hi", 1)];
    const server = [m("user", "hi", 1), m("assistant", "hello", 2), m("assistant", "hello", 2)];
    expect(adoptServerMessages(local, server)).toEqual([m("user", "hi", 1), m("assistant", "hello", 2)]);
  });
});
