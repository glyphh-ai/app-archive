/**
 * spend-state.ts — WHERE THE MEMBER STANDS ON MONEY (his order, 2026-09-29:
 * "anytime the user is out of money or as they approach their team or org
 * limit there should be a message that shows above the input… within 75% of
 * their limit"). The server answers (GET /api/me/spend-state): whether the org
 * has a plan, every budget the member's calls draw on, and the one nearest its
 * line. The panel draws the banner above its composer from this.
 */

import { ipcMain } from "electron";
import { getClient } from "./glyphh-client.js";

export interface SpendScope { scope: "org" | "team" | "key"; label: string; limitUsd: number; spentUsd: number; pct: number }
export interface SpendState { ok: boolean; hasPlan: boolean; plan: string; canManage: boolean; tightest: SpendScope | null }

export async function readSpendState(): Promise<SpendState> {
  try {
    const d = await getClient().http.get<Omit<SpendState, "ok">>("/api/me/spend-state");
    return { ok: true, hasPlan: d.hasPlan !== false, plan: String(d.plan ?? ""), canManage: !!d.canManage, tightest: d.tightest ?? null };
  } catch {
    // Offline or an older server: no banner, and the gateway's own refusals stand.
    return { ok: false, hasPlan: true, plan: "", canManage: false, tightest: null };
  }
}

export function registerSpendStateIpc(): void {
  ipcMain.handle("spend-state", () => readSpendState());
}
