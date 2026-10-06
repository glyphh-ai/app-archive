/**
 * thread-body.test.ts — a thread's push never carries a body this surface
 * has not loaded, and a transcript on R2 is read whole (his report,
 * 2026-10-06: a rail click zeroed the thread on the server).
 */
import { describe, expect, it } from "vitest";
import { bodyLoaded, countAfterLoad, needsTranscript, parseTranscript, pushMessages } from "../../src/renderer/help/thread-body.js";

describe("pushMessages — the body rides only once it is loaded", () => {
  it("an adopted thread (no messages, a count) sends no messages at all", () => {
    expect(bodyLoaded({ messages: [], messageCount: 7 })).toBe(false);
    expect(pushMessages({ messages: [], messageCount: 7 })).toEqual({});
    expect("messages" in pushMessages({ messages: [], messageCount: 7 })).toBe(false);
  });
  it("a loaded thread sends its messages", () => {
    const m = [{ role: "user", text: "hi" }];
    expect(pushMessages({ messages: m, messageCount: 1 })).toEqual({ messages: m });
  });
  it("a thread that never had turns is loaded and sends its empty list", () => {
    expect(bodyLoaded({ messages: [] })).toBe(true);
    expect(bodyLoaded({ messages: [], messageCount: 0 })).toBe(true);
    expect(pushMessages({ messages: [] })).toEqual({ messages: [] });
  });
});

describe("countAfterLoad", () => {
  it("never shrinks to the server's preview, never sits below what is held", () => {
    expect(countAfterLoad(20, 340)).toBe(340);
    expect(countAfterLoad(340, 340)).toBe(340);
    expect(countAfterLoad(3, undefined)).toBe(3);
    expect(countAfterLoad(5, 2)).toBe(5);
  });
});

describe("the transcript on R2", () => {
  it("is needed when the preview is shorter than the count", () => {
    expect(needsTranscript({ messages: [1, 2], messageCount: 50, transcriptUrl: "https://r2/t" })).toBe("https://r2/t");
    expect(needsTranscript({ messages: [1, 2], messageCount: 2, transcriptUrl: "https://r2/t" })).toBeNull();
    expect(needsTranscript({ messages: [], messageCount: 9, transcriptUrl: null })).toBeNull();
  });
  it("parses one message per line and skips torn or foreign lines", () => {
    const text = '{"role":"user","text":"a"}\n\n{"role":"assistant","text":"b"}\n{"nope":1}\n{"role":"user","te';
    expect(parseTranscript(text).map((m) => (m as { text: string }).text)).toEqual(["a", "b"]);
    expect(parseTranscript("")).toEqual([]);
  });
});
