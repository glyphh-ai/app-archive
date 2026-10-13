/**
 * usage-meter — the ring at the Code composer's bottom-right (his order,
 * 2026-10-07: "the bottom right is the usage meter for the user.
 * Simplified"). Pure: the ring's fill and the popover's rows come from the
 * member's spend state (main/spend-state.ts: the plan and the budget nearest
 * its line) and, when the desktop can say, the session's context window.
 */

export interface SpendLike {
  hasPlan: boolean;
  plan: string;
  tightest: { label: string; limitUsd: number; spentUsd: number; pct: number } | null;
}
export interface ContextLike { tokens: number; budget: number }

export interface UsageRow { label: string; detail: string; pct: number; hot: boolean }
export interface UsageView {
  /** The ring's fill, 0..100 — the budget nearest its line, else the context window, else 0. */
  pct: number;
  hot: boolean;
  /** The popover's header. */
  plan: string;
  rows: UsageRow[];
}

export const HOT_PCT = 75;

const clamp = (n: number): number => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);

/** The ring's dash offset (pathLength 100): empty at 100, full at 0. */
export function ringOffset(pct: number): number {
  return Math.round((100 - clamp(pct)) * 10) / 10;
}

export function fmtUsd(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`;
}

export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

export function usageView(spend: SpendLike | null, ctx: ContextLike | null): UsageView {
  const rows: UsageRow[] = [];
  const t = spend?.tightest ?? null;
  if (t) {
    const pct = clamp(t.pct);
    rows.push({ label: t.label || "Budget", detail: `${fmtUsd(t.spentUsd)} of ${fmtUsd(t.limitUsd)}`, pct, hot: pct >= HOT_PCT });
  }
  if (ctx && ctx.budget > 0) {
    const pct = clamp((ctx.tokens / ctx.budget) * 100);
    rows.push({ label: "Context", detail: `${fmtTokens(ctx.tokens)} of ${fmtTokens(ctx.budget)} tokens`, pct, hot: pct >= HOT_PCT });
  }
  const lead = rows[0] ?? null;
  const plan = spend ? (spend.hasPlan && spend.plan ? `${spend.plan} plan` : "Free") : "";
  return { pct: lead?.pct ?? 0, hot: !!lead?.hot, plan, rows };
}
