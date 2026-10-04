/**
 * spend-banner — what the money banner above the composer says (his order,
 * 2026-09-29: "anytime the user is out of money or as they approach their team
 * or org limit there should be a message that shows above the input… within
 * 75% of their limit"). A Free org sees no banner for being Free (his order,
 * 2026-10-04: Free runs the free-plan models); only its budget speaks. Pure,
 * so the rule is tested apart from the panel that draws it (help/code.ts).
 */

export type SpendScope = { scope: "org" | "team" | "key"; label: string; limitUsd: number; spentUsd: number; pct: number };
export type SpendState = { ok: boolean; hasPlan: boolean; plan: string; canManage: boolean; tightest: SpendScope | null };

export const WARN_PCT = 75;
const usd = (v: number): string => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Which banner this is, for a dismissal (his order, 2026-09-29: "the warning
 *  above should be dismissable"). A dismissed banner stays down until it says
 *  something new: a warning that becomes "used all of it", or another budget. */
export function bannerKey(kind: "out" | "warn", s: SpendState | null): string {
  const t = s?.tightest;
  return t ? `${kind}:${t.scope}:${t.limitUsd}` : kind;
}

/** Nothing, a warning, or out of money. `refused`: a request was just turned
 *  away on this budget (what is left cannot pay for one), so it reads as out
 *  even short of 100% (his report, 2026-09-29: "that request says it is out of
 *  funds but the screen still says the user has funds"). */
export function spendBanner(s: SpendState | null, refused = false): { kind: "out" | "warn"; title: string; body: string } | null {
  if (!s?.ok) return null;
  const t = s.tightest;
  if (!t || (t.pct < WARN_PCT && !refused)) return null;
  const figures = `${usd(t.spentUsd)} of ${usd(t.limitUsd)} this month`;
  if (refused && t.pct < 100) {
    return { kind: "out", title: `Not enough left in ${t.label}`, body: `${usd(Math.max(0, t.limitUsd - t.spentUsd))} left, less than a request needs. Model calls stop until it is raised or the month turns.` };
  }
  if (t.pct >= 100) return { kind: "out", title: `You've used all of ${t.label}`, body: `${figures}. Model calls stop until it is raised or the month turns.` };
  return { kind: "warn", title: `You've used ${Math.floor(t.pct)}% of ${t.label}`, body: `${figures}. Add funds or raise the limit before it runs out.` };
}
