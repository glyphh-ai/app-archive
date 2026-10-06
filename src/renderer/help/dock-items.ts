/**
 * dock-items.ts — THE DOCK'S ITEM LIST, one table (moved out of
 * code-workbench.ts, 2026-10-04): the fixed nav slots the dock ships with,
 * and the one rule for what the wall shows when the dock is on or off.
 *
 * His order (2026-10-04): "when Show the dock is off, all the dock apps /
 * icons should show in the echo panel as the first x items from top left."
 * The dock's live list is the member's own order (`echoDockOrder`: these nav
 * keys plus the CLI tiles and anything traded in from the pages); the dock
 * paints from it and, with the dock off, the wall leads with it — the SAME
 * list, so the two can never disagree. `wallTilesFor` is that rule, pure and
 * unit-tested (test/main/dock-items.test.ts).
 *
 * Icon language — the office family's (VIEW_META's gsheet/gdoc/gpoint set):
 * FULL-BLEED object silhouettes in saturated fills with white/tinted details,
 * never a glyph trapped in a uniform colored square. Tabs, Workspaces, Drips
 * and Platform live in Settings and keep no slot (his orders, 2026-09-12/16);
 * Settings is back (2026-09-17); the Browser was never a web slot.
 */

export interface DockItem { key: string; title: string; icon: string }

export const DOCK_ITEMS: ReadonlyArray<DockItem> = Object.freeze([
  { key: "glyphh",   title: "New session",    icon: `<img src="brand/glyphh-mark.png" alt="" draggable="false"/>` },
  // An empty square with a + (his order, 2026-09-16): the New tab form, straight from the dock.
  { key: "newtab",   title: "New tab",        icon: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4" stroke-dasharray="3 2.5"/><path d="M12 8v8M8 12h8"/></svg>` },
  { key: "settings", title: "Settings",       icon: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g style="fill:#71717a;stroke:none"><rect x="10.6" y="1.2" width="2.8" height="21.6" rx="1.3"/><rect x="10.6" y="1.2" width="2.8" height="21.6" rx="1.3" transform="rotate(45 12 12)"/><rect x="10.6" y="1.2" width="2.8" height="21.6" rx="1.3" transform="rotate(90 12 12)"/><rect x="10.6" y="1.2" width="2.8" height="21.6" rx="1.3" transform="rotate(135 12 12)"/><circle cx="12" cy="12" r="8"/></g><circle cx="12" cy="12" r="3.2" style="fill:#ffffff;stroke:none"/></svg>` },
  { key: "cc",       title: "Command center", icon: `<svg class="icon" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8.5" height="8.5" rx="2" style="fill:#8c3bf2"/><rect x="12.5" y="3" width="8.5" height="8.5" rx="2" style="fill:#a855f7"/><rect x="3" y="12.5" width="8.5" height="8.5" rx="2" style="fill:#7c3aed"/><rect x="12.5" y="12.5" width="8.5" height="8.5" rx="2" style="fill:#c084fc"/></svg>` },
  { key: "closeall", title: "Close all",      icon: `<svg class="icon" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="2.5" width="19" height="19" rx="5" style="fill:#f43f5e"/><rect x="5.5" y="5.5" width="5.4" height="5.4" rx="1.4" style="fill:#ffe4e6;opacity:.9"/><rect x="13.1" y="5.5" width="5.4" height="5.4" rx="1.4" style="fill:#ffe4e6;opacity:.55"/><rect x="5.5" y="13.1" width="5.4" height="5.4" rx="1.4" style="fill:#ffe4e6;opacity:.55"/><path d="m13.6 13.6 4.9 4.9m0-4.9-4.9 4.9" style="stroke:#fff;stroke-width:2.2;stroke-linecap:round"/></svg>` },
]);

/** The nav item behind a dock key, or null for a traded tile's key (agent:…, app:…). */
export function dockItemFor(key: string): DockItem | null {
  return DOCK_ITEMS.find((d) => d.key === key) ?? null;
}

export interface WallTilesInput<T> {
  /** The "Show the dock" pref (help/dock-band.ts). */
  dockEnabled: boolean;
  /** The dock's tiles in the dock's own order — every key the dock paints. */
  dockItems: T[];
  /** The wall's tiles in the wall's own order (ccIconOrder + the rest). */
  wallItems: T[];
  /** The key a tile orders under; null for an unkeyed tile (always shown). */
  keyOf: (t: T) => string | null;
}

/**
 * The wall's list, in order, no duplicates:
 *  - dock ON  → the wall's tiles minus whatever the dock carries (a CLI or an
 *               app traded into the dock lives there, not on the pages);
 *  - dock OFF → the dock's tiles FIRST, in the dock's order, from the top-left,
 *               then the wall's tiles — a tile the dock carries is never shown
 *               twice.
 * A tile with no key is kept wherever it sits; a keyed tile is shown once.
 */
export function wallTilesFor<T>(i: WallTilesInput<T>): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const take = (t: T): void => {
    const k = i.keyOf(t);
    if (k !== null) {
      if (seen.has(k)) return;
      seen.add(k);
    }
    out.push(t);
  };
  if (i.dockEnabled) {
    for (const t of i.dockItems) { const k = i.keyOf(t); if (k !== null) seen.add(k); }
  } else {
    for (const t of i.dockItems) take(t);
  }
  for (const t of i.wallItems) take(t);
  return out;
}


/** WHAT THE DOCK KEEPS when its families are re-read (his report, 2026-10-07:
 *  "the desktop is not remembering the state of the dock after restarts").
 *  A key is pruned only when its family answered a LIST that lacks it. A read
 *  that failed (null) or answered nothing at all (a cold start before the
 *  server, a CLI list not ready) says nothing about the dock and prunes
 *  nothing: an empty answer is not a deletion. Nav slots and folders are never
 *  this rule's business. */
export interface DockLive { apps?: readonly string[] | null; layouts?: readonly string[] | null; agents?: readonly string[] | null }
export function keepDockKeys(keys: readonly string[], live: DockLive): string[] {
  const known = (list: readonly string[] | null | undefined): Set<string> | null => (Array.isArray(list) && list.length ? new Set(list) : null);
  const apps = known(live.apps), layouts = known(live.layouts), agents = known(live.agents);
  return keys.filter((k) => {
    if (k.startsWith("app:")) return !apps || apps.has(k);
    if (k.startsWith("layout:")) return !layouts || layouts.has(k);
    if (k.startsWith("agent:")) return !agents || agents.has(k);
    return true;
  });
}
