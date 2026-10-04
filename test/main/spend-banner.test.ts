import { describe, it, expect } from "vitest";
import { bannerKey, spendBanner, type SpendState } from "../../src/renderer/help/spend-banner";

const state = (over: Partial<SpendState>): SpendState => ({ ok: true, hasPlan: true, plan: "basic", canManage: true, tightest: null, ...over });
const org = (spent: number, limit: number) => ({ scope: "org" as const, label: "your organization's balance", limitUsd: limit, spentUsd: spent, pct: Math.round((1000 * spent) / limit) / 10 });

describe("the money banner above the composer (his order, 2026-09-29)", () => {
  it("a Free org sees no banner for being Free (his order, 2026-10-04: Free runs the free-plan models)", () => {
    expect(spendBanner(state({ hasPlan: false, plan: "none" }))).toBeNull();
  });

  it("a Free org's budget still speaks", () => {
    expect(spendBanner(state({ hasPlan: false, plan: "none", tightest: org(45, 60) }))?.kind).toBe("warn");
    expect(spendBanner(state({ hasPlan: false, plan: "none", tightest: org(60, 60) }))?.kind).toBe("out");
  });

  it("says nothing under 75% of the nearest budget", () => {
    expect(spendBanner(state({ tightest: org(44, 60) }))).toBeNull();
    expect(spendBanner(state({}))).toBeNull();
  });

  it("warns from 75%, naming the budget and the figures", () => {
    const b = spendBanner(state({ tightest: org(45, 60) }));
    expect(b?.kind).toBe("warn");
    expect(b?.title).toBe("You've used 75% of your organization's balance");
    expect(b?.body).toContain("$45.00 of $60.00 this month");
  });

  it("says when it is all gone", () => {
    const b = spendBanner(state({ tightest: org(61.2, 60) }));
    expect(b?.kind).toBe("out");
    expect(b?.title).toBe("You've used all of your organization's balance");
  });

  it("offline or an older server shows nothing rather than a wrong number", () => {
    expect(spendBanner(state({ ok: false, hasPlan: false }))).toBeNull();
    expect(spendBanner(null)).toBeNull();
  });
});

describe("a dismissed banner (his order, 2026-09-29: \"the warning above should be dismissable\")", () => {
  const at = (pct: number, scope: "org" | "team" | "key" = "team") => ({ ok: true, hasPlan: true, plan: "solo", canManage: false, tightest: { scope, label: "your team Eng's budget", limitUsd: 0.5, spentUsd: 0.5 * pct / 100, pct } });
  it("stays down while it says the same thing, and comes back when it says something new", () => {
    expect(bannerKey("warn", at(93))).toBe(bannerKey("warn", at(96)));
    expect(bannerKey("out", at(100))).not.toBe(bannerKey("warn", at(93)));
    expect(bannerKey("warn", at(93, "org"))).not.toBe(bannerKey("warn", at(93)));
  });
});

describe("a refused request (his report, 2026-09-29: \"that request says it is out of funds but the screen still says the user has funds\")", () => {
  it("reads as out, with what is left, even short of 100%", () => {
    const s = state({ canManage: false, tightest: { scope: "team", label: "your team Eng's budget", limitUsd: 0.5, spentUsd: 0.47, pct: 94 } });
    expect(spendBanner(s)?.kind).toBe("warn");
    expect(spendBanner(s, true)).toEqual({
      kind: "out", title: "Not enough left in your team Eng's budget",
      body: "$0.03 left, less than a request needs. Model calls stop until it is raised or the month turns.",
    });
  });
});
