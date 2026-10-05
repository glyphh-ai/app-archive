/**
 * house-relay.ts — THE HOUSE APPS ON THE WEB, as pure rules (his order,
 * 2026-10-05: "selecting Apps → Design should open the web panel in the web
 * but pull through the relay. That should absolutely work.").
 *
 * The house apps — Design, Slides, Images, Video, Audio, Drive — are
 * tool-backed rows on the desktop (their tab's launchConfig.tool names a
 * built-in work panel: gdesign / gpoint / gimage / gvideo / gsound / gdrive),
 * and the web renderer already has those panels. So on the web a house row
 * opens the web's OWN panel (code-workbench.ts __wbOpenTool), and that
 * panel's DATA comes off the attached desktop over the relay — the member's
 * designs, decks, images, video, audio and Drive live in the desktop's
 * app-data (media-local.ts, office-store.ts), never on the server.
 *
 * The one door is `app.call { app, tool, args }` (main/house-doors.ts on the
 * desktop, attach.py's REMOTE_METHODS + HOUSE_APPS on the server): READ-ONLY,
 * house apps only. A write on the web answers the one honest line; no desktop
 * attached, the panel shows the connect line, never an error box.
 *
 * Pure: web/src/house-relay-web.js (the shims) and help/agent-menu.ts (the
 * row rule) read these; test/main/house-relay.test.ts pins them.
 */

/** A house app's slug on the desktop → the work panel view that shows it. */
export const HOUSE_VIEW_OF_APP: Readonly<Record<string, string>> = Object.freeze({
  design: "gdesign", slides: "gpoint", images: "gimage", video: "gvideo", audio: "gsound", drive: "gdrive",
});

/** The house views — the panels the web hosts itself and fills over the relay. */
export const HOUSE_TOOL_VIEWS: ReadonlyArray<string> = Object.freeze(Object.values(HOUSE_VIEW_OF_APP));

/** The house app slugs — the ONLY apps `app.call` reaches (the server fences the same set). */
export const HOUSE_APPS: ReadonlyArray<string> = Object.freeze(Object.keys(HOUSE_VIEW_OF_APP));

/** The house view a tab's launchConfig.tool names, or null for anything else. */
export function houseViewOf(tool: unknown): string | null {
  return typeof tool === "string" && HOUSE_TOOL_VIEWS.includes(tool) ? tool : null;
}

/** What a view shows, for its lines: "designs", "decks", … */
const THINGS: Readonly<Record<string, string>> = Object.freeze({
  gdesign: "designs", gpoint: "decks", gimage: "images", gvideo: "videos", gsound: "audio", gdrive: "Drive",
});

/** The honest empty state with no desktop attached (his order, 2026-10-05). */
export function connectDesktopLine(view: string): string {
  return `Connect your desktop to see your ${THINGS[view] ?? "files"}`;
}

/** The one line a write answers on the web: the apps' files are the desktop's. */
export const HOUSE_READ_ONLY_LINE = "Make changes on your desktop — the web reads your apps' files from it";

/** A relay answer that is too big to carry (main/house-doors.ts caps media bytes). */
export const HOUSE_TOO_LARGE_LINE = "Too large to show on the web — open it on your desktop";

/** The flag the web shims set on a not-attached answer; a panel paints the
 *  line bare instead of "Couldn't load the library." */
export interface HouseAnswer { ok: boolean; error?: string; notAttached?: boolean }
export function isNotAttached(res: HouseAnswer | null | undefined): res is HouseAnswer & { notAttached: true; error: string } {
  return !!res && !res.ok && res.notAttached === true && typeof res.error === "string";
}

/** A panel's empty-state text for a failed load: the connect line bare when no
 *  desktop is attached, else the panel's own "Couldn't load" wording. */
export function houseEmptyText(res: HouseAnswer | null | undefined, couldNot: string): string {
  if (isNotAttached(res)) return res.error;
  return `${couldNot} ${res?.error ?? "Unknown error."}`;
}
