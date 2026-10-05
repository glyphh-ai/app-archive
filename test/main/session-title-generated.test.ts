/**
 * session-title-generated.test.ts — the generated session title (his order,
 * 2026-10-05: do the same as Claude's titles): the placeholder rule, the
 * "may generate?" decision, the request body, the sanitizer and the fetch.
 */
import { describe, expect, it, vi } from "vitest";
import {
  fetchSessionTitle, mayGenerateTitle, placeholderTitle, sanitizeTitle, titleRequestBody,
  GENERATED_TITLE_MAX, NEW_SESSION_TITLE, TITLE_SYSTEM_PROMPT,
} from "../../src/renderer/help/session-title";

const PROMPT = "can you use my research agent to research the market for AI note takers";
const REPLY = "Sure — I'll start with the top ten products and their pricing.";
const user = (text: string) => ({ role: "user" as const, text });
const assistant = (text: string, kind?: string) => ({ role: "assistant" as const, text, ...(kind ? { kind } : {}) });
const thread = (over: Record<string, unknown> = {}) =>
  ({ title: placeholderTitle(PROMPT), messages: [user(PROMPT), assistant(REPLY)], ...over });

describe("placeholderTitle", () => {
  it("is the first 42 characters of the prompt plus an ellipsis", () => {
    expect(placeholderTitle(PROMPT)).toBe(`${PROMPT.slice(0, 42)}…`);
    expect(placeholderTitle(PROMPT).length).toBe(43);
  });
  it("keeps a short prompt whole", () => {
    expect(placeholderTitle("Fix the relay reconnect")).toBe("Fix the relay reconnect");
  });
});

describe("mayGenerateTitle", () => {
  it("says yes on a fresh first exchange, carrying the prompt and the reply", () => {
    expect(mayGenerateTitle(thread())).toEqual({ ok: true, prompt: PROMPT, reply: REPLY });
  });
  it("also while the title is still 'New session'", () => {
    expect(mayGenerateTitle(thread({ title: NEW_SESSION_TITLE })).ok).toBe(true);
  });
  it("never after a hand rename — the lock, or a title that is not the placeholder", () => {
    expect(mayGenerateTitle(thread({ titleLocked: true }))).toEqual({ ok: false, reason: "locked" });
    expect(mayGenerateTitle(thread({ title: "My market study" }))).toEqual({ ok: false, reason: "renamed" });
  });
  it("only once per thread", () => {
    expect(mayGenerateTitle(thread({ titleGenerated: true }))).toEqual({ ok: false, reason: "generated" });
  });
  it("never for a thread past its first exchange (no backfill storm), nor before one", () => {
    expect(mayGenerateTitle(thread({ messages: [user(PROMPT), assistant(REPLY), user("and then?"), assistant("Then this.")] })))
      .toEqual({ ok: false, reason: "not-first-exchange" });
    expect(mayGenerateTitle(thread({ messages: [] }))).toEqual({ ok: false, reason: "not-first-exchange" });
  });
  it("needs a real reply: tool rows, failures and stops are not prose", () => {
    expect(mayGenerateTitle(thread({ messages: [user(PROMPT)] }))).toEqual({ ok: false, reason: "no-reply" });
    expect(mayGenerateTitle(thread({ messages: [user(PROMPT), assistant("⚙ Read file", "tool")] }))).toEqual({ ok: false, reason: "no-reply" });
    expect(mayGenerateTitle(thread({ messages: [user(PROMPT), assistant("⚠ The run failed.")] }))).toEqual({ ok: false, reason: "no-reply" });
    expect(mayGenerateTitle(thread({ messages: [user(PROMPT), assistant("☮ Stopped.")] }))).toEqual({ ok: false, reason: "no-reply" });
  });
  it("joins the reply's text bubbles around tool rows", () => {
    const d = mayGenerateTitle(thread({ messages: [user(PROMPT), assistant("First."), assistant("⚙ Bash", "tool"), assistant("Second.")] }));
    expect(d).toEqual({ ok: true, prompt: PROMPT, reply: "First.\n\nSecond." });
  });
  it("skips a trivial first prompt (under 12 characters)", () => {
    expect(mayGenerateTitle(thread({ title: "hello there", messages: [user("hello there"), assistant(REPLY)] })))
      .toEqual({ ok: false, reason: "short" });
  });
  it("cuts the prompt to 600 and the reply to 400 characters", () => {
    const long = "x".repeat(1000);
    const d = mayGenerateTitle(thread({ title: placeholderTitle(long), messages: [user(long), assistant(long)] }));
    expect(d.ok && d.prompt.length).toBe(600);
    expect(d.ok && d.reply.length).toBe(400);
  });
});

describe("titleRequestBody", () => {
  it("is the OpenAI body: the fixed system line, one user turn, 16 tokens, temperature 0", () => {
    expect(titleRequestBody("claude-haiku-4-5", PROMPT, REPLY)).toEqual({
      model: "claude-haiku-4-5",
      messages: [
        { role: "system", content: TITLE_SYSTEM_PROMPT },
        { role: "user", content: `User:\n${PROMPT}\n\nAssistant:\n${REPLY}` },
      ],
      max_tokens: 16,
      temperature: 0,
    });
    expect(TITLE_SYSTEM_PROMPT).toContain("3 to 6 words");
  });
});

describe("sanitizeTitle", () => {
  it("trims, strips quotes, periods and markdown, collapses whitespace", () => {
    expect(sanitizeTitle('  "Research agent setup."  ')).toBe("Research agent setup");
    expect(sanitizeTitle("**Research   agent** `setup`…")).toBe("Research agent setup");
    expect(sanitizeTitle("Title: Market study for note takers")).toBe("Market study for note takers");
    expect(sanitizeTitle("# Heading style title")).toBe("Heading style title");
    expect(sanitizeTitle("“Curly quoted title”")).toBe("Curly quoted title");
  });
  it("keeps the placeholder on an empty or multi-line answer", () => {
    expect(sanitizeTitle("")).toBeNull();
    expect(sanitizeTitle("   ")).toBeNull();
    expect(sanitizeTitle(null)).toBeNull();
    expect(sanitizeTitle('""')).toBeNull();
    expect(sanitizeTitle("Here is a title:\nResearch agent setup")).toBeNull();
  });
  it("caps at 48 characters", () => {
    const t = sanitizeTitle("a very long generated title that keeps going and going and going");
    expect(t?.length).toBeLessThanOrEqual(GENERATED_TITLE_MAX);
    expect(t).toBe("a very long generated title that keeps going and");
  });
});

describe("fetchSessionTitle", () => {
  const body = titleRequestBody("claude-haiku-4-5", PROMPT, REPLY);
  it("POSTs the Router's chat door with the session bearer and the attribution line, and sanitizes the answer", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '"Research agent setup."' } }] }), { status: 200 }));
    const t = await fetchSessionTitle({ apiUrl: "https://api.glyphh.ai/", token: "tok", body, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(t).toBe("Research agent setup");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.glyphh.ai/api/gateway/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ authorization: "Bearer tok", "content-type": "application/json", "x-glyphh-service": "session-title" });
    expect(JSON.parse(String(init.body))).toEqual(body);
  });
  it("never throws: a refusal, a bad body or a network error all keep the placeholder", async () => {
    const refused = vi.fn(async () => new Response("{\"error\":\"budget\"}", { status: 402 }));
    expect(await fetchSessionTitle({ apiUrl: "x", token: "t", body, fetchImpl: refused as unknown as typeof fetch })).toBeNull();
    const junk = vi.fn(async () => new Response("not json", { status: 200 }));
    expect(await fetchSessionTitle({ apiUrl: "x", token: "t", body, fetchImpl: junk as unknown as typeof fetch })).toBeNull();
    const down = vi.fn(async () => { throw new Error("offline"); });
    expect(await fetchSessionTitle({ apiUrl: "x", token: "t", body, fetchImpl: down as unknown as typeof fetch })).toBeNull();
  });
});
