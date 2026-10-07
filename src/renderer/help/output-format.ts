/**
 * output-format.ts — THE OUTPUT CHIP'S ROWS (his order, 2026-10-05: "output
 * should be a new chip we add. The list right now is just Artifacts").
 *
 * Pure data: the composer's Output chip renders Auto plus every row flagged
 * `available`. Docs, Slides and Design are listed here already so the menu
 * grows by flipping a flag, but they are NOT live yet and do not render.
 * The pick lives on the chat record (`outputFormat`) and, when it is
 * Artifact, adds ONE standing line to the turn. Nothing here touches the DOM.
 */

export type OutputFormatId = "auto" | "artifact" | "docs" | "slides" | "design";
/** What a chat record may carry — only the live picks are ever stored, and an
 *  installed app marked as an output target (`app:<instance key>`). */
export type StoredOutputFormat = "auto" | "artifact" | `app:${string}`;

// ── APPS AS OUTPUT TARGETS (his order, 2026-10-07; punch list 5) ──────────────
// An installed app whose manifest says `output: true` is a place the result
// can go. The drop-up shows the first few by this member's recent use, and a
// searchable page for the rest; the pick is the session's, like Artifact.
export const APP_OUTPUT_PREFIX = "app:";
export interface OutputApp { key: string; slug: string; name: string; tools: string[]; icon?: string | null }
export const isAppOutput = (v: unknown): v is `app:${string}` => typeof v === "string" && v.startsWith(APP_OUTPUT_PREFIX) && v.length > APP_OUTPUT_PREFIX.length;
export const appOutputKey = (v: unknown): string => (isAppOutput(v) ? v.slice(APP_OUTPUT_PREFIX.length) : "");
export const appOutputId = (key: string): `app:${string}` => `${APP_OUTPUT_PREFIX}${key}`;
/** How many apps the drop-up shows before "More outputs ›". */
export const OUTPUT_APPS_TOP = 5;
export const OUTPUT_RECENT_CAP = 20;

/** The member's most recently picked first (in that order), then the rest by name. */
export function orderedOutputApps(apps: readonly OutputApp[], recent: readonly string[], top = OUTPUT_APPS_TOP): { top: OutputApp[]; rest: OutputApp[] } {
  const byKey = new Map(apps.map((a) => [a.key, a]));
  const first: OutputApp[] = [];
  for (const k of recent) { const a = byKey.get(k); if (a && !first.includes(a)) first.push(a); }
  const rest = apps.filter((a) => !first.includes(a)).sort((a, b) => a.name.localeCompare(b.name));
  const all = [...first, ...rest];
  return { top: all.slice(0, top), rest: all.slice(top) };
}

/** A pick moves the app to the front of the member's recent list. */
export function noteOutputAppUse(recent: readonly string[], key: string, cap = OUTPUT_RECENT_CAP): string[] {
  return [key, ...recent.filter((k) => k !== key)].slice(0, cap);
}

/** The line an app pick adds to the turn: the target, its door and its tools front and center. */
export function appStandingLine(app: OutputApp): string {
  const tools = app.tools.length ? ` Its tools: ${app.tools.join(", ")}.` : "";
  return `OUTPUT TARGET: the ${app.name} app (instance key "${app.key}"). Put the result INTO this app through its own tools — app_call_tool { app: "${app.key}", tool, args } (search its tools first: find_tools / mcp_tool_search; read its skill if one is listed).${tools} The thread gets a short note of what was put where, not the result itself.`;
}

export interface OutputFormat {
  id: OutputFormatId;
  label: string;
  /** The grey line beside the label ("Let Glyphh pick the format"). */
  hint: string;
  /** An inline SVG, sized by the row's CSS. */
  icon: string;
  /** Rendered in the menu? Off = listed for later, never shown. */
  available: boolean;
}

const STROKE = `fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;

export const OUTPUT_FORMATS: readonly OutputFormat[] = [
  {
    id: "auto",
    label: "Auto",
    hint: "Glyphh answers in the thread",
    icon: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M12 3l1.8 4.6L18 9.4l-4.2 1.8L12 16l-1.8-4.8L6 9.4l4.2-1.8z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>`,
    available: true,
  },
  {
    id: "artifact",
    label: "Artifact",
    hint: "Let Glyphh pick the format",
    icon: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 10h18"/><path d="M9 20v-10"/></svg>`,
    available: true,
  },
  // Listed for later (his order, 2026-10-05: "for now ... just Artifacts").
  {
    id: "docs",
    label: "Docs",
    hint: "A document you can edit and share",
    icon: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h7"/></svg>`,
    available: false,
  },
  {
    id: "slides",
    label: "Slides",
    hint: "A deck, slide by slide",
    icon: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M12 17v4M8 21h8"/></svg>`,
    available: false,
  },
  {
    id: "design",
    label: "Design",
    hint: "A layout or mockup on the canvas",
    icon: `<svg viewBox="0 0 24 24" ${STROKE}><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.2"/><circle cx="14.5" cy="8.5" r="1.2"/><circle cx="16" cy="13.5" r="1.2"/><path d="M12 21a2 2 0 0 0 0-4h-1a1.5 1.5 0 0 1 0-3h2"/></svg>`,
    available: false,
  },
];

/** The rows the menu shows — Auto and whatever is live. */
export function liveOutputFormats(): OutputFormat[] {
  return OUTPUT_FORMATS.filter((f) => f.available);
}

/** Only a live pick may be stored on a chat — or an app target; anything else reads as Auto. */
export function isStoredOutputFormat(v: unknown): v is StoredOutputFormat {
  return isAppOutput(v) || (typeof v === "string" && OUTPUT_FORMATS.some((f) => f.available && f.id === v));
}

/** The chat's pick, folded: an unknown or absent stamp is Auto. */
export function outputFormatOf(v: unknown): StoredOutputFormat {
  return isStoredOutputFormat(v) ? v : "auto";
}

/** The chip's word: "Output" on Auto, the pick's label otherwise; an app pick wears the app's name. */
export function outputChipLabel(v: unknown, apps: readonly OutputApp[] = []): string {
  const id = outputFormatOf(v);
  if (isAppOutput(id)) return apps.find((a) => a.key === appOutputKey(id))?.name ?? "App";
  return id === "auto" ? "Output" : (OUTPUT_FORMATS.find((f) => f.id === id)?.label ?? "Output");
}

/** The ONE line an Artifact pick adds to the turn's standing instructions. */
export const ARTIFACT_STANDING_LINE =
  "Deliver the result as an artifact: build it and publish it with the artifact_publish tool, then report its link.";

/** What the pick adds to the turn: nothing on Auto, the line on Artifact, the app's line on an app. */
export function outputStandingLine(v: unknown, app?: OutputApp | null): string {
  const id = outputFormatOf(v);
  if (isAppOutput(id)) {
    const key = appOutputKey(id);
    return appStandingLine(app && app.key === key ? app : { key, slug: key.split("~")[0]!, name: key.split("~")[0]!, tools: [] });
  }
  return id === "artifact" ? ARTIFACT_STANDING_LINE : "";
}
