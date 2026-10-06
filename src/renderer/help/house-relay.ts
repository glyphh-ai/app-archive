/**
 * house-relay.ts — THE HOUSE APPS ON THE WEB, as pure rules.
 *
 * The house apps — Design, Slides, Images, Video, Audio, Drive — are
 * tool-backed rows on the desktop (their tab's launchConfig.tool names a
 * built-in work panel: gdesign / gpoint / gimage / gvideo / gsound / gdrive),
 * and the web renderer has those panels too. So on either surface a house
 * row opens the surface's OWN panel (code-workbench.ts __wbOpenTool), and the
 * panel reads ONE store: the member library (shared/house-store.ts; his
 * order, 2026-10-06: cloud is the one home, every surface pulls from it).
 *
 * Pure: help/agent-menu.ts (the row rule) and the web's shims read these;
 * test/main/house-relay.test.ts pins them.
 */

/** A house app's slug on the desktop → the work panel view that shows it. */
export const HOUSE_VIEW_OF_APP: Readonly<Record<string, string>> = Object.freeze({
  design: "gdesign", slides: "gpoint", images: "gimage", video: "gvideo", audio: "gsound", drive: "gdrive",
});

/** The house views — the panels both surfaces host themselves. */
export const HOUSE_TOOL_VIEWS: ReadonlyArray<string> = Object.freeze(Object.values(HOUSE_VIEW_OF_APP));

/** The house app slugs. */
export const HOUSE_APPS: ReadonlyArray<string> = Object.freeze(Object.keys(HOUSE_VIEW_OF_APP));

/** The house view a tab's launchConfig.tool names, or null for anything else. */
export function houseViewOf(tool: unknown): string | null {
  return typeof tool === "string" && HOUSE_TOOL_VIEWS.includes(tool) ? tool : null;
}
