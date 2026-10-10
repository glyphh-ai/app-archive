/**
 * glyphh-holds.ts — WHAT GLYPHH HOLDS (his order, 2026-10-09: "that page
 * defaults to having access to everything so all connections, all powers, all
 * everything and the folders set at the system level. The user has to
 * explicitly take them away"). Pure, so the rules test without a page.
 */

export type HoldKind = "folders" | "connections" | "models" | "skills" | "superPowers";
const KINDS: ReadonlyArray<HoldKind> = ["folders", "connections", "models", "skills", "superPowers"];
/** WHAT GLYPHH WAS DENIED (his order, 2026-10-09): Glyphh's page holds
 *  EVERYTHING the member has — every connection, power, super power and
 *  model, and the folders granted under Settings → System — and its record
 *  keeps only what was taken away (shared/member-library.ts withheld). */
export type Withheld = Partial<Record<HoldKind, string[]>>;
export type Everything = Record<HoldKind, string[]>;
export const NOTHING: Everything = Object.freeze({ folders: [], connections: [], models: [], skills: [], superPowers: [] }) as unknown as Everything;
/** Glyphh as its page shows it: everything, less what was withheld. */
export function glyphhView<R extends object>(row: R, all: Everything, withheld: Withheld): R & Everything & { model: string } {
  const held = (k: HoldKind): string[] => all[k].filter((x) => !(withheld[k] ?? []).includes(x));
  return { ...row, model: "", models: held("models"), folders: held("folders"), connections: held("connections"), skills: held("skills"), superPowers: held("superPowers") };
}
/** What is withheld when Glyphh holds `held`: everything not in it. */
export function withheldFor(all: Everything, held: Partial<Record<HoldKind, readonly string[]>>): Withheld {
  const out: Withheld = {};
  for (const kind of KINDS) {
    const keep = new Set(held[kind] ?? []);
    const no = all[kind].filter((x) => !keep.has(x));
    if (no.length) out[kind] = no;
  }
  return out;
}
/** Glyphh's record holds no lists of its own: only what it was denied. */
export function glyphhPatch(withheld: Withheld): Record<string, unknown> {
  return { withheld, folders: [], connections: [], models: [], skills: [], superPowers: [] };
}

