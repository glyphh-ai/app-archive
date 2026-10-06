/**
 * Apps section — apps list + all tabs (dashboard, panel, connection, mcp).
 */

import {
  paginate, renderPaginationBar, confirmAction, promptAction, clearInvalid, escapeHtml,
  formatBytes, relativeTime, buildPaginationBar, cssVar, closeHelp,
} from "./shared.js";
import { hostHas } from "./web-surface.js";
import { appIconInner, primeConnectedIcons, primeNativeIcons } from "./app-icon.js";
import { toolViewIcon } from "./layouts.js";
import { gotoSection, closeSettingsModal } from "./navigation.js";
import { openAppInWorkbench, openWorkPanelInWorkbench } from "./code.js";

/** HTML-escape (inlined from the dead marketplace-data module). */
function escMkt(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
import { formatMarkdown } from "../format-markdown.js";

// ── Apps (unified: apps + MCP + connections) ────────────

let appsPage = 0;
let tabsKind: "" | "web" | "app" = "";
const appsList = document.getElementById("apps-list")!;
const appDetail = document.getElementById("app-detail")!;
const appAddForm = document.getElementById("app-add-form")!;
const appDetailId = document.getElementById("app-detail-id") as HTMLInputElement;
const appDetailName = document.getElementById("app-detail-name") as HTMLInputElement;
const appDetailUrl = document.getElementById("app-detail-url") as HTMLInputElement;
const appSearchInput = document.getElementById("app-search") as HTMLInputElement;
const appPreview = document.getElementById("app-preview") as HTMLElement & {
  src: string;
  partition: string;
  getWebContentsId: () => number;
  reload: () => void;
};
const appsToolbar = document.getElementById("apps-toolbar")!;
type MountAddTabForm = (host: HTMLElement, cb: { onSaved: () => void; onCancel: () => void }) => void;
let standalone: { home: { parent: HTMLElement; next: Node | null }; onSaved: () => void; onCancel: () => void } | null = null;
/** The form back where the Tabs page keeps it, hidden; no-op when it is home. */
function returnAddForm(): void {
  if (!standalone) return;
  const { home } = standalone;
  home.parent.insertBefore(appAddForm, home.next);
  appAddForm.classList.add("hidden");
  standalone = null;
}
const appsHead = document.getElementById("tabs-head");
const appFormError = document.getElementById("app-form-error")!;
const appDetailHeading = document.getElementById("app-detail-heading")!;

// WEB surface (browser tab): there is no privileged <webview>, so the editor's
// preview pane renders as a sandboxed <iframe> instead — see renderWebPreview.
// Same branch flag the rest of the renderer uses (set by web/src/bridge.js).
const IS_WEB = !!(window as unknown as { __GLYPHH_WEB__?: boolean }).__GLYPHH_WEB__;

let currentAppId = "";
let currentApp: PanelApp | null = null;

// Reasonable default guardrails, prefilled in the per-app Guardrails tab (and
// mirrored in the org Security panels) so a new app is never shipped unbounded.
// All sit under the server GUARDRAIL_FLOOR, so they only ever tighten.
const DEFAULT_GUARDRAILS: Record<string, number> = {
  maxInputTokens: 16000,
  maxOutputTokens: 4000,
  windowSeconds: 60,
  windowTokens: 200000,
  windowCalls: 100,
  maxConcurrent: 4,
};

// ── Browser ↔ Native helpers (pivot-mcp) ─────────────────
// Apps are either web apps (isBrowser, url + launchConfig browser/openAs) or native desktop
// apps (execPath + an archetype-specific launchConfig). These build/read the
// launchConfig from the flat DOM fields, shared by the add + detail forms.
type Archetype = "terminal" | "editor" | "generic";

// Local mirror of preload.ts PanelAppInput — apps.ts is a standalone renderer
// module and can't name the type declared in renderer.ts's `declare global`,
// so it re-declares a structurally-identical alias for building patch bodies.
type PanelAppInput = {
  name?: string;
  slug?: string;
  url?: string | null;
  isBrowser?: boolean;
  execPath?: string | null;
  appArchetype?: string | null;
  launchConfig?: Record<string, unknown> | null;
};

function readLaunchConfig(prefix: string, archetype: Archetype): Record<string, unknown> {
  const val = (id: string) => (document.getElementById(`${prefix}-${id}`) as HTMLInputElement | HTMLTextAreaElement | null)?.value.trim() || "";
  if (archetype === "terminal") {
    const lc: Record<string, unknown> = {};
    lc.windowMode = val("window-mode") || "window";
    if (val("shell")) lc.shell = val("shell");
    if (val("profile")) lc.profile = val("profile");
    if (val("cwd")) lc.cwd = val("cwd");
    const cmds = val("init-commands").split("\n").map((s) => s.trim()).filter(Boolean);
    if (cmds.length) lc.initCommands = cmds;
    return lc;
  }
  if (archetype === "editor") {
    const lc: Record<string, unknown> = {};
    if (val("folder")) lc.folder = val("folder");
    return lc;
  }
  const lc: Record<string, unknown> = {};
  const args = val("args") ? val("args").split(/\s+/) : [];
  if (args.length) lc.args = args;
  return lc;
}

function writeLaunchConfig(prefix: string, archetype: Archetype, lc: Record<string, unknown> | null | undefined): void {
  const set = (id: string, v: string) => { const el = document.getElementById(`${prefix}-${id}`) as HTMLInputElement | HTMLTextAreaElement | null; if (el) el.value = v; };
  const c = lc || {};
  set("window-mode", c.windowMode === "tab" ? "tab" : c.windowMode === "blank" ? "blank" : "window");
  set("shell", typeof c.shell === "string" ? c.shell : "");
  set("profile", typeof c.profile === "string" ? c.profile : "");
  set("cwd", typeof c.cwd === "string" ? c.cwd : "");
  set("init-commands", Array.isArray(c.initCommands) ? (c.initCommands as string[]).join("\n") : "");
  set("folder", typeof c.folder === "string" ? c.folder : "");
  set("args", Array.isArray(c.args) ? (c.args as string[]).join(" ") : "");
}

// Show only the archetype-specific field block that matches the selection.
function toggleArchetypeFields(prefix: string, archetype: Archetype): void {
  document.getElementById(`${prefix}-terminal-fields`)?.classList.toggle("hidden", archetype !== "terminal");
  document.getElementById(`${prefix}-editor-fields`)?.classList.toggle("hidden", archetype !== "editor");
  document.getElementById(`${prefix}-generic-fields`)?.classList.toggle("hidden", archetype !== "generic");
}

// Show the browser-vs-native field blocks for a given form prefix. A glyphh app
// is BUILT, not configured here, so it is not one of the choices.
type AppType = "browser" | "native";

function toggleTypeFields(prefix: string, type: AppType): void {
  document.getElementById(`${prefix}-browser-fields`)?.classList.toggle("hidden", type !== "browser");
  document.getElementById(`${prefix}-native-fields`)?.classList.toggle("hidden", type !== "native");
}

// ── Installed Glyphh apps: tool approval + guardrails ───────────────────────

/** The tools an installed Glyphh app declares in its bundle manifest. */
function appExposableTools(app: { appArchetype?: string | null; launchConfig?: Record<string, unknown> | null }): Array<{ name: string; description: string }> {
  const lc = (app.launchConfig || {}) as Record<string, unknown>;
  const declared = Array.isArray(lc.tools) ? (lc.tools as Array<{ name?: string; description?: string }>) : [];
  return declared.filter((t) => t?.name).map((t) => ({ name: String(t.name), description: String(t.description || "") }));
}

/** True when an app has an MCP surface worth showing the MCP/Guardrails tabs. */
function appExposesMcp(app: { appArchetype?: string | null; launchConfig?: Record<string, unknown> | null }): boolean {
  return appExposableTools(app).length > 0;
}

/** Show/hide + populate the MCP and Guardrails tabs for the open app. */
function syncMcpTabs(app: PanelApp): void {
  const exposes = appExposesMcp(app);
  document.querySelectorAll<HTMLElement>(".tab-mcp-only").forEach((el) => el.classList.toggle("hidden", !exposes));
  if (!exposes) return;

  const lc = (app.launchConfig || {}) as Record<string, unknown>;

  // Public endpoint URL.
  const ep = document.getElementById("app-mcp-endpoint");
  if (ep) ep.textContent = `https://${app.slug}.glyphh.app/mcp`;

  // Approved-tools list — allowlist, so anything NOT in mcpApproved is off,
  // including newly-appeared tools (safe default).
  const approved = new Set(Array.isArray(lc.mcpApproved) ? (lc.mcpApproved as string[]) : []);
  const tools = appExposableTools(app);
  const list = document.getElementById("app-mcp-tools");
  if (!list) return;
  const empty = document.getElementById("app-mcp-tools-empty");
  empty?.classList.toggle("hidden", tools.length > 0);
  list.innerHTML = "";
  for (const t of tools) {
    const row = document.createElement("label");
    row.className = "mcp-tool-row";
    row.innerHTML = `
      <input type="checkbox" class="mcp-tool-check" data-tool="${escMkt(t.name)}" ${approved.has(t.name) ? "checked" : ""} />
      <div class="mcp-tool-info">
        <span class="mcp-tool-name">${escMkt(t.name)}</span>
        <span class="mcp-tool-desc">${escMkt(t.description)}</span>
      </div>`;
    list.appendChild(row);
  }

  // Test-a-tool picker — runs the tool through the local runtime.
  document.getElementById("app-mcp-test-section")?.classList.toggle("hidden", tools.length === 0);
  const testSel = document.getElementById("app-mcp-test-tool") as HTMLSelectElement | null;
  if (testSel) testSel.innerHTML = tools.map((t) => `<option value="${escMkt(t.name)}">${escMkt(t.name)}</option>`).join("");

  // "Select all" reflects the current approvals (hidden when there are no tools).
  document.getElementById("app-mcp-select-all-wrap")?.classList.toggle("hidden", tools.length === 0);
  updateMcpSelectAll();

  // Guardrails fields.
  const g = (lc.guardrails || {}) as Record<string, unknown>;
  const setNum = (id: string, v: unknown) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = v == null ? "" : String(v);
  };
  setNum("app-gr-max-input", g.maxInputTokens ?? DEFAULT_GUARDRAILS.maxInputTokens);
  setNum("app-gr-max-output", g.maxOutputTokens ?? DEFAULT_GUARDRAILS.maxOutputTokens);
  setNum("app-gr-window", g.windowSeconds ?? DEFAULT_GUARDRAILS.windowSeconds);
  setNum("app-gr-window-tokens", g.windowTokens ?? DEFAULT_GUARDRAILS.windowTokens);
  setNum("app-gr-window-calls", g.windowCalls ?? DEFAULT_GUARDRAILS.windowCalls);
  setNum("app-gr-concurrent", g.maxConcurrent ?? DEFAULT_GUARDRAILS.maxConcurrent);
}

/** Read the MCP-approval + guardrails fields back into a launchConfig patch. */
function readMcpConfig(): { mcpApproved: string[]; guardrails: Record<string, number> } {
  const mcpApproved = Array.from(document.querySelectorAll<HTMLInputElement>(".mcp-tool-check"))
    .filter((c) => c.checked).map((c) => c.dataset.tool!).filter(Boolean);
  const num = (id: string): number | undefined => {
    const v = (document.getElementById(id) as HTMLInputElement | null)?.value.trim();
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const guardrails: Record<string, number> = {};
  const put = (k: string, v: number | undefined) => { if (v !== undefined) guardrails[k] = v; };
  put("maxInputTokens", num("app-gr-max-input"));
  put("maxOutputTokens", num("app-gr-max-output"));
  put("windowSeconds", num("app-gr-window"));
  put("windowTokens", num("app-gr-window-tokens"));
  put("windowCalls", num("app-gr-window-calls"));
  put("maxConcurrent", num("app-gr-concurrent"));
  return { mcpApproved, guardrails };
}

/** Sync the MCP "Select all" checkbox to the tool checkboxes — checked when all
 *  are on, indeterminate when only some are. */
function updateMcpSelectAll(): void {
  const sa = document.getElementById("app-mcp-select-all") as HTMLInputElement | null;
  if (!sa) return;
  const all = Array.from(document.querySelectorAll<HTMLInputElement>(".mcp-tool-check"));
  const checked = all.filter((c) => c.checked).length;
  sa.checked = all.length > 0 && checked === all.length;
  sa.indeterminate = checked > 0 && checked < all.length;
}

/** Persist just the MCP-approval + Guardrails fields (from either tab), merged
 *  into the app's launchConfig — a per-tab Save that doesn't close the detail. */
async function saveMcpGuardrails(statusId: string): Promise<void> {
  if (!currentAppId) return;
  const { mcpApproved, guardrails } = readMcpConfig();
  const base = (currentApp?.launchConfig || {}) as Record<string, unknown>;
  const launchConfig = { ...base, mcpApproved, guardrails };
  const statusEl = document.getElementById(statusId);
  if (statusEl) statusEl.textContent = "Saving…";
  const res = await window.glyphh.panelAppsUpdate?.(currentAppId, { launchConfig });
  if (res?.ok && currentApp) currentApp.launchConfig = launchConfig;
  if (statusEl) {
    statusEl.textContent = res?.ok ? "Saved ✓" : (res?.error || "Save failed");
    setTimeout(() => { if (statusEl.textContent === "Saved ✓") statusEl.textContent = ""; }, 2500);
  }
}

/** Invoke one of the app's exposed tools through the local runtime and show the
 *  result — a smoke test before external agents rely on it (installed apps). */
async function testMcpTool(): Promise<void> {
  const sel = document.getElementById("app-mcp-test-tool") as HTMLSelectElement | null;
  const argsEl = document.getElementById("app-mcp-test-args") as HTMLTextAreaElement | null;
  const out = document.getElementById("app-mcp-test-result");
  const tool = sel?.value;
  if (!currentApp || !tool || !out) return;
  let args: unknown = {};
  const raw = (argsEl?.value || "").trim();
  if (raw) {
    try { args = JSON.parse(raw); }
    catch { out.classList.remove("hidden"); out.textContent = "Args must be valid JSON."; return; }
  }
  out.classList.remove("hidden");
  out.textContent = "Running…";
  const res = await window.glyphh.appCallTool?.(currentApp.slug, tool, args);
  out.textContent = res?.ok
    ? (typeof res.result === "string" ? res.result : JSON.stringify(res.result, null, 2))
    : `Error: ${res?.error || "failed"}`;
}

// Dashboard shell (5a): apps are server objects (yo-server's saved_apps),
// not local ones — `id` is the server row's UUID (used for every write:
// update/delete/connection/mcp/commands); `slug` is the human-readable
// identifier shown/edited in the UI (was previously `id` in the local model).
interface PanelApp {
  id: string;
  slug: string;
  name: string;
  system?: boolean;
  url?: string | null;
  // Browser ↔ Native model (pivot-mcp).
  isBrowser?: boolean;
  execPath?: string | null;
  appArchetype?: string | null;
  launchConfig?: Record<string, unknown> | null;
  /** Who may reach it once deployed — shown + set on the Public hosting tab. */
  access?: string;
  /** True when this org published the app — an installed app hides publish tabs. */
  owned?: boolean;
  /** Newest live release version, or null — drives the auto-update banner. */
  latestVersion?: string | null;
  /** The app's steered NEXT version — what the next build releases. */
  version?: string;
  /** Connections the manifest requires, with connected status. */
  requiredConnections?: { slug: string; actAs: string; connected: boolean }[];
  /** The listing's uploaded icon — the ONE icon source (same as the command
   *  center): a hosted app's launch URL has no favicon to derive one from. */
  iconUrl?: string | null;
  /** The built-in panel this app IS, as its mark (see app-icon's IconApp). */
  mark?: string | null;
  /** The marketplace listing — copy, images, rating, listed state. */
  listing?: {
    title: string; tagline: string | null; category: string | null; body: string | null;
    iconUrl: string | null; screenshots: { url: string; caption: string }[];
    videoUrl: string | null; website: string | null; supportEmail: string | null;
    ratingAvg: number; ratingCount: number; listedAt: string | null;
  };
  commands?: Record<string, { selector: string; action: string; description?: string; text?: string }>;
  connectionIds?: string[];
  mcp?: { transport: "stdio" | "sse" | "streamable-http"; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; oauth?: { clientId: string; hasSecret: boolean; tokenUrl: string; scope?: string }; enabled: boolean } | null;
}

/** A tool-backed app (Design, Slides, Drive, the media panels) IS that panel,
 *  so the panel's own mark stands in when the bundle ships no icon. */
function markFor(launchConfig: Record<string, unknown> | null | undefined): string | null {
  const tool = (launchConfig as { tool?: unknown } | null | undefined)?.tool;
  return typeof tool === "string" && tool ? toolViewIcon(tool) || null : null;
}

function toPanelApp(a: {
  id: string; slug: string; name: string; system?: boolean; url: string | null;
  isBrowser?: boolean; execPath?: string | null;
  appArchetype?: string | null; launchConfig?: Record<string, unknown> | null;
  access?: string; iconUrl?: string | null; listing?: PanelApp["listing"];
  owned?: boolean; latestVersion?: string | null; version?: string;
  requiredConnections?: { slug: string; actAs: string; connected: boolean }[];
  commands: Record<string, { selector: string; action: string; description?: string; text?: string }>;
  connectionIds: string[];
  mcp: { transport: "stdio" | "sse" | "streamable-http"; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; oauth?: { clientId: string; hasSecret: boolean; tokenUrl: string; scope?: string }; enabled: boolean } | null;
}): PanelApp {
  return {
    id: a.id, slug: a.slug, name: a.name, system: a.system, url: a.url,
    isBrowser: a.isBrowser, execPath: a.execPath,
    appArchetype: a.appArchetype, launchConfig: a.launchConfig, access: a.access,
    iconUrl: a.iconUrl ?? a.listing?.iconUrl ?? null, listing: a.listing,
    mark: markFor(a.launchConfig),
    owned: a.owned, latestVersion: a.latestVersion, version: a.version, requiredConnections: a.requiredConnections,
    commands: a.commands, connectionIds: a.connectionIds, mcp: a.mcp,
  };
}

let panelApps: PanelApp[] = [];

/** Open an app the way its config dictates (Browser↔Native model): native apps
 *  launch their executable, browser apps open in native Chrome or Glyphh's
 *  the configured real browser (window or tab). Returns the launch result so callers can
 *  surface an error. */
async function launchPanelApp(app: PanelApp): Promise<{ ok: boolean; error?: string }> {
  return (await window.glyphh.appLaunch?.({
    slug: app.slug, name: app.name, url: app.url,
    isBrowser: app.isBrowser,
    execPath: app.execPath, appArchetype: app.appArchetype, launchConfig: app.launchConfig,
  })) ?? { ok: false, error: "Launching apps isn't available on this surface." };
}

async function loadApps() {
  appDetail.classList.add("hidden");
  appAddForm.classList.add("hidden");

  document.getElementById("apps-pro-gate")?.classList.add("hidden");
  appsList.classList.remove("hidden");
  appsToolbar.classList.remove("hidden"); appsHead?.classList.remove("hidden");

  try {
    const apps = (await window.glyphh.panelAppsList?.()) || [];
    // Keep browser apps (have a url) and native apps (isBrowser === false).
    // Legacy rows have neither field set but always carry a url, so the url
    // check still covers them.
    // Hide seeded system apps (Glyphh) — they aren't user-managed. Builtin
    // WORKPANELS never reach this list (kind 'workpanel': no url, isBrowser
    // true — the first filter drops them). A USER-BUILT workbench app
    // (config.workbench === true on a glyphh app) is the user's own work and
    // BELONGS here (his rule, 2026-08-19: the Apps page is what you built) —
    // the old truthy workbench filter hid those too, leaving customs with no
    // edit/delete surface at all.
    panelApps = apps
      .filter((a) => !a.system && (a.url || a.isBrowser === false))
      .map(toPanelApp);
  } catch { panelApps = []; }
  // The rail's Apps grid mirrors this list — tell it to refresh.
  document.dispatchEvent(new CustomEvent("glyphh:apps-changed"));

  document.getElementById("apps-limit-msg")?.classList.add("hidden");

  renderAppsList();
  // Async — re-renders once OS file icons (native apps) land. Apps no longer
  // carry a Pipedream connection (Connections are their own tab now), so their
  // icon comes from the url favicon or the executable icon.
  void primeNativeIcons(panelApps, renderAppsList);
  // Org admins: the co-working approval queue above the grid (empty → hidden).
}

function renderAppsList() {
  const query = appSearchInput.value.trim().toLowerCase();

  const kindOf = (a: PanelApp): "web" | "app" | "native" => a.appArchetype === "glyphh-app" ? "app" : a.url ? "web" : "native";
  const filtered = panelApps
    .filter((a) => !query || a.name.toLowerCase().includes(query) || (a.url || "").toLowerCase().includes(query) || a.slug.toLowerCase().includes(query))
    .filter((a) => !tabsKind || kindOf(a) === tabsKind);
  const count = document.getElementById("tabs-count");
  if (count) count.textContent = `${panelApps.length} tab${panelApps.length === 1 ? "" : "s"}`;

  // The Connections grammar (his order, 2026-09-16): chips, then one table.
  const grid = document.getElementById("apps-grid")!;
  grid.textContent = "";
  appsList.querySelectorAll(".pagination-bar, .crud-empty").forEach((el) => el.remove());
  const chips = document.createElement("div");
  chips.className = "conn2-chips";
  for (const [id, label] of [["", "All"], ["web", "Web"], ["app", "Apps"]] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "conn2-chip" + (tabsKind === id ? " active" : "");
    b.textContent = label;
    b.addEventListener("click", () => { tabsKind = id; renderAppsList(); });
    chips.appendChild(b);
  }
  grid.appendChild(chips);

  if (!filtered.length) {
    grid.insertAdjacentHTML("beforeend", `<div class="crud-empty">${query ? `No tabs matching "${escapeHtml(query)}"` : "No tabs yet — <b>+ Add</b> opens a web page or an installed app beside your agent."}</div>`);
    return;
  }
  const table = document.createElement("div");
  table.className = "conn2-table";
  table.innerHTML = `<div class="conn2-tr head"><span class="conn2-head-connector">Tab</span><span>Type</span><span class="conn2-head-status">Status</span></div>`;
  const TYPE: Record<string, string> = { web: "Web", app: "App", native: "Native" };
  for (const app of filtered) {
    const tr = document.createElement("div");
    tr.className = "conn2-tr openable";
    tr.innerHTML = `<span class="conn2-icon">${appIconInner(app, app.name, "conn2-icon-initial")}</span><span class="conn2-name"></span><span class="conn2-type"><span></span></span><span class="conn2-status"></span>`;
    (tr.querySelector(".conn2-name") as HTMLElement).textContent = app.name;
    (tr.querySelector(".conn2-type > span") as HTMLElement).textContent = TYPE[kindOf(app)];
    const open = document.createElement("button");
    open.type = "button";
    open.className = "action-btn conn2-connect";
    open.textContent = "Open";
    open.addEventListener("click", (ev) => { ev.stopPropagation(); void launchPanelApp(app); });
    (tr.querySelector(".conn2-status") as HTMLElement).appendChild(open);
    tr.addEventListener("click", () => openPanelAppDetail(app));
    table.appendChild(tr);
  }
  grid.appendChild(table);
}

// ── Work panels (built-in) ───────────────────────────────

// ── Tab switching ────────────────────────────────────────

function switchAppTab(tab: string) {
  document.querySelectorAll<HTMLButtonElement>(".app-detail-tab[data-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  document.querySelectorAll<HTMLElement>(".app-tab-left").forEach(el => {
    el.classList.toggle("active", el.dataset.tab === tab);
  });
  document.querySelectorAll<HTMLElement>(".app-tab-right").forEach(el => {
    el.classList.toggle("active", el.dataset.tab === tab);
  });
  if (tab === "dashboard") void loadPanelTab();
}

// ── Marketplace tab — the listing an installer sees ──────────────
//
// The agent can write every field here (set_app_listing / upload_app_image over
// MCP). What it deliberately cannot do is press List: publishing to other orgs is
// the irreversible half, so it stays a human click on this tab.

/** Delete is refused server-side while a live deployment exists — it would orphan
 *  the running Fly machine. So gate the Delete button on deploy state: clearly
 *  INACTIVE (with a why) until the app is taken down, instead of failing on click. */
async function gateAppDelete(slug: string): Promise<void> {
  // THE PURGE: hosting is gone — nothing blocks a delete any more.
  void slug;
  const btn = document.getElementById("app-detail-delete") as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = false;
  btn.title = "";
  btn.classList.remove("delete-blocked");
}

// ── Panel tab ────────────────────────────────────────────

// ── WEB preview (browser tab) ────────────────────────────
// Desktop previews through a privileged <webview>; a browser has none, so the
// web surface previews an app the way its other web panels work — an <iframe>
// of the app's public address (glyphh apps: their deployed <slug>.glyphh.app
// URL, which the web bridge maps into `url` from prodUrl; url apps: their
// configured http(s) URL) — with an honest card when nothing is framable yet.

/** The address the web preview can frame, or null (undeployed / non-http). */
function webPreviewUrl(app: PanelApp | null): string | null {
  const url = app?.url || null;
  return url && /^https?:\/\//i.test(url) ? url : null;
}

/** The dashboard tab's right pane — the slot the desktop webview lives in. */
function webPreviewHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".app-builder-preview .app-tab-right[data-tab='dashboard']");
}

/** Ensure the preview iframe exists in the slot and show `url` in it. */
function webPreviewNavigate(url: string): void {
  const host = webPreviewHost();
  if (!host) return;
  document.getElementById("app-preview-fallback")?.remove();
  let frame = document.getElementById("app-preview-frame") as HTMLIFrameElement | null;
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = "app-preview-frame";
    frame.className = "app-preview-frame";
    // Scripts + same-origin + forms is enough for a real app to run; no
    // top-navigation and no popups from inside the preview.
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
    // A hard load failure is detectable; a frame-ancestors refusal mostly is
    // not (the browser hides it from the embedder) — the toolbar's "Open in
    // new tab" stays as the honest escape hatch either way.
    frame.addEventListener("error", () => {
      webPreviewFallback("This site refused to load in the preview.", frame?.src || null);
    });
    host.appendChild(frame);
  }
  if (frame.src !== url) frame.src = url;
}

/** Show the no-preview card (replacing any iframe). */
function webPreviewFallback(message: string, openUrl: string | null): void {
  const host = webPreviewHost();
  if (!host) return;
  document.getElementById("app-preview-frame")?.remove();
  let card = document.getElementById("app-preview-fallback");
  if (!card) {
    card = document.createElement("div");
    card.id = "app-preview-fallback";
    card.className = "app-preview-fallback";
    host.appendChild(card);
  }
  card.innerHTML = `<div class="app-preview-fallback-card">
      <p>${escMkt(message)}</p>
      ${openUrl ? `<button type="button" class="action-btn app-preview-open-tab">Open in new tab</button>` : ""}
    </div>`;
  card.querySelector<HTMLButtonElement>(".app-preview-open-tab")?.addEventListener("click", () => {
    if (openUrl) window.open(openUrl, "_blank", "noopener");
  });
}

/** WEB: render the preview pane for `app` — iframe when framable, honest card
 *  when not. Idempotent; the desktop <webview> is CSS-hidden on web. */
function renderWebPreview(app: PanelApp): void {
  const url = webPreviewUrl(app);
  // NON-GLYPHH apps never frame on the web (his rule, 2026-08-25): external
  // sites mostly refuse framing and native rows have no web surface — the
  // themed card says so honestly instead of a blank or broken frame.
  if (app.appArchetype !== "glyphh-app") {
    webPreviewFallback(
      url
        ? "This app can't be viewed from the web. Open it in its own tab, or on the desktop app."
        : "This app can't be viewed from the web — it runs on the desktop app.",
      url,
    );
    return;
  }
  if (url) { webPreviewNavigate(url); return; }
  webPreviewFallback("This app isn't deployed yet. Deploy it from the Public hosting tab, then preview it here.", null);
}

let panelLoaded = false;

async function loadPanelTab() {
  const app = panelApps.find((a) => a.id === currentAppId);
  if (!app) return;

  // WEB: the desktop <webview> path below is inert in a browser — preview via
  // a sandboxed iframe of the app's public address instead. No machine IPC.
  if (IS_WEB) { renderWebPreview(app); return; }

  // Installed glyphh-apps have no url — their UI is their cloud instance's,
  // behind the preview-open IPC. Mirror isGlyphhAppRow so native
  // terminal/editor apps (execPath, no url) still fall through to "no url".
  const isGlyphhApp = app.appArchetype === "glyphh-app" || /\.html?$/i.test(app.execPath || "");

  if (!app.url && !isGlyphhApp) {
    // #app-commands-list was removed from the markup — guard, don't crash
    // (the old non-null assertion threw "Cannot set properties of null" and
    // took down Open App on web).
    const noUrlHost = document.getElementById("app-commands-list");
    if (noUrlHost) noUrlHost.innerHTML = `<div class="inline-empty">No URL configured for this tab. Add one above to open it in the work panel.</div>`;
    return;
  }

  if (!panelLoaded) {
    if (isGlyphhApp) {
      // ONE RULE with Echo (his correction, 2026-08-25): the LOCAL bundle
      // wins. Previewing your own app should never take an internet round
      // trip and a members auth challenge; after a deploy the on-disk build
      // is the same bytes anyway. The hosted URL is the fallback for an app
      // whose source lives on someone else's machine.
      const wcId = await ensurePreviewWcId();
      // Register the preview guest so the app-data seam injects the bearer.
      if (wcId !== undefined) (window.glyphh as unknown as { rpaRegister?: (slug: string, wcId: number) => void }).rpaRegister?.(app.slug, wcId);
      const res = await window.glyphh.glyphhAppPreviewOpen(app.slug, wcId);
      // LOCAL BUILD ONLY (his law, 2026-09-01): the preview never loads the
      // published site — what you see is what's on disk, not what shipped.
      // No local build → say so honestly instead of silently showing prod.
      if (res?.ok && res.fileUrl) { if (appPreview) appPreview.src = res.fileUrl; }
      else {
        const errHost = document.getElementById("app-commands-list");
        if (errHost) errHost.innerHTML = `<div class="inline-empty">${res?.error || "No local build to preview yet — build the app (update_app) and it appears here."}</div>`;
        return;
      }
    } else {
      // Web app: drop any glyphh grant left on the reused preview webContents.
      void window.glyphh.glyphhAppPreviewClear(getPreviewWebContentsId());
      if (appPreview) { appPreview.partition = "persist:yo"; appPreview.src = app.url!; }
    }
    panelLoaded = true;
  }
}

/** The preview <webview> creates its guest (and thus a webContents id) shortly
 *  after it attaches to the DOM; wait briefly so the caps grant has a target. */
async function ensurePreviewWcId(): Promise<number | undefined> {
  let id = getPreviewWebContentsId();
  for (let i = 0; id === undefined && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 50));
    id = getPreviewWebContentsId();
  }
  return id;
}


async function openPanelAppDetail(app: PanelApp) {
  currentAppId = app.id;
  currentApp = app;
  panelLoaded = false;

  // Built-app tabs. Releases + Connections show for the builder AND anyone who
  // installed it; Marketplace + Public hosting are the builder's alone.
  const isBuilt = app.appArchetype === "glyphh-app";
  const owned = app.owned !== false;   // undefined (self/legacy) reads as owned
  // M7 consumer view: installed FROM the marketplace, not published here. The
  // developer hosts it, so the installer sees the store's tabs — exactly
  // About / Connections / Support — and none of the builder affordances.
  const mktInstalled = !owned;
  document.querySelectorAll<HTMLElement>(".tab-mkt-installed").forEach((el) => el.classList.toggle("hidden", !mktInstalled));
  document.querySelector(".app-detail-tab[data-tab='dashboard']")?.classList.toggle("hidden", mktInstalled);
  // A tab is a tab (his order, 2026-09-16): one basic form for every kind. An
  // installed app's tools, connections and contents live on Settings → Build → Apps.
  document.querySelectorAll<HTMLElement>(".app-detail-tab:not([data-tab='dashboard'])").forEach((el) => el.classList.add("hidden"));
  document.querySelectorAll<HTMLElement>(".tab-built-only").forEach((el) => {
    // The consumer view keeps Connections (the grants the app needs) and
    // drops Releases (the publisher's history, not the installer's).
    const show = mktInstalled ? el.dataset.tab === "connections" : isBuilt;
    el.classList.toggle("hidden", !show);
  });
  // The type control is retired: every NEW app is a web panel, and a built
  // app's type comes from its bundle either way.
  void isBuilt;
  document.getElementById("app-detail-type-row")?.classList.add("hidden");

  // Populate dashboard fields
  appDetailId.value = app.slug;
  appDetailName.value = app.name;
  appDetailUrl.value = app.url || "";
  const detailForce = document.getElementById("app-detail-force-web") as HTMLInputElement | null;
  if (detailForce) detailForce.checked = !!(app.launchConfig as { forceWeb?: boolean } | null)?.forceWeb;

  // Browser ↔ Native fields. Legacy apps have isBrowser undefined but always
  // carry a url, so they default to browser.
  const isBrowser = app.isBrowser !== undefined ? app.isBrowser : true;
  const detailType: AppType = isBrowser ? "browser" : "native";
  const typeSel = document.getElementById("app-detail-type") as HTMLSelectElement | null;
  if (typeSel) typeSel.value = detailType;
  const execEl = document.getElementById("app-detail-exec-path") as HTMLInputElement | null;
  if (execEl) execEl.value = app.execPath || "";
  const detailArchetype = (app.appArchetype as Archetype) || "generic";
  const archSel = document.getElementById("app-detail-archetype") as HTMLSelectElement | null;
  if (archSel) archSel.value = detailArchetype;
  writeLaunchConfig("app-detail", detailArchetype, app.launchConfig);
  // A GLYPHH app is BUILT, not launcher-configured (his rule, 2026-08-25): the
  // native exec-path/archetype block is the NATIVE launcher's, and an installed
  // glyphh app only rides those rails technically (entry html as execPath).
  // Its real "path" is the source of record — never show the native fields.
  const isGlyphhKind = app.appArchetype === "glyphh-app";
  toggleTypeFields("app-detail", isGlyphhKind ? "browser" : detailType);
  if (isGlyphhKind) document.getElementById("app-detail-browser-fields")?.classList.add("hidden");
  toggleArchetypeFields("app-detail", detailArchetype);

  // MCP + Guardrails tabs — installed apps that declare tools. The consumer
  // view doesn't carry them (its tabs are exactly About/Connections/Support);
  // the app's tools still reach the org's agents through the install.
  document.querySelectorAll<HTMLElement>(".tab-mcp-only").forEach((el) => el.classList.add("hidden"));

  // Shared edit header: icon + name + slug, with the app's PUBLISHED address
  // (or an honest "Not Published") underneath (his order, 2026-09-01). The
  // hosting-status load refreshes it with the live deployment's URL.
  appDetailHeading.textContent = "";
  const headEl = document.getElementById("app-detail-head");
  if (headEl) headEl.innerHTML =
    `<div class="app-card-icon">${appIconInner(app, app.name, "app-card-initial")}</div>` +
    `<div class="edit-head-col">` +
      `<div class="edit-head-name">${escMkt(app.name)}<span class="edit-head-slug">${escMkt(app.slug)}</span></div>` +
      `<div id="app-detail-url" class="edit-head-url"></div>` +
    `</div>`;
  // THE PURGE: no hosted address — a glyphh app's UI lives on disk. Only a
  // plain web entry carries a visitable url in its header.
  const urlEl = document.getElementById("app-detail-url");
  if (urlEl) urlEl.textContent = app.appArchetype === "glyphh-app" ? "" : (app.url || "");

  // The Glyphh system app can't be deleted (server enforces it) — don't offer.
  document.getElementById("app-detail-delete")?.classList.toggle("hidden", app.slug === "glyphh");
  // The open action resets per app — a prior suspended marketplace app must
  // not leave the button dead for the next one opened.
  const openBtn = document.getElementById("app-detail-open") as HTMLButtonElement | null;
  if (openBtn) { openBtn.disabled = false; openBtn.textContent = "Open tab"; openBtn.title = "Open this tab in the work panel"; }
  if (!mktInstalled) void gateAppDelete(app.slug);

  // All tabs always visible
  document.querySelectorAll<HTMLButtonElement>(".app-detail-tab").forEach(btn => {
    btn.classList.remove("tab-hidden");
  });

  // Show detail, hide grid
  appsList.classList.add("hidden");
  appsToolbar.classList.add("hidden"); appsHead?.classList.add("hidden");
  appAddForm.classList.add("hidden");
  appDetail.classList.remove("hidden");

  switchAppTab(mktInstalled ? "mkt-about" : "dashboard");
}

function getPreviewWebContentsId(): number | undefined {
  try { return appPreview.getWebContentsId(); } catch { return undefined; }
}

function closeAppDetail() {
  // Drop any glyphh capability grant on the reused preview webContents.
  void window.glyphh.glyphhAppPreviewClear?.(getPreviewWebContentsId());
  // The preview pane left the Tabs detail with the basic form (2026-09-16); the webview is optional now.
  if (appPreview) appPreview.src = "about:blank";
  // WEB preview cleanup — the iframe/fallback card are created per-app.
  document.getElementById("app-preview-frame")?.remove();
  document.getElementById("app-preview-fallback")?.remove();
  panelLoaded = false;
  appDetail.classList.add("hidden");
  appsList.classList.remove("hidden");
  appsToolbar.classList.remove("hidden"); appsHead?.classList.remove("hidden");
  loadApps();
}

/** The apps the panel/launcher paths can open — a system row (Glyphh itself)
 *  and a row with nothing to open are both excluded. */
function reloadPanelApps(apps: Array<PanelApp>) {
  panelApps = apps.filter((a) => !a.system && (a.url || a.isBrowser === false));
}

// ── MCP tab wiring — approvals + guardrails for an installed app ───────────

function initMcpTab(): void {
  document.getElementById("app-mcp-save")?.addEventListener("click", () => { void saveMcpGuardrails("app-mcp-status"); });
  document.getElementById("app-gr-save")?.addEventListener("click", () => { void saveMcpGuardrails("app-gr-status"); });
  document.getElementById("app-mcp-test-btn")?.addEventListener("click", () => { void testMcpTool(); });
  document.getElementById("app-mcp-select-all")?.addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    document.querySelectorAll<HTMLInputElement>(".mcp-tool-check").forEach((c) => { c.checked = on; });
    updateMcpSelectAll();
  });
  document.getElementById("app-mcp-tools")?.addEventListener("change", (e) => {
    if ((e.target as HTMLElement).classList?.contains("mcp-tool-check")) updateMcpSelectAll();
  });
}

/**
 * IMPORT FROM GOOGLE (his order, 2026-09-23) — Chrome's bookmarks become saved
 * tabs, and the cookies for those sites come with them so an imported tab opens
 * signed in. The dialog names the profile, the counts and the cookie carry
 * BEFORE anything is read: macOS asks for Keychain permission during the
 * import, and a user who did not expect that should have cancelled here.
 */
async function openChromeImport(): Promise<void> {
  const btn = document.getElementById("apps-chrome-btn") as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = "Reading Chrome…"; }
  const scan = await window.glyphh.chromeImportScan?.().catch(() => null);
  if (btn) { btn.disabled = false; btn.textContent = "Import from Google"; }
  if (!scan?.ok) { await confirmAction({ title: "Import from Google", body: scan?.error || "Chrome could not be read.", confirmLabel: "OK", cancelLabel: "Close" }); return; }
  if (!scan.installed) { await confirmAction({ title: "Import from Google", body: "Chrome is not installed for this user account, so there is nothing to import.", confirmLabel: "OK", cancelLabel: "Close" }); return; }
  if (!scan.profiles.length) { await confirmAction({ title: "Import from Google", body: "No Chrome profile on this Mac has any bookmarks to import.", confirmLabel: "OK", cancelLabel: "Close" }); return; }

  const overlay = document.getElementById("chrome-import-modal")!;
  const intro = document.getElementById("chrome-import-intro")!;
  const select = document.getElementById("chrome-import-profile") as HTMLSelectElement;
  const cookies = document.getElementById("chrome-import-cookies") as HTMLInputElement;
  const cookiesLabel = document.getElementById("chrome-import-cookies-label")!;
  const detail = document.getElementById("chrome-import-detail")!;
  const go = document.getElementById("chrome-import-go") as HTMLButtonElement;
  const cancel = document.getElementById("chrome-import-cancel") as HTMLButtonElement;
  // PORTAL, same reason as the standard confirm: this markup is authored inside
  // the settings section, whose stacking context would cap it below the modal.
  if (overlay.parentElement !== document.body) document.body.appendChild(overlay);

  select.innerHTML = "";
  for (const p of scan.profiles) {
    const o = document.createElement("option");
    o.value = p.dir;
    // Chrome's own name is what the user recognizes; the folder disambiguates
    // the several profiles people have under one name.
    o.textContent = `${p.name} — ${p.bookmarks} bookmark${p.bookmarks === 1 ? "" : "s"} (${p.dir})`;
    select.appendChild(o);
  }
  cookies.disabled = !scan.cookiesSupported;
  if (!scan.cookiesSupported) cookies.checked = false;

  const paint = (): void => {
    const p = scan.profiles.find((x) => x.dir === select.value) ?? scan.profiles[0];
    const already = p.bookmarks - p.newBookmarks;
    intro.textContent = `This adds ${p.newBookmarks} saved tab${p.newBookmarks === 1 ? "" : "s"} from “${p.name}”${already ? `, skipping ${already} you already have` : ""}.`;
    cookiesLabel.textContent = scan.cookiesSupported
      ? `Also bring the cookies for those ${p.cookieSites} site${p.cookieSites === 1 ? "" : "s"}, so the tabs open signed in`
      : "Cookies can only be imported on macOS";
    detail.textContent = cookies.checked
      ? "Glyphh reads this profile's bookmarks and, for those sites only, copies their cookies into Glyphh's browser. macOS will ask permission to read Chrome's cookie key. Your history, passwords, payment details and extensions are not read, and nothing in Chrome is changed."
      : "Glyphh reads this profile's bookmarks only. No cookies are copied, so you will sign in to each site inside Glyphh. Your history, passwords, payment details and extensions are not read, and nothing in Chrome is changed.";
    go.textContent = `Import ${p.newBookmarks} tab${p.newBookmarks === 1 ? "" : "s"}`;
    go.disabled = p.newBookmarks === 0 && !cookies.checked;
  };
  paint();

  const done = await new Promise<boolean>((resolve) => {
    const cleanup = (): void => {
      overlay.classList.add("hidden");
      select.removeEventListener("change", paint);
      cookies.removeEventListener("change", paint);
      go.removeEventListener("click", onGo);
      cancel.removeEventListener("click", onNo);
      overlay.removeEventListener("mousedown", onAway);
      document.removeEventListener("keydown", onKey);
    };
    function onGo(): void { cleanup(); resolve(true); }
    function onNo(): void { cleanup(); resolve(false); }
    function onAway(e: MouseEvent): void { if (e.target === overlay) onNo(); }
    function onKey(e: KeyboardEvent): void { if (e.key === "Escape") { e.preventDefault(); onNo(); } }
    select.addEventListener("change", paint);
    cookies.addEventListener("change", paint);
    go.addEventListener("click", onGo);
    cancel.addEventListener("click", onNo);
    overlay.addEventListener("mousedown", onAway);
    document.addEventListener("keydown", onKey);
    overlay.classList.remove("hidden");
    go.focus();
  });
  if (!done) return;

  go.disabled = true;
  const r = await window.glyphh.chromeImportRun?.({ profile: select.value, cookies: cookies.checked }).catch(() => null);
  await loadApps();   // the new tabs are the page's content now
  const said = !r || !r.ok
    ? (r?.error || "The import failed.")
    : [
      `${r.tabsAdded} tab${r.tabsAdded === 1 ? "" : "s"} added`,
      r.tabsSkipped ? `${r.tabsSkipped} skipped (already saved)` : "",
      cookies.checked && !r.cookieError ? `cookies for ${r.cookiesImported} entr${r.cookiesImported === 1 ? "y" : "ies"} imported` : "",
      r.cookieError ? `cookies were not imported: ${r.cookieError}` : "",
    ].filter(Boolean).join(", ") + ".";
  await confirmAction({ title: "Import from Google", body: said, confirmLabel: "OK", cancelLabel: "Close" });
}

function initApps() {
  initMcpTab();

  // Echo tile menu bridge: "Edit" on a command-center app tile opens the
  // Apps section straight onto that app's edit screen.
  (window as unknown as { __glyphhEditApp?: (idOrSlug: string) => void }).__glyphhEditApp = (idOrSlug: string) => {
    (window as unknown as { __wbOpenSection?: (s: string) => void }).__wbOpenSection?.("apps");
    void (async () => {
      try {
        const apps = (await window.glyphh.panelAppsList?.()) || [];
        const app = apps.find((a) => a.id === idOrSlug || a.slug === idOrSlug);
        if (app) await openPanelAppDetail(app as PanelApp);
      } catch (err) {
        console.error("[apps] edit-from-tile failed:", err);
      }
    })();
  };

  // Upgrade gates (App connections / MCP) open the platform to manage the plan,
  // the same way Settings → Account → Manage Account does.
  document.querySelectorAll<HTMLElement>(".tab-upgrade-btn").forEach((btn) => {
    btn.addEventListener("click", () => { void window.glyphh.execCommand(`dip ${window.glyphh.platformUrl}`); });
  });

  // Manual refresh + live refresh when the app library changes server-side
  // (e.g. an app installed over the MCP relay while this page is open).
  document.getElementById("apps-refresh-btn")?.addEventListener("click", () => { void loadApps(); });
  document.getElementById("apps-chrome-btn")?.addEventListener("click", () => { void openChromeImport(); });
  window.glyphh.onPanelAppsChanged?.(() => {
    // Don't stomp an open editor — the list re-fetches next time it shows.
    if (appDetail.classList.contains("hidden")) void loadApps();
  });

  // "Open Connections" from the required-connections warning.
  document.getElementById("app-req-conns-goto")?.addEventListener("click", (e) => {
    e.preventDefault();
    gotoSection("connections");
  });

  const addNameInput = document.getElementById("app-add-name") as HTMLInputElement;
  const addSlugInput = document.getElementById("app-add-slug") as HTMLInputElement;
  const addUrlInput = document.getElementById("app-add-url") as HTMLInputElement;
  // URL → live preview sync in the detail form. Editing the URL field
  // navigates the embedded panel preview to the new address so the user
  // sees their change without having to Save + reopen. Debounced to ride
  // out fast typing; only fires for well-formed URLs.
  let urlSyncTimer: ReturnType<typeof setTimeout> | null = null;
  appDetailUrl?.addEventListener("input", () => {
    if (urlSyncTimer) clearTimeout(urlSyncTimer);
    urlSyncTimer = setTimeout(() => {
      const u = appDetailUrl.value.trim();
      if (!u) return;
      let normalized = u;
      try { normalized = new URL(u).toString(); } catch { return; /* not yet a full URL */ }
      // WEB: navigate the preview iframe instead of the (inert) webview.
      if (IS_WEB) { webPreviewNavigate(normalized); return; }
      if (appPreview && appPreview.src !== normalized) {
        appPreview.partition = "persist:yo";
        appPreview.src = normalized;
        panelLoaded = true;
      }
    }, 400);
  });

  // WEB preview toolbar: Refresh re-navigates the iframe, and "Open in new
  // tab" mirrors web appLaunch's tab fallback — a browser can't force a site
  // to allow framing, so the honest affordance is always on offer.
  if (IS_WEB) {
    const refreshBtn = document.getElementById("app-preview-refresh");
    refreshBtn?.addEventListener("click", () => {
      const frame = document.getElementById("app-preview-frame") as HTMLIFrameElement | null;
      if (frame?.src) { const u = frame.src; frame.src = u; }
      else if (currentApp) renderWebPreview(currentApp);
    });
    const openTab = document.createElement("button");
    openTab.id = "app-preview-open-tab";
    openTab.type = "button";
    openTab.className = "preview-action preview-action-visible";
    openTab.textContent = "Open in new tab";
    openTab.addEventListener("click", () => {
      const url = webPreviewUrl(currentApp);
      if (url) window.open(url, "_blank", "noopener");
    });
    refreshBtn?.insertAdjacentElement("beforebegin", openTab);
  }

  // Slug helpers
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let slugTouched = false;
  addSlugInput?.addEventListener("input", () => { slugTouched = addSlugInput.value.trim().length > 0; });
  addNameInput?.addEventListener("input", () => {
    if (!slugTouched) addSlugInput.value = slugify(addNameInput.value);
  });

  // + New — opens the simple App add form (name → auto-slug → URL).
  // The old "Add App | Add MCP Server" dropdown is gone; the form
  // already lets the user wire MCP in the detail view after creating.
  // Apps are WEB PANELS now — the add form has no type control at all.
  const addTypeSelect = document.getElementById("app-add-type") as HTMLSelectElement | null;
  const addArchetypeSelect = document.getElementById("app-add-archetype") as HTMLSelectElement;
  const addExecPath = document.getElementById("app-add-exec-path") as HTMLInputElement;

  // (The Marketplace storefront is its own left-rail section now — its search,
  // scope, sort, and refresh are wired by help/marketplace.ts.)

  // A tab is a web page, or an installed Glyphh app bundle (Settings → Build → Apps).
  const addSource = document.getElementById("app-add-source") as HTMLSelectElement | null;
  const addBundle = document.getElementById("app-add-bundle") as HTMLSelectElement | null;
  const addBundleFields = document.getElementById("app-add-bundle-fields");
  const addBrowserFields = document.getElementById("app-add-browser-fields");
  const paintSource = (): void => {
    const glyphh = addSource?.value === "glyphh";
    addBundleFields?.classList.toggle("hidden", !glyphh);
    addBrowserFields?.classList.toggle("hidden", glyphh);
  };
  addSource?.addEventListener("change", () => {
    paintSource();
    const picked = addBundle?.selectedOptions[0];
    if (addSource?.value === "glyphh" && picked && !addNameInput.value.trim()) { addNameInput.value = picked.textContent || ""; addSlugInput.value = ""; slugTouched = false; }
  });
  addBundle?.addEventListener("change", () => {
    const picked = addBundle.selectedOptions[0];
    if (picked && !slugTouched) { addNameInput.value = picked.textContent || ""; addSlugInput.value = ""; }
  });
  const loadBundles = async (): Promise<void> => {
    if (!addBundle) return;
    const glyphhOpt = addSource?.querySelector<HTMLOptionElement>('option[value="glyphh"]');
    // Installed app BUNDLES are the desktop's folders (skills-fs.ts); the web
    // bridge serves no skillsList, so the "Glyphh app" source is not offered.
    if (!hostHas("skillsList")) {
      if (glyphhOpt) { glyphhOpt.disabled = true; glyphhOpt.hidden = true; }
      addBundle.innerHTML = `<option value="">Installed apps live on your desktop</option>`;
      return;
    }
    const r = await window.glyphh.skillsList("app").catch(() => ({ ok: false, data: [] as Array<{ id: string; name: string }> }));
    const rows = (r.ok && Array.isArray(r.data) ? r.data : []) as Array<{ id: string; name: string }>;
    addBundle.innerHTML = rows.length ? rows.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join("") : `<option value="">No apps installed yet</option>`;
    if (glyphhOpt) glyphhOpt.disabled = rows.length === 0;
  };

  /** The New tab form, blank and ready: what the Tabs page's + and the
   *  Workspaces page's "+ New tab" both start from. */
  const prepareAddForm = (): void => {
    addNameInput.value = "";
    addSlugInput.value = "";
    slugTouched = false;
    addUrlInput.value = "";
    if (addSource) addSource.value = "browser";
    paintSource();
    void loadBundles();
    // Every new app is a WEB PANEL.
    addExecPath.value = "";
    addArchetypeSelect.value = "generic";
    writeLaunchConfig("app-add", "generic", null);
    toggleTypeFields("app-add", "browser");
    toggleArchetypeFields("app-add", "generic");
    appFormError.classList.add("hidden");
  };
  document.getElementById("apps-add-btn")?.addEventListener("click", () => {
    returnAddForm();
    prepareAddForm();
    appsList.classList.add("hidden");
    appsToolbar.classList.add("hidden"); appsHead?.classList.add("hidden");
    appAddForm.classList.remove("hidden");
    addNameInput.focus();
  });
  // THE SAME FORM, STANDALONE ON ANOTHER PAGE (his order, 2026-10-03: the
  // Workspaces editor adds a tab in place, and the new tab is there for the
  // slot pickers). The ONE form node moves into the host and comes home when
  // it is saved or cancelled, so the Tabs page is never left without it.
  (window as unknown as { __glyphhMountAddTabForm?: MountAddTabForm }).__glyphhMountAddTabForm = (host, cb) => {
    returnAddForm();
    standalone = { home: { parent: appAddForm.parentElement!, next: appAddForm.nextSibling }, ...cb };
    host.appendChild(appAddForm);
    prepareAddForm();
    appAddForm.classList.remove("hidden");
    addNameInput.focus();
  };
  (window as unknown as { __glyphhReturnAddTabForm?: () => void }).__glyphhReturnAddTabForm = () => {
    if (!standalone) return;
    const cb = standalone.onCancel;
    returnAddForm();
    cb();
  };

  // Add-form archetype toggle + Browse… button (the type control is gone).
  addArchetypeSelect?.addEventListener("change", () => toggleArchetypeFields("app-add", addArchetypeSelect.value as Archetype));
  document.getElementById("app-add-exec-browse")?.addEventListener("click", async () => {
    const picked = await window.glyphh.pickExecutable?.();
    if (picked) addExecPath.value = picked;
  });

  // App add form save
  document.getElementById("app-add-save")?.addEventListener("click", async () => {
    let valid = true;
    const name = addNameInput.value.trim();
    const url = addUrlInput.value.trim();
    const slugInput = addSlugInput.value.trim();
    if (addSource?.value === "glyphh") {
      const bundleId = addBundle?.value || "";
      if (!bundleId) { appFormError.textContent = "Pick an installed app."; appFormError.classList.remove("hidden"); return; }
      const slug = slugInput ? slugify(slugInput) : undefined;
      const r: { ok: boolean; data?: { slug: string; name: string }; error?: string } = await window.glyphh.skillTab(bundleId, { name: name || undefined, slug }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      const tab = r.data;
      if (!r.ok || !tab) { appFormError.textContent = r.error || "Failed to create the tab."; appFormError.classList.remove("hidden"); return; }
      appAddForm.classList.add("hidden");
      const apps = (await window.glyphh.panelAppsList?.()) || [];
      reloadPanelApps(apps.map(toPanelApp));
      if (standalone) { const cb = standalone.onSaved; returnAddForm(); cb(); return; }
      const createdLocal = panelApps.find((a) => a.slug === tab.slug);
      if (createdLocal) openPanelAppDetail(createdLocal);
      return;
    }
    const addType = "browser" as AppType;   // apps ARE web panels
    const isBrowser = true;
    const execPath = addExecPath.value.trim();
    if (!name) { addNameInput.classList.add("invalid"); clearInvalid(addNameInput); valid = false; }
    if (addType === "browser" && !url) { addUrlInput.classList.add("invalid"); clearInvalid(addUrlInput); valid = false; }
    if (addType === "native" && !execPath) { addExecPath.classList.add("invalid"); clearInvalid(addExecPath); valid = false; }
    if (!valid) {
      appFormError.textContent = addType === "browser"
        ? "Name and URL are required."
        : "Name and executable path are required.";
      appFormError.classList.remove("hidden");
      return;
    }
    const id = slugInput ? slugify(slugInput) : slugify(name);
    if (!id) {
      addSlugInput.classList.add("invalid"); clearInvalid(addSlugInput);
      appFormError.textContent = "Slug must contain at least one letter or number.";
      appFormError.classList.remove("hidden");
      return;
    }
    const RESERVED = new Set(["yo", "sup", "dip", "drip", "peace", "council", "vibe"]);
    if (RESERVED.has(id)) {
      addSlugInput.classList.add("invalid"); clearInvalid(addSlugInput);
      appFormError.textContent = `"${id}" is a reserved command. Pick a different slug.`;
      appFormError.classList.remove("hidden");
      return;
    }
    // Uniqueness check — apps and vibes share one namespace.
    const existing = (await window.glyphh.panelAppsList?.()) || [];
    if (existing.some((a) => a.slug === id)) {
      addSlugInput.classList.add("invalid"); clearInvalid(addSlugInput);
      appFormError.textContent = `Slug "${id}" is already taken. Pick a different one.`;
      appFormError.classList.remove("hidden");
      return;
    }
    const archetype = addArchetypeSelect.value as Archetype;
    const createInput = addType === "browser"
      // A web app opens as a Glyphh panel — there is no browser or window
      // placement to configure, so it carries no launcher config at all.
      ? {
          name, slug: id, isBrowser: true, url, execPath: null,
          launchConfig: (document.getElementById("app-add-force-web") as HTMLInputElement | null)?.checked ? { forceWeb: true } : {},
        }
      : { name, slug: id, isBrowser: false, url: null, execPath, appArchetype: archetype, launchConfig: readLaunchConfig("app-add", archetype) };
    const created = await window.glyphh.panelAppsCreate?.(createInput);
    if (!created?.ok || !created.app) {
      appFormError.textContent = created?.error || "Failed to create app.";
      appFormError.classList.remove("hidden");
      return;
    }
    // Force-web / do-not-record are set from the app's detail screen now; new
    // apps already default to capture-off.
    appAddForm.classList.add("hidden");
    const apps = (await window.glyphh.panelAppsList?.()) || [];
    reloadPanelApps(apps.map(toPanelApp));
    if (standalone) { const cb = standalone.onSaved; returnAddForm(); cb(); return; }
    const createdLocal = panelApps.find((a) => a.id === created.app!.id);
    if (createdLocal) openPanelAppDetail(createdLocal);
    else loadApps();
  });

  // App detail back button
  document.getElementById("app-detail-close")?.addEventListener("click", () => closeAppDetail());

  // App detail "Open app" — leaves settings: close the modal and open the app
  // as a WORKBENCH panel (web + glyphh apps). A native executable can't run
  // in a panel — it keeps the OS launch, closing the modal only on success so
  // a launch error stays visible inline.
  document.getElementById("app-detail-open")?.addEventListener("click", async () => {
    const app = panelApps.find((a) => a.id === currentAppId);
    if (!app) return;
    const glyphh = app.appArchetype === "glyphh-app";
    // AN APP THAT IS A BUILT-IN PANEL OPENS THAT PANEL (his report,
    // 2026-09-17: Open tab on Design opened nothing useful). The left rail has
    // always read `tool` off the row; this button did not, so Design, Slides,
    // Images, Video and Audio opened their bundle's placeholder page instead.
    const tool = (app.launchConfig as { tool?: unknown } | null | undefined)?.tool;
    if (glyphh && typeof tool === "string" && tool) {
      closeSettingsModal();
      openWorkPanelInWorkbench("__wbOpenTool", tool);
      return;
    }
    if (app.url || glyphh) {
      closeSettingsModal();
      // A marketplace-installed app is a chromeless panel to the installer.
      openAppInWorkbench({ slug: app.slug, name: app.name, url: app.url, glyphh: glyphh || undefined, workbench: (glyphh && app.owned === false) || undefined });
      return;
    }
    const r = await launchPanelApp(app);
    if (!r?.ok && r?.error) { appFormError.textContent = r.error; appFormError.classList.remove("hidden"); return; }
    closeSettingsModal();
  });

  // App add form cancel
  const cancelAdd = (): void => {
    if (standalone) { const cb = standalone.onCancel; returnAddForm(); cb(); return; }
    loadApps();
  };
  document.getElementById("app-add-cancel")?.addEventListener("click", cancelAdd);
  document.getElementById("app-add-cancel-btn")?.addEventListener("click", cancelAdd);

  // Tab buttons — [data-tab] only: other editors (Roles) share the tab
  // CLASS but key their own data attributes.
  document.querySelectorAll<HTMLButtonElement>(".app-detail-tab[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => switchAppTab(btn.dataset.tab!));
  });

  // Detail-form Browser ↔ Native + archetype toggles + Browse… button.
  const detailTypeSelect = document.getElementById("app-detail-type") as HTMLSelectElement;
  const detailArchetypeSelect = document.getElementById("app-detail-archetype") as HTMLSelectElement;
  const detailExecPath = document.getElementById("app-detail-exec-path") as HTMLInputElement;
  detailTypeSelect?.addEventListener("change", () => {
    toggleTypeFields("app-detail", detailTypeSelect.value as AppType);
  });
  detailArchetypeSelect?.addEventListener("change", () => toggleArchetypeFields("app-detail", detailArchetypeSelect.value as Archetype));
  document.getElementById("app-detail-exec-browse")?.addEventListener("click", async () => {
    const picked = await window.glyphh.pickExecutable?.();
    if (picked) detailExecPath.value = picked;
  });

  // Dashboard save
  document.getElementById("app-dash-save")?.addEventListener("click", async () => {
    if (!currentAppId) return;
    const newSlug = appDetailId.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const type = (detailTypeSelect?.value || "browser") as AppType;
    // A BUILT app keeps its kind (the server refuses to retype one) and its bundle
    // config; only its owner-set fields — name, tool approvals, limits — move here.
    const isBuilt = currentApp?.appArchetype === "glyphh-app";
    const patch: PanelAppInput = isBuilt ? {} : { isBrowser: type === "browser" };
    if (newSlug) patch.slug = newSlug;
    const name = appDetailName.value.trim();
    if (name) patch.name = name;

    if (isBuilt) {
      // The approvals + guardrails ride on top of the bundle's own contract, so
      // spread the existing config rather than replacing it.
      const { mcpApproved, guardrails } = readMcpConfig();
      patch.launchConfig = { ...(currentApp?.launchConfig || {}), mcpApproved, guardrails };
    } else if (type === "browser") {
      const url = appDetailUrl.value.trim();
      if (url) patch.url = url;
      patch.launchConfig = (document.getElementById("app-detail-force-web") as HTMLInputElement | null)?.checked ? { forceWeb: true } : {};
      patch.execPath = null;
    } else {
      patch.url = null;
      patch.execPath = detailExecPath?.value.trim() ?? "";
      const archetype = (detailArchetypeSelect?.value || "generic") as Archetype;
      patch.appArchetype = archetype;
      patch.launchConfig = readLaunchConfig("app-detail", archetype);
    }
    const saved = await window.glyphh.panelAppsUpdate?.(currentAppId, patch);
    if (!saved?.ok) {
      appFormError.textContent = saved?.error || "Failed to save app.";
      appFormError.classList.remove("hidden");
      return;
    }

    closeAppDetail();
  });

  // Dashboard cancel
  document.getElementById("app-dash-cancel")?.addEventListener("click", () => closeAppDetail());
  document.getElementById("app-detail-close")?.addEventListener("click", () => closeAppDetail());

  // Delete
  document.getElementById("app-detail-delete")?.addEventListener("click", async () => {
    if (!currentAppId) return;
    const confirmed = await confirmAction({
      title: `Delete “${appDetailName.value}”?`,
      body: "The app leaves your library — connected accounts stay intact.",
      confirmLabel: "Delete tab",
      danger: true,
    });
    if (!confirmed) return;
    const res = await window.glyphh.panelAppsDelete?.(currentAppId);
    if (res && res.ok === false) {
      // Tell the user instead of silently closing as if it worked.
      await confirmAction({
        title: "Couldn't delete this tab",
        body: res.error || "Couldn't delete this tab.",
        confirmLabel: "OK",
      });
      if (currentApp?.slug) void gateAppDelete(currentApp.slug);
      return;
    }
    closeAppDetail();
  });

  // Export the current app as a .glyphh bundle (main shows the save dialog).
  document.getElementById("app-detail-export")?.addEventListener("click", async () => {
    if (!currentAppId) return;
    const btn = document.getElementById("app-detail-export") as HTMLButtonElement;
    const prev = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Exporting…";
    try {
      const res = await window.glyphh.appExport(currentAppId);
      btn.textContent = res?.ok ? "Exported ✓" : (res?.error === "Canceled" ? prev : "Export failed");
    } catch {
      btn.textContent = "Export failed";
    } finally {
      setTimeout(() => { btn.disabled = false; btn.textContent = prev; }, 1800);
    }
  });


  // Draggable split divider. Pointer CAPTURE, not document mouse listeners:
  // the preview pane is a webview, and a webview swallows mouse events — the
  // old document-level mouseup never fired over it, so the handle stuck to
  // the cursor until the next click on host chrome.
  //
}

export { loadApps, initApps, closeAppDetail };
