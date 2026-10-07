/**
 * A task's ctx.decide / ctx.route, answered in main: Jev through GlyphhRouter's
 * /v1/systemone on the member's credential, journaled as keys + chosen values +
 * confidence, never the state.
 */

import { describe, it, expect } from "vitest";
import { answerDecision, type DecisionEvent } from "../../src/main/task-decide";

const creds = async () => ({ baseUrl: "https://router.example", token: "sk-member" });

function fetcher(answers: (questions: Record<string, { type: string }>) => Record<string, unknown>) {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { questions: Record<string, { type: string }> };
    calls.push({ url, body, auth: String((init.headers as Record<string, string>).authorization) });
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers: answers(body.questions), usage: { input_tokens: 10, output_tokens: 2 } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("task ctx.decide / ctx.route on the desktop", () => {
  it("routes deterministically through GlyphhRouter and journals the branch, not the state", async () => {
    const events: DecisionEvent[] = [];
    const { impl, calls } = fetcher(() => ({ route: { type: "choice", choice: "b", probabilities: { a: 0.5, b: 0.5 }, confidence: 0.7 } }));
    const r = await answerDecision("route", ["PRIVATE STATE", ["a", "b"], {}], { creds, fetch: impl, push: (e) => events.push(e) }) as { branch: string };
    expect(r.branch).toBe("a"); // a tie goes to the branch listed first
    expect(calls[0]!.url).toBe("https://router.example/v1/systemone");
    expect(calls[0]!.auth).toBe("Bearer sk-member");
    expect(events).toEqual([{ kind: "decide", verb: "route", model: "jev-1.13.0", branch: "a", confidence: 0.7, fellBack: false, usage: { input_tokens: 10, output_tokens: 2 } }]);
    expect(JSON.stringify(events)).not.toContain("PRIVATE STATE");
  });

  it("decides, logging each question's chosen value and confidence", async () => {
    const events: DecisionEvent[] = [];
    const { impl } = fetcher(() => ({ urgent: { type: "noul", noul: 0.9 }, team: { type: "choice", choice: "tech", probabilities: { tech: 0.8, billing: 0.2 }, confidence: 0.8 } }));
    await answerDecision("decide", ["s", { urgent: { type: "noul", instructions: "urgent?" }, team: { type: "choice", instructions: "team?", criteria: { tech: null, billing: null } } }], { creds, fetch: impl, push: (e) => events.push(e) });
    expect(events[0]).toMatchObject({ verb: "decide", answers: { urgent: { noul: 0.9 }, team: { choice: "tech", confidence: 0.8 } }, line: "urgent=0.90, team=tech (0.80)" });
  });

  it("refuses without a gateway credential, and a malformed question before sending; both are journaled", async () => {
    const events: DecisionEvent[] = [];
    const { impl, calls } = fetcher(() => ({}));
    await expect(answerDecision("route", ["s", ["a", "b"]], { creds: async () => null, fetch: impl, push: (e) => events.push(e) })).rejects.toThrow(/GlyphhRouter/);
    await expect(answerDecision("decide", ["s", { q: { type: "yesno", instructions: "x" } }], { creds, fetch: impl, push: (e) => events.push(e) })).rejects.toThrow(/lowercase/);
    expect(calls).toHaveLength(0);
    expect(events.map((e) => [e.verb, typeof e.error])).toEqual([["route", "string"], ["decide", "string"]]);
    expect(events[1]).toMatchObject({ questions: ["q"] });
  });
});
