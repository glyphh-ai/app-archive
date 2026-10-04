import { describe, it, expect } from "vitest";
import { adoptServerMessages } from "../../src/renderer/help/bound-messages.js";

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
