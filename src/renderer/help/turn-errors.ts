/**
 * turn-errors — a failed turn is a CARD with a way forward, never a raw
 * sentence (his report, 2026-09-29: a brand-new user got "Pick a model…", a
 * Solo member got LiteLLM's raw `AuthenticationError … API key is invalid`,
 * and "still no card i asked for"). This reads the refusal's words and says
 * what kind it is; help/code.ts draws the card. Pure, so the reading is tested.
 */

export type TurnErrorKind = "plan" | "budget" | "no-model" | "model-down" | "model-denied" | "failed";

export interface TurnError {
  kind: TurnErrorKind;
  title: string;
  body: string;
  /** Opens Billing (plan, budget) or the model picker (no-model, model-down, model-denied). */
  action: "billing" | "models" | null;
  /** The raw words, kept for a details fold. */
  raw: string;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The model a LiteLLM error names ("Received Model Group=claude-opus-4-8"). */
function modelNamed(raw: string): string {
  return /Received Model Group=([^\s,]+)/.exec(raw)?.[1] ?? /model[=: ]+["']?([\w.:/-]+)["']?/i.exec(raw)?.[1] ?? "";
}

/** Null when the message is not a refusal (an ordinary reply). */
export function turnError(text: string): TurnError | null {
  const raw = String(text ?? "").replace(/^⚠\s*/, "").trim();
  if (!/^⚠/.test(String(text ?? "").trim())) return null;
  if (/needs a plan to use models/i.test(raw)) {
    return { kind: "plan", title: "Choose a plan to start using models", body: "Everything else works without one. Every plan runs every model; Solo is $20 a month.", action: "billing", raw };
  }
  // The engine's NO_MODEL_MESSAGE, and the words it used before (old transcripts).
  if (/Choose a model in the model picker below|Pick a model for the Glyphh loop/i.test(raw)) {
    return { kind: "no-model", title: "Choose a model", body: "Choose a model in the model picker below.", action: "models", raw };
  }
  const said = raw.replace(/^gateway \d{3}:\s*/, "");
  // "has $0.03 left of its $0.50 budget, not enough for this request" is out of
  // budget too: what is left cannot pay for a request (his screenshot, 2026-09-29).
  if (/has used (this month's|its|all)|left of its .*budget|not enough for this request|Budget has been exceeded|monthly budget|budget_exceeded/i.test(raw)) {
    return { kind: "budget", title: "Out of budget", body: clip(said.startsWith("Budget has been exceeded") ? "A budget your calls draw on is used up for this month." : said, 220), action: "billing", raw };
  }
  const model = modelNamed(raw);
  if (/not allowed to access model|team not allowed|key not allowed|not in (the )?allowed/i.test(raw)) {
    return { kind: "model-denied", title: model ? `Your team can't use ${model}` : "Your team can't use that model", body: "Pick one of your team's models, or ask an org admin to turn it on.", action: "models", raw };
  }
  if (/AuthenticationError|authentication_error|API key is invalid|ServiceUnavailable|APIConnectionError|model_not_found|NotFoundError|InternalServerError|overloaded|gateway 50[0-9]/i.test(raw)) {
    return {
      kind: "model-down",
      title: model ? `${model} isn't reachable right now` : "That model isn't reachable right now",
      body: "Glyphh couldn't reach the model's provider. Pick another model, or try again in a minute. Nothing was charged for it.",
      action: "models", raw,
    };
  }
  return { kind: "failed", title: "The turn didn't go through", body: clip(said.replace(/\{.*\}/s, "").trim() || said, 220), action: null, raw };
}

/** A refusal as a MEMBER reads it (his order, 2026-09-29: a member who runs out
 *  gets the same card, with no funding door, and is told to "contact your
 *  organizational admin"). The server's admin-facing fix ("An org admin can…",
 *  "A team admin can…") is dropped; the ask takes its place. */
export function memberLine(body: string, ask = "Contact your organization admin."): string {
  const kept = body.replace(/\s*(An org admin|A team admin|Ask an org admin|Ask a team admin|Add funds)\b[^.]*\.?/g, "").trim();
  return kept ? `${kept} ${ask}` : ask;
}
