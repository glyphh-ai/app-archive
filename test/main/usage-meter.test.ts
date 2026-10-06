/**
 * usage-meter.test.ts — the Code composer's usage ring and its popover rows
 * (his order, 2026-10-07): the budget nearest its line fills the ring, the
 * context window rides beside it when the desktop can say, nothing invented.
 */
import { describe, expect, it } from "vitest";
import { HOT_PCT, fmtTokens, fmtUsd, ringOffset, usageView } from "../../src/renderer/help/usage-meter.js";

const spend = (pct: number, extra = {}) => ({ hasPlan: true, plan: "Solo", tightest: { label: "Your budget", limitUsd: 20, spentUsd: (20 * pct) / 100, pct }, ...extra });

describe("the ring", () => {
  it("fills with the tightest budget's share; empty at 100 offset, full at 0", () => {
    expect(ringOffset(0)).toBe(100);
    expect(ringOffset(40)).toBe(60);
    expect(ringOffset(100)).toBe(0);
    expect(ringOffset(140)).toBe(0);
    expect(ringOffset(NaN)).toBe(100);
  });
  it("goes hot at 75% — the banner's own line", () => {
    expect(HOT_PCT).toBe(75);
    expect(usageView(spend(74), null).hot).toBe(false);
    expect(usageView(spend(75), null).hot).toBe(true);
  });
  it("with no budget it shows the context window; with neither it sits empty", () => {
    const v = usageView({ hasPlan: true, plan: "Pro", tightest: null }, { tokens: 50_000, budget: 200_000 });
    expect(v.pct).toBe(25);
    expect(v.rows.map((r) => r.label)).toEqual(["Context"]);
    expect(v.rows[0]!.detail).toBe("50k of 200k tokens");
    const none = usageView({ hasPlan: true, plan: "Pro", tightest: null }, null);
    expect(none.pct).toBe(0);
    expect(none.rows).toEqual([]);
    expect(usageView(null, null)).toEqual({ pct: 0, hot: false, plan: "", rows: [] });
  });
});

describe("the popover", () => {
  it("heads with the plan — Free when there is none — and lists budget then context", () => {
    const v = usageView(spend(50), { tokens: 1_200, budget: 8_000 });
    expect(v.plan).toBe("Solo plan");
    expect(v.rows.map((r) => r.label)).toEqual(["Your budget", "Context"]);
    expect(v.rows[0]!.detail).toBe("$10.00 of $20.00");
    expect(v.rows[1]!.pct).toBe(15);
    expect(usageView({ hasPlan: false, plan: "", tightest: null }, null).plan).toBe("Free");
  });
  it("a context window with no budget is not a row (nothing invented)", () => {
    expect(usageView(spend(10), { tokens: 10, budget: 0 }).rows.map((r) => r.label)).toEqual(["Your budget"]);
  });
  it("formats money and tokens the short way", () => {
    expect(fmtUsd(0)).toBe("$0.00");
    expect(fmtUsd(12.345)).toBe("$12.35");
    expect(fmtUsd(250)).toBe("$250");
    expect(fmtTokens(999)).toBe("999");
    expect(fmtTokens(1_500)).toBe("1.5k");
    expect(fmtTokens(200_000)).toBe("200k");
    expect(fmtTokens(2_000_000)).toBe("2M");
    expect(fmtTokens(-3)).toBe("0");
  });
});
