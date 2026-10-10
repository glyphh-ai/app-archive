/**
 * Usage — the greeting, the budget and spend cards, and the per-day usage
 * chart (dollars + calls) on Settings › Usage and the Platform head. The Home
 * dashboard these came from is gone (2026-10-10). All numbers come from the
 * server via window.glyphh.dashboardData() (see home-ipc.ts).
 */

import { $a, cssVar } from "./shared.js";
import { gotoSection } from "./navigation.js";
import { accountApi } from "./settings-api.js";

// Chart.js is loaded globally (app-libs/chart.js → window.Chart) by home.html.
declare const Chart: any;

interface DashboardData {
  name: string;
  plan: string;           // the plan's display name (a bare tier slug on old builds)
  orgBudget: boolean;     // false = the budget is admin-only for this account
  remainingUsd: number;   // dollars left in the budget this period (admins only)
  poolUsdPerMonth: number; // what the plan funds each month, dollar for dollar
  fundsUsd: number;       // purchased + granted dollars on top of the plan
  budgetSpentUsd: number; // Pipedream dollars spent this period
  periodEnd: string | null;
  spendUsd: number;       // dollars spent this calendar month, all sources
  spendPipedreamUsd: number;
  spendProviderUsd: number;
  requests: number;       // metered calls this month
  appsCount: number;      // apps hosted for this org
}

let chart: { destroy: () => void } | null = null;

export function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : "Welcome back";
}

/** "1,204" for counts. */
function fmtInt(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString();
}

/** Dollars — "$12.34"; sub-cent spend is real (a single call can cost a
 *  fraction of a cent), so small amounts keep up to four decimals rather than
 *  rounding to a $0.00 that reads as free. */
function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  const v = Math.max(0, n);
  const digits = v > 0 && v < 0.01 ? 4 : 2;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
}

/** "Jul 5" from a "YYYY-MM-DD" bucket (parsed as local, not UTC). */
function shortDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type SeriesPoint = { day: string; key: string; usd: number; requests: number };
type SeriesData = { from: string; to: string; points: SeriesPoint[] };

/** Stable per-key hue — the same name always gets the same color (matches the
 *  agent model badges' scheme). */
function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/** "anthropic::claude-fable-5" → "claude-fable-5" for legend labels. */
function keyLabel(key: string): string {
  const i = key.lastIndexOf("::");
  return i >= 0 ? key.slice(i + 2) : key;
}

/** Every day in [from, to] as YYYY-MM-DD — the API omits empty days. */
function dayRange(from: string, to: string): string[] {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const out: string[] = [];
  const d = new Date(fy!, (fm ?? 1) - 1, fd ?? 1);
  const end = new Date(ty!, (tm ?? 1) - 1, td ?? 1);
  while (d <= end && out.length < 400) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/** The stacked usage chart: one bar per day, one colored segment per model (or
 *  source), heaviest spenders stacked first. `only` narrows to a single key. */
function renderChart(series: SeriesData, only: string): void {
  const canvas = $a<HTMLCanvasElement>("dash-usage-chart");
  const empty = document.getElementById("dash-usage-empty");
  if (!canvas || typeof Chart === "undefined") return;

  if (chart) { chart.destroy(); chart = null; }

  const points = only ? series.points.filter((p) => p.key === only) : series.points;
  const hasData = points.some((p) => p.usd > 0 || p.requests > 0);
  empty?.classList.toggle("hidden", hasData);
  canvas.style.visibility = hasData ? "visible" : "hidden";
  if (!hasData) return;

  const days = dayRange(series.from, series.to);
  const dayIdx = new Map(days.map((d, i) => [d, i]));
  // Keys ordered by total spend so the biggest segments sit at the stack's base.
  const totals = new Map<string, number>();
  for (const p of points) totals.set(p.key, (totals.get(p.key) ?? 0) + p.usd);
  const keys = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);

  const cells = new Map<string, SeriesPoint>();
  for (const p of points) cells.set(`${p.day}|${p.key}`, p);
  const datasets = keys.map((key) => ({
    label: keyLabel(key),
    data: days.map((d) => cells.get(`${d}|${key}`)?.usd ?? 0),
    backgroundColor: `hsl(${hueFor(key)} 62% 52%)`,
    hoverBackgroundColor: `hsl(${hueFor(key)} 62% 60%)`,
    borderRadius: 3,
    maxBarThickness: 34,
    __key: key,
  }));

  const ctx = canvas.getContext("2d")!;
  chart = new Chart(ctx, {
    type: "bar",
    data: { labels: days.map(shortDay), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: keys.length > 1,
          position: "bottom",
          labels: { color: cssVar("--text-3") || "#868686", boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "circle" },
        },
        tooltip: {
          callbacks: {
            label: (c: { parsed: { y: number }; dataIndex: number; dataset: { label: string; __key: string } }) => {
              const cell = cells.get(`${days[c.dataIndex]}|${c.dataset.__key}`);
              return `${c.dataset.label}: ${fmtUsd(c.parsed.y)}${cell ? ` · ${fmtInt(cell.requests)} calls` : ""}`;
            },
          },
        },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: cssVar("--text-3") || "#868686", maxRotation: 0, autoSkip: true } },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: cssVar("--border") || "rgba(255,255,255,0.08)" },
          ticks: { color: cssVar("--text-3") || "#868686", callback: (v: number) => fmtUsd(v) },
        },
      },
    },
  });
}

/** Fetch the series per the three dropdowns and repaint the chart + totals. */
/** The chart lives in Settings › Usage now — Settings' loader calls this. */
export async function loadUsageChart(): Promise<void> {
  const daysSel = document.getElementById("dash-usage-days") as HTMLSelectElement | null;
  const groupSel = document.getElementById("dash-usage-group") as HTMLSelectElement | null;
  const filterSel = document.getElementById("dash-usage-filter") as HTMLSelectElement | null;
  const memberSel = document.getElementById("dash-usage-member") as HTMLSelectElement | null;
  // A Members-page "View usage" hand-off pre-narrows the chart to that member
  // (his spec, 2026-08-25). Consumed once; the select then owns the state.
  try {
    const stash = sessionStorage.getItem("glyphhDashMemberFilter");
    if (stash && memberSel) {
      sessionStorage.removeItem("glyphhDashMemberFilter");
      if (!Array.from(memberSel.options).some((o) => o.value === stash)) {
        const o = document.createElement("option");
        o.value = stash;
        o.textContent = "Selected member";
        memberSel.appendChild(o);
      }
      memberSel.value = stash;
    }
  } catch { /* private mode */ }
  const win = parseInt(daysSel?.value || "30", 10);
  const groupBy = groupSel?.value === "source" ? "source" : "model";
  // The member narrowing is org_admin-only; an empty value means "everyone",
  // which is also what a non-admin always sends.
  const env = await window.glyphh.usageSeries?.(win, groupBy, memberSel?.value || "");
  if (!env?.ok || !env.data) return;
  const series = env.data as SeriesData;

  // The narrowing dropdown lists what the window actually contains; a stale
  // selection (model gone from the window) falls back to "all".
  if (filterSel) {
    const prev = filterSel.value;
    const keys = [...new Set(series.points.map((p) => p.key))].sort();
    filterSel.innerHTML = `<option value="">${groupBy === "model" ? "All models" : "All sources"}</option>`;
    for (const k of keys) {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = keyLabel(k);
      filterSel.appendChild(o);
    }
    if (keys.includes(prev)) filterSel.value = prev;
  }
  const only = filterSel?.value || "";

  const shown = only ? series.points.filter((p) => p.key === only) : series.points;
  const usd = shown.reduce((s, p) => s + p.usd, 0);
  const calls = shown.reduce((s, p) => s + p.requests, 0);
  // GUARDED (his report, 2026-09-11): these loaders now run on surfaces
  // where the chart DOM may not exist (web platform) — absent DOM = no-op,
  // never a boot-killing rejection.
  const totalEl = document.getElementById("dash-usage-total");
  const rangeEl = document.getElementById("dash-usage-range");
  if (totalEl) totalEl.textContent = `${fmtUsd(usd)} · ${fmtInt(calls)} calls`;
  if (rangeEl) rangeEl.textContent = `last ${win} days`;
  if (!totalEl) return;
  renderChart(series, only);
}

/**
 * The usage chart's MEMBER filter — the one control the platform's dashboard
 * had and this app didn't. The roster is org_admin-only server-side, so a
 * member's rejected call simply leaves the dropdown hidden; there is nothing
 * to explain because there is nothing they could have chosen.
 */
export async function loadUsageMembers(): Promise<void> {
  const sel = document.getElementById("dash-usage-member") as HTMLSelectElement | null;
  if (!sel) return;
  // Members see ONLY themselves (his ruling, 2026-09-12) — the roster filter
  // is the admin's. Explicit role check: the members read succeeding is not
  // proof of adminship, and the dropdown was leaking the roster to everyone.
  // The server pins non-admin usage reads to self regardless.
  const account = await window.glyphh.getAccountInfo?.().catch(() => null);
  const admin = !!account?.role && ["org_admin", "admin", "super_admin"].includes(account.role);
  if (!admin) { sel.classList.add("hidden"); return; }
  try {
    const members = await accountApi().members();
    if (!members?.length) { sel.classList.add("hidden"); return; }
    const prev = sel.value;
    sel.innerHTML = `<option value="">All members</option>`;
    for (const m of members) {
      const opt = document.createElement("option");
      opt.value = m.userId;
      opt.textContent = m.name || m.email;
      sel.appendChild(opt);
    }
    if (Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
    sel.classList.remove("hidden");
  } catch {
    // Not an admin (or offline) — no roster, no filter. The chart still shows
    // exactly what the server scopes to this caller.
    sel.classList.add("hidden");
  }
}

/** The three metric cards — they live in Settings › Usage now, alongside the
 *  chart; Settings' loader calls this. */
export async function loadUsageMetrics(): Promise<void> {
  try {
    const data = (await window.glyphh.dashboardData?.()) as DashboardData | undefined;
    if (!data) return;
    // data.plan is the plan's DISPLAY NAME off the catalog now (a bare tier
    // slug only on old builds) — capitalize only single-word slugs.
    const planName = data.plan
      ? (data.plan.includes(" ") ? data.plan : data.plan.charAt(0).toUpperCase() + data.plan.slice(1))
      : "";
    // The org's budget (his ruling, 2026-09-20: dollars, no
    // per-member caps). A member's 403 reads as pooled — they draw from the
    // org's budget and the admin sees the number.
    $a("dash-budget-label").textContent = "Budget";
    if (data.orgBudget === false) {
      $a("dash-budget-value").textContent = "Pooled";
      $a("dash-budget-sub").textContent = `${planName ? `${planName} plan · ` : ""}calls through Glyphh draw from the org's budget`;
    } else {
      $a("dash-budget-value").textContent = fmtUsd(data.remainingUsd);
      $a("dash-budget-sub").textContent = `${planName ? `${planName} plan · ` : ""}${fmtUsd(data.poolUsdPerMonth)} / month${data.fundsUsd > 0 ? ` + ${fmtUsd(data.fundsUsd)} funds` : ""}`;
    }

    $a("dash-spend-value").textContent = fmtUsd(data.spendUsd);
    $a("dash-spend-sub").textContent = `${fmtUsd(data.spendPipedreamUsd)} Pipedream · ${fmtUsd(data.spendProviderUsd)} models${data.requests ? ` · ${fmtInt(data.requests)} calls` : ""}`;

    $a("dash-apps-value").textContent = fmtInt(data.appsCount);
  } catch (err) {
    console.error("[dashboard] usage metrics load failed", err);
  }
}

/** "Good afternoon, Chris" — time of day + first name, on the platform head.
 *  Identity.name is often unset, so the PROFILE's firstName is the backstop. */
export function paintDashGreeting(): void {
  const el = document.getElementById("dash-greeting");
  if (!el) return;
  void (async () => {
    let first = "";
    let email = "";
    try {
      const info = await Promise.resolve(window.glyphh.getAccountInfo?.());
      first = (info?.firstName || "").trim();
      email = (info?.email || "").trim();
    } catch { /* fall through */ }
    if (!first) {
      try {
        const prof = await accountApi().profile();
        first = (prof?.firstName || "").trim();
        email = email || (prof?.email || "").trim();
      } catch { /* fall through */ }
    }
    if (!first && email) {
      // Last resort: the email local part ("chris.timmerman@…" → "Chris") —
      // the greeting always carries a first name.
      const raw = email.split("@")[0]?.split(/[._-]/)[0] || "";
      first = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
    }
    el.textContent = greeting(first);
  })();
}

let wired = false;
export function initUsageEvents(): void {
  if (wired) return;
  wired = true;
  // Billing is a NATIVE panel now (Settings › Billing) — it used to open the
  // platform's /billing page in a workbench browser; there's nothing left over
  // there that this app can't do itself.
  // The header's primary action is the community (his order, 2026-08-25) —
  // funds are added on Usage.
  document.getElementById("dash-discord")?.addEventListener("click", () => {
    // typeof guard: on web window.glyphh is a Proxy that fabricates a FUNCTION
    // for any name — a truthy || would "open" that function, not a URL.
    const raw = (window.glyphh as unknown as { discordInvite?: unknown }).discordInvite;
    window.open(typeof raw === "string" && raw ? raw : "https://discord.gg/P3yynv4v9", "_blank", "noopener");
  });
  document.getElementById("dash-get-key")?.addEventListener("click", () => {
    // "apikeys" died with the old keys page — the gateway keys page is where
    // keys are minted now (his report, 2026-09-12: the button opened a blank
    // panel because no sub by that name exists).
    gotoSection("settings", "gateway-keys");
  });
  paintDashGreeting();
  // the refresh button rides the chart card in Settings › Usage
  document.getElementById("dash-refresh")?.addEventListener("click", () => {
    void loadUsageChart();
  });
  for (const id of ["dash-usage-days", "dash-usage-group", "dash-usage-filter", "dash-usage-member"]) {
    document.getElementById(id)?.addEventListener("change", () => { void loadUsageChart(); });
  }
}
