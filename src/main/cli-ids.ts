/**
 * cli-ids.ts — THE CLI AGENT TABLE, pure (2026-10-07). Which CLIs the app
 * knows, their names and binaries, and which of them have a HEADLESS mode a
 * run with no terminal can use (his order, 2026-10-07: "allow agents and
 * tasks to define cli or glyphh agents with models"). No electron, no fs: the
 * agent record's validation (agent-tools.ts) and the renderer-facing lists
 * read this without pulling in cli-agents.ts's open lane.
 */

export type CliId = "claude" | "codex" | "gemini" | "copilot" | "cursor" | "glyphh";

/** THE GLYPHH CLI IS NAMED FOR WHAT IT IS (his order, 2026-09-30: "glyphh cli
 *  (we need to rename the icon on the echo panel to this)"). */
export const CLI_NAMES: Record<CliId, string> = {
  claude: "Claude", codex: "Codex", gemini: "Gemini", copilot: "Copilot", cursor: "Cursor", glyphh: "Glyphh CLI",
};
export const CLI_BIN: Record<CliId, string> = {
  claude: "claude", codex: "codex", gemini: "gemini", copilot: "copilot", cursor: "cursor-agent", glyphh: "glyphh",
};
export const CLI_IDS = Object.keys(CLI_NAMES) as CliId[];

export const isCliId = (v: string): v is CliId => (CLI_IDS as string[]).includes(v);

/** The CLIs with a print mode — a prompt in, text out, no terminal: claude -p,
 *  codex exec, gemini -p. Copilot, Cursor and the Glyphh CLI show none in
 *  their row table, so an agent can only run them in a terminal card. */
export const HEADLESS_CLIS: ReadonlySet<CliId> = new Set<CliId>(["claude", "codex", "gemini"]);

/** The ids an AGENT RECORD may name as its CLI (his order, 2026-10-07): every
 *  CLI but the Glyphh CLI — a "glyphh" agent is the loop itself, not a shell-out. */
export const AGENT_CLI_IDS: readonly CliId[] = CLI_IDS.filter((id) => id !== "glyphh");
