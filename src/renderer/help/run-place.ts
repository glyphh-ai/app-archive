/**
 * run-place — WHERE A CLI RUNS, as pure rows (his order, 2026-10-07): the
 * desktops first (a note when none is attached on the web), then Default and
 * the member's cloud environments, the composer's current place checked.
 * run-place-modal.ts paints these; the tests read them bare.
 */

export type RunPlace = { kind: "desktop"; machine: { id?: string; name: string }; folder?: string } | { kind: "cloud"; environmentId: string };

export interface RunPlaceInput {
  surface: "web" | "desktop";
  /** The attached desktops (web), each with the folders it granted; on the desktop the machine is itself. */
  machines: ReadonlyArray<{ id?: string; name: string; folders?: readonly string[] }>;
  /** Desktop folders recent sessions ran in — offered under the grants. */
  recents?: readonly string[];
  environments: ReadonlyArray<{ id: string; name: string; subline?: string }>;
  /** Where the composer stands now — the checked row. */
  current: RunPlace | null;
}

export interface RunPlaceRow { section: "desktop" | "cloud"; place: RunPlace | null; label: string; sub: string; selected: boolean }

export const CHECK = `<svg class="drop-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

/** The rows, pure: the desktops first (a note when none is attached on the
 *  web), then Default and the member's environments. */
export function runPlaceRows(i: RunPlaceInput): RunPlaceRow[] {
  const out: RunPlaceRow[] = [];
  const machines = i.surface === "desktop" && !i.machines.length ? [{ name: "This desktop" }] : [...i.machines];
  if (!machines.length) out.push({ section: "desktop", place: null, label: "No desktop attached", sub: "Turn remote control on in the Glyphh desktop app (Settings → Remote control).", selected: false });
  for (const m of machines) {
    const selected = i.current?.kind === "desktop" && (!i.current.machine.id || !m.id || i.current.machine.id === m.id);
    out.push({ section: "desktop", place: { kind: "desktop", machine: m }, label: m.name || "Glyphh desktop", sub: "Runs on this desktop", selected });
  }
  const envs = [{ id: "default", name: "Default", subline: "" }, ...i.environments.filter((e) => e.id !== "default")];
  for (const e of envs) {
    out.push({ section: "cloud", place: { kind: "cloud", environmentId: e.id }, label: e.name, sub: e.subline ?? "", selected: i.current?.kind === "cloud" && i.current.environmentId === e.id });
  }
  return out;
}

/** THE FOLDER STEP (his order, 2026-10-07: "it doesn't allow the user to then
 *  also pick the folder"): a desktop picked, its granted folders lead, then
 *  the recent folders inside a grant, each once. On the desktop itself (no
 *  grants) the recents stand alone and Browse… opens the machine's picker. */
export interface FolderRow { path: string; label: string; sub: string }
const leaf = (p: string): string => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
const inside = (p: string, folders: readonly string[]): boolean => folders.some((f) => p === f || p.startsWith(f.endsWith("/") ? f : `${f}/`));
/** THE FOLDER CHIP under the desktop's box (his order, 2026-10-07, Claude's
 *  "Project or folder" chip): the session's folder first and checked, then
 *  the recents, each once. Pure. */
export function folderChipRows(selected: string, recents: readonly string[]): Array<FolderRow & { selected: boolean }> {
  const out: Array<FolderRow & { selected: boolean }> = [];
  const seen = new Set<string>();
  for (const p of [selected, ...recents]) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push({ path: p, label: leaf(p), sub: p, selected: p === selected });
  }
  return out;
}
/** What the chip reads: the folder's name, or "Folder" with none picked. */
export function folderChipLabel(folder: string): string {
  return folder ? leaf(folder) : "Folder";
}
export function folderRows(machine: { folders?: readonly string[] }, recents: readonly string[] = []): FolderRow[] {
  const grants = machine.folders ?? [];
  const out: FolderRow[] = grants.map((f) => ({ path: f, label: leaf(f), sub: f }));
  const seen = new Set(grants);
  for (const r of recents) {
    if (!r || seen.has(r) || (grants.length && !inside(r, grants))) continue;
    seen.add(r);
    out.push({ path: r, label: leaf(r), sub: r });
  }
  return out;
}
