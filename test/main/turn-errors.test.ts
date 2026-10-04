import { describe, it, expect } from "vitest";
import { memberLine, turnError } from "../../src/renderer/help/turn-errors";

describe("a failed turn is a card (his reports, 2026-09-29)", () => {
  it("a model off the Free plan (the gateway's 402, his order 2026-10-04) is the plan card", () => {
    expect(turnError("⚠ gateway 402: Your organization needs a plan to use models. An org admin chooses one on Billing."))
      .toMatchObject({ kind: "plan", title: "That model isn't on the Free plan", action: "billing" });
    expect(turnError("⚠ Your organization needs a plan to use models. An org admin chooses one on Billing.")?.kind).toBe("plan");
  });

  it("no model is a door to the picker, not a riddle", () => {
    expect(turnError("⚠ Choose a model in the model picker below.")).toMatchObject({ kind: "no-model", title: "Choose a model", body: "Choose a model in the model picker below.", action: "models" });
    expect(turnError("⚠ Pick a model for the Glyphh loop: any model your organization runs on the gateway.")?.kind).toBe("no-model");
  });

  it("the provider refusing Glyphh's own key reads as the model being unreachable, naming it", () => {
    const e = turnError('⚠ gateway 401: litellm.AuthenticationError: AnthropicException - {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."},"request_id":null}. Received Model Group=claude-opus-4-8 Available Model Group Fallbacks=None');
    expect(e).toMatchObject({ kind: "model-down", title: "claude-opus-4-8 isn't reachable right now", action: "models" });
    expect(e?.body).not.toContain("AuthenticationError");
    expect(e?.raw).toContain("authentication_error");
  });

  it("out of budget, in the server's own words", () => {
    const e = turnError("⚠ gateway 402: Your organization has used this month's $20.00. An org admin can add funds on Billing or raise the spend limit.");
    expect(e).toMatchObject({ kind: "budget", action: "billing" });
    expect(e?.body).toBe("Your organization has used this month's $20.00. An org admin can add funds on Billing or raise the spend limit.");
  });

  it("an ordinary reply is not an error, and an unknown failure still gets a card", () => {
    expect(turnError("Here is the refactor you asked for.")).toBeNull();
    expect(turnError("⚠ gateway 400: something odd")).toMatchObject({ kind: "failed", body: "something odd" });
  });
});

describe("a refusal short of the line (his screenshot, 2026-09-29)", () => {
  it("is out of budget, not a turn that failed", () => {
    const e = turnError("⚠ gateway 402: Your team has $0.03 left of its $0.50 budget, not enough for this request. A team admin can raise it on Teams.");
    expect(e).toMatchObject({ kind: "budget", title: "Out of budget", action: "billing" });
  });
});

describe("a member's card (his order, 2026-09-29: \"contact your organizational admin\")", () => {
  it("drops the admin's fix and asks them to contact their org admin", () => {
    expect(memberLine("Your team has used its $0.50 budget. A team admin can raise it on Teams."))
      .toBe("Your team has used its $0.50 budget. Contact your organization admin.");
    expect(memberLine("Your organization has used this month's $80.00. An org admin can add funds on Billing or raise the spend limit."))
      .toBe("Your organization has used this month's $80.00. Contact your organization admin.");
  });

  it("never tells a member to add funds they cannot add", () => {
    expect(memberLine("$0.47 of $0.50 this month. Add funds or raise the limit before it runs out."))
      .toBe("$0.47 of $0.50 this month. Contact your organization admin.");
  });

  it("keeps a message that names no admin, and adds the ask", () => {
    expect(memberLine("A budget your calls draw on is used up for this month."))
      .toBe("A budget your calls draw on is used up for this month. Contact your organization admin.");
  });
});
