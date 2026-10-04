/**
 * session-locus.ts — WHERE A SESSION RUNS, as one set of pure rules (his
 * orders, 2026-10-04): a thread is born on the desktop (this machine, or the
 * attached desktop over the relay) or in the cloud (a worker workspace
 * mirrored to R2), and that locus never changes mid-thread ("cloud stays
 * cloud"). Everything that reads the locus reads it from here:
 *
 *   · the ONE recents filter — loop + place + type + search — that the left
 *     rail and the agent panel's recents dropdown apply identically;
 *   · the folder picker's SECTIONS ("On this desktop" / "On <machine>" and
 *     "In the cloud") and the DEFAULT locus per surface;
 *   · the GRANT check on the web: a desktop session whose folder is not one
 *     the attached desktop granted for remote control is LOCKED (listed, with
 *     a lock glyph; opening it shows the grant card instead of running).
 *
 * Nothing here touches the DOM — code.ts and code-source-chip.ts paint what
 * these functions decide, and the unit tests run them bare.
 */

export type Locus = "local" | "cloud";

/** The place filter: "" = every place, else one locus. */
export type LocusFilter = "" | Locus;

export const LOCUS_FILTER_PREF = "recentsLocusFilter";
export const LOCUS_OPTIONS: ReadonlyArray<{ key: Locus; name: string }> = [
  { key: "local", name: "This desktop" },
  { key: "cloud", name: "Cloud" },
];

export const LOCUS_TITLE: Record<Locus, string> = {
  local: "Runs on the desktop",
  cloud: "Runs in the cloud",
};

/** A monitor and a cloud — the same two glyphs on the chip, the rail rows and
 *  the recents dropdown, drawn in currentColor so nothing loads. */
export const LOCUS_SVG: Record<Locus, string> = {
  local: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
  cloud: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4.3 12.3 3.5 3.5 0 0 0 5.5 19z"/></svg>`,
};
export const LOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

/** Coerce a stored preference into a place filter; anything else is "all". */
export function locusFilterOf(v: unknown): LocusFilter {
  return v === "local" || v === "cloud" ? v : "";
}

// ── THE ONE RECENTS FILTER ───────────────────────────────────────────────

/** What a recents row must say about itself to be filtered. `loopKey` is the
 *  loop the row ran on ("glyphh", "glyphh-cli", "claude", …). */
export interface RecentsRowLike {
  title: string;
  cwd: string;
  mode: string;
  loopKey: string;
  locus?: Locus;
}

export interface RecentsFilter {
  /** The type tab; absent = every type (the CLI window's own pool). */
  tab?: string;
  /** The loops picked in the funnel; empty = every loop. */
  loops: readonly string[];
  /** The loops THIS list can hold — a filter naming none of them is no filter here. */
  among?: ReadonlySet<string>;
  /** The place picked in the funnel; "" = every place. */
  locus: LocusFilter;
  /** The search box, matched against title and folder. */
  query?: string;
}

/** Does the filter keep this row? One rule for the rail and the dropdown. */
export function recentsKeeps(row: RecentsRowLike, f: RecentsFilter): boolean {
  if (f.tab && row.mode !== f.tab) return false;
  const loops = f.among ? f.loops.filter((k) => f.among!.has(k)) : f.loops;
  if (loops.length && !loops.includes(row.loopKey)) return false;
  if (f.locus && (row.locus ?? "local") !== f.locus) return false;
  const q = (f.query ?? "").trim().toLowerCase();
  if (q && !`${row.title} ${row.cwd}`.toLowerCase().includes(q)) return false;
  return true;
}

export function filterRecents<T extends RecentsRowLike>(rows: readonly T[], f: RecentsFilter): T[] {
  return rows.filter((r) => recentsKeeps(r, f));
}

/** Is the funnel narrowing anything the list can hold? Lights the button. */
export function recentsFilterActive(f: Pick<RecentsFilter, "loops" | "among" | "locus">): boolean {
  const loops = f.among ? f.loops.filter((k) => f.among!.has(k)) : f.loops;
  return loops.length > 0 || !!f.locus;
}

// ── THE GRANT ────────────────────────────────────────────────────────────

/** Both separators as one, no trailing slash — a Windows grant must match a
 *  Windows folder the same way a POSIX one does. */
function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** Is `path` one of `folders` or inside one of them? Prefix on a whole
 *  segment — `/a/b` is inside `/a`, `/a/bc` is not. */
export function folderGranted(path: string, folders: readonly string[]): boolean {
  if (!path) return false;
  const p = normPath(path);
  return folders.some((f) => {
    const g = normPath(f);
    return !!g && (p === g || p.startsWith(`${g}/`));
  });
}

export interface GrantedMachine { id?: string; name?: string; folders?: readonly string[] }

/**
 * A DESKTOP session is locked on the web when its folder is not inside any
 * folder an attached desktop granted. A folderless session (a Work thread) is
 * never locked — a turn without a folder is allowed through the relay. On
 * the desktop itself nothing is locked: the machine is this process.
 */
export function sessionLocked(
  row: { locus?: Locus; cwd: string },
  surface: "desktop" | "web",
  machines: readonly GrantedMachine[],
): boolean {
  if (surface !== "web") return false;
  if ((row.locus ?? "local") !== "local" || !row.cwd) return false;
  return !machines.some((m) => folderGranted(row.cwd, m.folders ?? []));
}

export const GRANT_CARD = {
  title: "Grant this folder in Remote control on your desktop",
  body: (folder: string): string =>
    `This session works in ${folder}, which the desktop has not granted for remote control. Open Settings → Remote control on your desktop and add the folder, then open the session again.`,
};

// ── THE PICKER ───────────────────────────────────────────────────────────

export interface PickerMachine { id?: string; name: string; folders: readonly string[] }
export interface PickerSpace { id: string; updatedAt: number; top: readonly string[] }

export interface PickerDesktopSection {
  kind: "desktop";
  label: string;
  /** The attached desktop (web). Absent on the desktop itself and when none is attached. */
  machine?: PickerMachine;
  /** The folders listed under the head: the granted roots (web). */
  folders: readonly string[];
  /** Why the section offers nothing, when it does not. */
  empty?: string;
  /** The born session runs elsewhere — rows are shown but not pickable. */
  locked?: string;
}
export interface PickerCloudSection {
  kind: "cloud";
  label: string;
  spaces: readonly PickerSpace[];
  locked?: string;
}

export interface PickerModel {
  sections: [PickerDesktopSection, PickerCloudSection];
  /** Where a NEW session lands when the user has not picked. */
  defaultLocus: Locus;
}

/** The default place for a new session: the desktop where there is one — the
 *  machine itself, or on the web an ATTACHED desktop — else the cloud. */
export function defaultLocus(surface: "desktop" | "web", attached: boolean): Locus {
  if (surface === "desktop") return "local";
  return attached ? "local" : "cloud";
}

export const LOCUS_LOCKED_HINT: Record<Locus, string> = {
  local: "This session runs on the desktop — start a new session to work in the cloud",
  cloud: "This session runs in the cloud — start a new session to work on the desktop",
};

/**
 * The two sections of the folder picker and the default, from what the
 * surface knows: on the desktop the first section is this machine; on the web
 * it is the attached desktop (the first one) and its granted folders. A born
 * session locks the OTHER section — its locus is fixed at birth.
 */
export function pickerSections(input: {
  surface: "desktop" | "web";
  machines: readonly PickerMachine[];
  spaces: readonly PickerSpace[];
  bornLocus: Locus | null;
}): PickerModel {
  const machine = input.surface === "web" ? input.machines[0] : undefined;
  const desktop: PickerDesktopSection = input.surface === "desktop"
    ? { kind: "desktop", label: "On this desktop", folders: [] }
    : machine
      ? { kind: "desktop", label: `On ${machine.name}`, machine, folders: machine.folders, ...(machine.folders.length ? {} : { empty: "No folder is granted on this desktop yet — add one under Settings → Remote control there." }) }
      : { kind: "desktop", label: "On your desktop", folders: [], empty: "No desktop is attached — turn remote control on in the Glyphh desktop app." };
  const cloud: PickerCloudSection = { kind: "cloud", label: "In the cloud", spaces: input.spaces };
  if (input.bornLocus === "cloud") desktop.locked = LOCUS_LOCKED_HINT.cloud;
  if (input.bornLocus === "local") cloud.locked = LOCUS_LOCKED_HINT.local;
  return { sections: [desktop, cloud], defaultLocus: defaultLocus(input.surface, !!machine) };
}

/** The locus a source names. Anything not local is the cloud. */
export function sourceLocus(source: { kind: string } | null | undefined): Locus {
  return source?.kind === "local" ? "local" : "cloud";
}
