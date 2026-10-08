/**
 * task-decide.ts — a task's ctx.decide / ctx.route, answered in MAIN.
 *
 * Jev (TypeSafe's System One decision model) through GlyphhRouter's
 * `/v1/systemone`, on the member's own gateway credential: the task's process
 * asks, main holds the token and calls (@glyphh/sdk jevDecide / jevRoute), so
 * the program never sees it. Metered and budget-walled like every model call.
 *
 * ctx.route is DETERMINISTIC: one `choice` question whose options are the
 * branches, then a pure rule over the answer — the highest probability wins, a
 * tie goes to the branch listed first, and below `minConfidence` the
 * `fallback` branch is taken. No text is generated anywhere.
 *
 * What the journal keeps: question keys, the chosen values and confidence —
 * never the state. Electron-free, so it is tested on its own.
 */

import { decisionLine, decisionSummary, jevDecide, jevRoute } from "@glyphh/sdk";
import type { DecideRequest, JevQuestions, JevState, RouteBranches, RouteOptions } from "@glyphh/sdk";

export interface DecideCreds { baseUrl: string; token: string }

/** One decision, as the journal records it. */
export interface DecisionEvent {
  kind: "decide";
  verb: "decide" | "route";
  [k: string]: unknown;
}

export interface DecideDeps {
  /** The member's gateway credential, or null when it is unavailable. */
  creds: () => Promise<DecideCreds | null>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Record one decision (journal + log). */
  push: (ev: DecisionEvent) => void;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function connection(deps: DecideDeps): Promise<{ baseUrl: string; token: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }> {
  const c = await deps.creds();
  if (!c?.baseUrl || !c.token) throw new Error("ctx.decide needs GlyphhRouter: sign in, and make sure the gateway is on for your organization");
  return { baseUrl: c.baseUrl, token: c.token, ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(deps.sleep ? { sleep: deps.sleep } : {}) };
}

/** Answer a `decide` or `route` ctx call; anything else is not ours. */
export async function answerDecision(kind: "decide" | "route", args: unknown[], deps: DecideDeps): Promise<unknown> {
  if (kind === "decide") {
    const [state, questions, opts] = args as [JevState, JevQuestions, { model?: string } | undefined];
    const keys = questions && typeof questions === "object" ? Object.keys(questions) : [];
    try {
      const req: DecideRequest = { state, questions, ...(opts?.model ? { model: String(opts.model) } : {}) };
      const res = await jevDecide(await connection(deps), req);
      deps.push({ kind: "decide", verb: "decide", model: res.model, answers: decisionSummary(res.answers), line: clip(decisionLine(res.answers), 400), usage: res.usage });
      return res;
    } catch (err) {
      deps.push({ kind: "decide", verb: "decide", questions: keys, error: (err as Error).message });
      throw err;
    }
  }
  const [state, branches, opts] = args as [JevState, RouteBranches, RouteOptions<string> | undefined];
  try {
    const res = await jevRoute(await connection(deps), state, branches, opts ?? {});
    deps.push({ kind: "decide", verb: "route", model: res.model, branch: res.branch, confidence: res.confidence, fellBack: res.fellBack, usage: res.usage });
    return res;
  } catch (err) {
    deps.push({ kind: "decide", verb: "route", error: (err as Error).message });
    throw err;
  }
}
