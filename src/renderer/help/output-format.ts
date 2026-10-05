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
/** What a chat record may carry — only the live picks are ever stored. */
export type StoredOutputFormat = "auto" | "artifact";

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

/** Only a live pick may be stored on a chat; anything else reads as Auto. */
export function isStoredOutputFormat(v: unknown): v is StoredOutputFormat {
  return typeof v === "string" && OUTPUT_FORMATS.some((f) => f.available && f.id === v);
}

/** The chat's pick, folded: an unknown or absent stamp is Auto. */
export function outputFormatOf(v: unknown): StoredOutputFormat {
  return isStoredOutputFormat(v) ? v : "auto";
}

/** The chip's word: "Output" on Auto, the pick's label otherwise. */
export function outputChipLabel(v: unknown): string {
  const id = outputFormatOf(v);
  return id === "auto" ? "Output" : (OUTPUT_FORMATS.find((f) => f.id === id)?.label ?? "Output");
}

/** The ONE line an Artifact pick adds to the turn's standing instructions. */
export const ARTIFACT_STANDING_LINE =
  "Deliver the result as an artifact: build it and publish it with the artifact_publish tool, then report its link.";

/** What the pick adds to the turn: nothing on Auto, the line on Artifact. */
export function outputStandingLine(v: unknown): string {
  return outputFormatOf(v) === "artifact" ? ARTIFACT_STANDING_LINE : "";
}
