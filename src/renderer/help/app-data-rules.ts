/**
 * app-data-rules.ts — WHERE AN APP'S DATA LIVES, as pure rules (his verdict,
 * 2026-10-05: "an app is a row in the db"; the user NEVER picks where an
 * app's data lives — the app's AUTHOR declares it in the manifest:
 *
 *   data: "cloud"     (default) the app and its store are a cloud instance;
 *                     installs from the web and the desktop alike
 *   data: "local"     the data never leaves the machine: the desktop's local
 *                     host installs it; the web installs it ONLY through a
 *                     connected desktop; the marketplace wears it as a badge
 *   data: "per-home"  a store per home, each scoped to its home's documents:
 *                     the cloud instance AND the local host on a connected
 *                     desktop; on the web with no desktop, the cloud alone
 *
 * "Local is local, cloud is cloud." Nothing here touches the DOM —
 * settings-skills.ts (the hub cards, the Install button, the Apps page's
 * marks), code-workbench.ts (the web's panel for a local app) and the web
 * shims (member-library-web.js, app-instances-web.js) paint what these
 * decide; test/main/app-data-rules.test.ts runs them bare.
 */

export type AppData = "cloud" | "local" | "per-home";

/** The field as a manifest, a hub row or a tab's launchConfig carries it;
 *  anything unknown is the default. Read defensively: the SDK's parsed
 *  manifest types it as `unknown`, the server's rows may lag. */
export function appDataOf(src: { data?: unknown; manifest?: { data?: unknown } | null; launchConfig?: { data?: unknown } | null } | null | undefined): AppData {
  const v = src?.data ?? src?.manifest?.data ?? src?.launchConfig?.data;
  return v === "local" || v === "per-home" ? v : "cloud";
}

/** Does the app keep a store on the machine? (local and per-home do.) */
export const keepsLocalData = (data: AppData): boolean => data === "local" || data === "per-home";

// ── THE BADGE (marketplace cards and the detail page) ─────────────────────

export const LOCAL_DATA_BADGE = "Local data";
export const LOCAL_AND_CLOUD_BADGE = "Local + cloud";

/** The small chip a hub app wears: a badge of honor for local data, the
 *  pair for per-home, nothing for the default. */
export function appDataBadge(data: AppData): { label: string; title: string } | null {
  if (data === "local") return { label: LOCAL_DATA_BADGE, title: "This app's data never leaves your machine. It installs on your desktop." };
  if (data === "per-home") return { label: LOCAL_AND_CLOUD_BADGE, title: "A store per home: in the cloud, and on your desktop for its own documents." };
  return null;
}

// ── INSTALL, ROUTED BY DATA — the user never asked ────────────────────────

export type Surface = "web" | "desktop";

/** The one line under a disabled Install on the web for a local-data app. */
export const LOCAL_NEEDS_DESKTOP_LINE = "Local data — installs on your desktop; connect it to install from here";

export interface InstallRoute {
  /** `POST /api/app-instances/from-hub` — the cloud instance. */
  cloud: boolean;
  /** The local host: on this machine (`host`), on the connected desktop over
   *  the relay (`relay`), or not at all. */
  local: "host" | "relay" | null;
  /** Nothing to do from here: the button is disabled with this line. */
  disabled?: string;
}

/** Where an install goes, from the manifest's `data` and where the ask is made. */
export function installRoute(data: AppData, surface: Surface, desktopAttached: boolean): InstallRoute {
  if (data === "cloud") return { cloud: true, local: null };
  if (surface === "desktop") return { cloud: data === "per-home", local: "host" };
  if (data === "local") return desktopAttached ? { cloud: false, local: "relay" } : { cloud: false, local: null, disabled: LOCAL_NEEDS_DESKTOP_LINE };
  // per-home on the web: the cloud, plus the desktop when one is connected — never an error.
  return { cloud: true, local: desktopAttached ? "relay" : null };
}

/** The Install button's face for a hub app: label, enabled, title. */
export function installButton(route: InstallRoute, installed: boolean, wide: boolean): { label: string; disabled: boolean; title: string } {
  if (installed) return { label: wide ? "Added" : "✓", disabled: true, title: "Already in your apps" };
  if (route.disabled) return { label: wide ? "Installs on your desktop" : "Desktop", disabled: true, title: route.disabled };
  const where = route.local === "relay" ? (route.cloud ? "in the cloud and on your desktop" : "on your desktop") : route.local === "host" ? (route.cloud ? "here and in the cloud" : "on this machine") : "in the cloud";
  return { label: wide ? "Add" : "+", disabled: false, title: `Install ${where}` };
}

// ── OPENING A LOCAL APP FROM THE WEB ──────────────────────────────────────

export const LOCAL_APP_RUNS_ON_DESKTOP = "Runs on your Mac — open Glyphh Desktop";
export const LOCAL_APP_DESKTOP_OFFLINE = "your Mac is offline";

/** The honest line a local app's row or panel says on the web: it runs on
 *  the desktop; with the desktop gone, that it is offline. */
export function localAppWebLine(desktopAttached: boolean): string {
  return desktopAttached ? LOCAL_APP_RUNS_ON_DESKTOP : LOCAL_APP_DESKTOP_OFFLINE;
}

/** A preview-open answer for a local app on the web (the web shim sets it). */
export interface LocalAppAnswer { ok: false; localApp: true; error: string }
export const isLocalAppAnswer = (res: { ok?: boolean; localApp?: boolean } | null | undefined): res is LocalAppAnswer => !!res && res.ok === false && res.localApp === true;

// ── THE APPS PAGE ─────────────────────────────────────────────────────────

/** Where an installed app's data sits, for the row's mark: the sessions'
 *  locus glyphs (a cloud, a monitor). A per-home app is both; its mark is the
 *  desktop's where a local store exists, else the cloud's. */
export type AppLocus = "cloud" | "local";
export function appLocusOf(row: { id?: string; data?: unknown; locus?: unknown; instance?: unknown }): AppLocus {
  if (row.locus === "cloud" || row.locus === "local") return row.locus;
  if (typeof row.id === "string" && row.id.startsWith("app-instance:")) return "cloud";
  return keepsLocalData(appDataOf(row)) ? "local" : "cloud";
}

export const APP_LOCUS_TITLE: Record<AppLocus, string> = { cloud: "Data in the cloud", local: "Data on this desktop" };

/** "Move to the cloud" is for an app from BEFORE the cloud: never for one
 *  whose author said its data is local, never for an instance card. */
export function offersMoveToCloud(row: { id: string; type?: string; data?: unknown }): boolean {
  if (row.type !== "app") return false;
  if (row.id.startsWith("app-instance:")) return false;
  return !keepsLocalData(appDataOf(row));
}
