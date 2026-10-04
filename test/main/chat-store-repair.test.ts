import { describe, it, expect } from "vitest";
import { repairChatStore } from "../../src/main/chat-store-repair.js";

const m = (role: string, text: string, at?: number) => (at === undefined ? { role, text } : { role, text, at });

describe("repairChatStore — a transcript appended to itself collapses to its real messages", () => {
  it("drops copies of a message (same role, text, timestamp) and reports the old length per thread", () => {
    const turn = [m("user", "this is a test", 1), m("assistant", "Hello!", 2)];
    const looped = { id: "a", messages: [...turn, ...turn, ...turn, ...turn] };
    const fine = { id: "b", messages: [m("user", "hi", 5), m("assistant", "hey", 6)] };
    const r = repairChatStore([looped, fine]);
    expect(r.chats[0].messages).toEqual(turn);
    expect(r.chats[1]).toBe(fine);
    expect(r.repaired).toEqual({ a: 8 });
  });
  it("two real messages with the same words but different timestamps both stay", () => {
    const r = repairChatStore([{ id: "a", messages: [m("user", "again", 1), m("assistant", "ok", 2), m("user", "again", 3), m("assistant", "ok", 4)] }]);
    expect(r.chats[0].messages).toHaveLength(4);
    expect(r.repaired).toEqual({});
  });
  it("tool rows with the same text but different tool payloads are distinct; empty and one-message threads are untouched", () => {
    const r = repairChatStore([
      { id: "t", messages: [{ role: "assistant", text: "✓ grep", at: 1, tool: { n: 1 } }, { role: "assistant", text: "✓ grep", at: 1, tool: { n: 2 } }] },
      { id: "e", messages: [] }, { id: "o", messages: [m("user", "x", 1)] }, { id: "n" },
    ]);
    expect(r.chats[0].messages).toHaveLength(2);
    expect(r.repaired).toEqual({});
  });
});
