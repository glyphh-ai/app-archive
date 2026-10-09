/** APPS CARRY A VERSION; DEFAULTS INSTALL BY MANIFEST (his order, 2026-10-07).
 *
 *  Two things the Apps page knows that the rest of the workbench must show:
 *  how many installed apps have an update waiting (the red count on the
 *  rail's Build item, the same number the Apps page's Updates tab wears),
 *  and that the manifest-flagged default apps are installed for this member.
 *  The install is a BACKGROUND task (his word): never on the boot path, asked
 *  for after first paint, answered by the server, announced like any other
 *  install so the wall and the rail repaint. */
import { hostHas } from "./web-surface.js";

type Env<T> = { ok: boolean; data?: T; error?: string };
type Card = { instance?: { update?: { available?: boolean } | null } | null };

/** How many cards carry an update: pure, for the tests. */
export function countUpdates(cards: ReadonlyArray<Card> | null | undefined): number {
  return (cards ?? []).reduce((n, c) => n + (c?.instance?.update?.available ? 1 : 0), 0);
}

/** The red count on the rail's Build item; hidden at zero. */
export function paintBuildBadge(n: number): void {
  const b = document.getElementById("rail-build-badge");
  if (!b) return;
  b.textContent = n > 0 ? String(n) : "";
  b.classList.toggle("hidden", n <= 0);
}

/** Ask the library for the app cards and paint the count. Never throws. */
export async function refreshBuildBadge(): Promise<number> {
  const api = window.glyphh as unknown as { skillsList?: (kind: string) => Promise<Env<Card[]>> };
  if (typeof api?.skillsList !== "function") return 0;
  const r = await api.skillsList("app").catch(() => ({ ok: false } as Env<Card[]>));
  const n = r.ok ? countUpdates(r.data) : 0;
  paintBuildBadge(n);
  return n;
}
