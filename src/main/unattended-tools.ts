/**
 * unattended-tools.ts — WHAT A RUN WITH NOBODY WATCHING MAY NOT TOUCH (his
 * report, 2026-10-08: "the terminal window keeps randomly showing up" — a
 * scheduled skill ran the loop with the same toolset a live chat has, and the
 * model opened a terminal whenever the skill text suggested one).
 *
 * An unattended run — a schedule, a power running on its own, a build —
 * gets no tool that opens, moves or drives anything on the member's screen:
 * no panels, no workspaces, no Settings, no RPA (a mapped command opens its
 * tab's panel to run; the picker needs a hand on the mouse). Everything
 * else stays. Pure: host-tools.ts hostTools({ unattended: true }) leaves
 * these out for the loop's unattended copy.
 */

export const UNATTENDED_HIDDEN: ReadonlySet<string> = new Set([
  "panels_open", "panels_switch", "panels_close", "layouts_open", "settings_open",
  "rpa_click", "rpa_type", "rpa_read", "rpa_screenshot", "rpa_goto",
  "rpa_commands", "rpa_pick", "rpa_map", "rpa_unmap", "rpa_run", "rpa_sequence_save", "rpa_sequence_remove", "rpa_sequence_run",
]);

/** A catalog family the loop built from a tab's RPA mapping (glyphh-loop.ts). */
export const isScreenFamily = (family: string): boolean => family.startsWith("rpa: ");
