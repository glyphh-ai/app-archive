/**
 * Help overlay — open/close, section switching, nav wiring.
 */

import { closeHelp, getHelpOverlay, getHelpTransitioning, setHelpTransitioning, guardWebviewsForModal, confirmAction } from "./shared.js";
import { onWeb, DESKTOP_ONLY_SUBS, hideDesktopOnlySubs } from "./web-surface.js";
import { groupOfSub, groupPageKey, subHasDiscover, CUSTOMIZE_TAB_ORDER, type GroupPage } from "./surface.js";
import { loadOAuth, initOAuth } from "./settings-oauth.js";
import { loadGatewayMetrics } from "./gateway-metrics.js";
import { loadGatewayKeys } from "./gateway-keys.js";
import { hidePanelsForModal, restorePanelsForModal } from "../yo-modal.js";
import { loadDashboard, initDashboardEvents, loadUsageChart, loadUsageMetrics, loadUsageMembers, paintDashGreeting } from "./dashboard.js";
import { clearUiState, loadUiState, uiStateGet, uiStateSet } from "./ui-state.js";
import { loadDrips, initDripsEvents } from "./drips.js";
import { loadSkillsSettings, loadAppsSettings, loadPluginsSettings, loadTasksSettings, setLibraryScope } from "./settings-skills.js";
import { loadAgentsSettings } from "./settings-agents.js";
import { loadRemoteControl } from "./settings-remote.js";
import { initDevices, loadDevices } from "./settings-devices.js";
import { loadSchedulesPage, initSchedulesEvents } from "./schedules.js";
import { loadOrgLibrary } from "./org-library.js";
import { loadSettingsConnections, setConnectionsScope } from "./settings-connections.js";
import { loadConnections, initConnections } from "./connections.js";
import { loadSettings, initSettings, loadBilling, loadProfile, loadMembers, loadMcp, loadWorkspacesPanel, loadUsageAppView } from "./settings.js";
import { loadOrgPanel, initOrgPanel } from "./settings-org-panel.js";
import { loadCode, initCode, wireGlobalDotCommands, openAppInWorkbench } from "./code.js";
import { loadSupport, loadAbout } from "./docs.js";
import { loadMemorySettings } from "./settings-memory.js";
import { loadFiles, initFiles } from "./files.js";
import { loadDownload } from "./settings-download.js";
import { loadSupportPanel, initSupportPanel } from "./settings-support.js";
import { loadAdminPlans, loadAdminOrgs, loadAdminModels, loadAdminUsage } from "./settings-admin.js";

const overlay = getHelpOverlay();
const sections = document.querySelectorAll<HTMLDivElement>(".help-section");

// ── Open / close ─────────────────────────────────────────

// THE user-menu rows — one list, every anchor (his question, 2026-08-27:
// two hand-built menus had drifted; About made one and missed the other).
// Settings is FIRST (his order, 2026-09-18): the gear that sat beside the
// account row is gone, and this menu is the way in.
// Rendered by buildUserMenuInto for BOTH the rail's Account chip and the
// settings shell's bottom-left chip.
const USER_MENU_ROWS: ReadonlyArray<{ label: string; sub: string; icon: string }> = [
  { label: "Settings", sub: "", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>` },
  { label: "Account", sub: "account", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg>` },
  { label: "About", sub: "about", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><line x1="12" y1="11" x2="12" y2="16.5"/><line x1="12" y1="7.6" x2="12.01" y2="7.6"/></svg>` },
];
/** Render the shared rows + Log out into `menu`. `go` routes a sub.
 *  `insideSettings` drops the Settings row: it is the door into the dialog,
 *  and inside the dialog there is nowhere for it to go. */
/** The org console; the same address the Settings row under Organization opens. */
const PLATFORM_URL = "https://platform.glyphh.ai";
const buildUserMenuInto = (menu: HTMLElement, go: (sub: string) => void, onPicked: () => void, insideSettings = false): void => {
  for (const r of USER_MENU_ROWS) {
    if (insideSettings && !r.sub) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "code-menu-item";
    b.setAttribute("role", "menuitem");
    b.innerHTML = `${r.icon}<span></span>`;
    (b.querySelector("span") as HTMLElement).textContent = r.label;
    b.addEventListener("click", () => { onPicked(); go(r.sub); });
    menu.appendChild(b);
  }
  void (window as unknown as { glyphh?: { getUpdateStatus?: () => Promise<{ version?: string; ready?: boolean } | null> } })
    .glyphh?.getUpdateStatus?.().then((st) => {
      if (!st?.version) return;
      Array.from(menu.querySelectorAll<HTMLElement>(".code-menu-item span"))
        .find((sp) => sp.textContent === "About")
        ?.insertAdjacentHTML("afterend", `<span class="user-menu-dot" title="${st.ready ? "An update is ready to install" : "A new release is available"}"></span>`);
    }).catch(() => {});
  // PLATFORM (his order, 2026-10-04): the org console, in a new tab — a
  // browser tab on the web, a workspace panel on the desktop (house rule).
  const platform = document.createElement("button");
  platform.type = "button";
  platform.className = "code-menu-item";
  platform.setAttribute("role", "menuitem");
  platform.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/></svg><span>Platform</span>`;
  platform.addEventListener("click", () => { onPicked(); window.open(PLATFORM_URL, "_blank", "noopener"); });
  menu.appendChild(platform);
  const sep = document.createElement("div");
  sep.className = "menu-sep";
  menu.appendChild(sep);
  const out = document.createElement("button");
  out.type = "button";
  out.className = "code-menu-item danger menu-danger";
  out.setAttribute("role", "menuitem");
  out.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Log out</span>`;
  out.addEventListener("click", () => {
    onPicked();
    clearUiState();
    void (window as unknown as { glyphh?: { logout?: () => Promise<void> } }).glyphh?.logout?.();
  });
  menu.appendChild(out);
};

export function openHelp() {
  if (getHelpTransitioning()) return;
  setHelpTransitioning(true);
  setTimeout(() => { setHelpTransitioning(false); }, 300);
  window.glyphh.panelsHide();
  overlay.classList.remove("hidden");
  window.glyphh.refreshAuth().catch(() => {});
  loadActiveSection();
}

export function openSettings(sub?: string) {
  // Settings is a modal overlay now — it no longer swaps the workbench for a
  // full-page section. The user-menu "Settings"/"Account" and every deep link
  // land here.
  openSettingsModal(sub);
}

export function isHelpOpen(): boolean {
  return !overlay.classList.contains("hidden");
}

// ── Navigation ───────────────────────────────────────────

export function resetEditors() {
  const le = document.getElementById("layout-editor");
  if (le && !le.classList.contains("hidden")) {
    le.classList.add("hidden");
    document.getElementById("layouts-list")?.classList.remove("hidden");
    document.getElementById("layouts-toolbar")?.classList.remove("hidden");
  }
  const de = document.getElementById("drip-editor");
  if (de && !de.classList.contains("hidden")) {
    de.classList.add("hidden");
    document.getElementById("drips-list")?.classList.remove("hidden");
    document.getElementById("drips-toolbar")?.classList.remove("hidden");
  }
  const ad = document.getElementById("app-detail");
  if (ad && !ad.classList.contains("hidden")) {
    ad.classList.add("hidden");
    document.getElementById("apps-list")?.classList.remove("hidden");
    document.getElementById("apps-toolbar")?.classList.remove("hidden");
    const preview = document.getElementById("app-preview") as HTMLElement & { src: string } | null;
    if (preview) preview.src = "about:blank";
    // Web-surface preview (iframe + fallback card) — created per-app by apps.ts.
    document.getElementById("app-preview-frame")?.remove();
    document.getElementById("app-preview-fallback")?.remove();
  }
  const af = document.getElementById("app-add-form");
  if (af && !af.classList.contains("hidden")) {
    af.classList.add("hidden");
    document.getElementById("apps-list")?.classList.remove("hidden");
    document.getElementById("apps-toolbar")?.classList.remove("hidden");
  }
}


function activeSection(): string {
  // The rail's single source of section truth — set by switchToSection.
  return document.body.dataset.railSection || "guide";
}

export function loadActiveSection(explicit?: string) {
  const sec = explicit || activeSection();
  if (sec === "dashboard") void loadDashboard();
  else if (sec === "customize") loadSettingsGroup(sec);
  else if (sec === "drips") loadDrips();
  else if (sec === "schedules") void loadSchedulesPage();
  else if (sec === "connections") void loadConnections();
  else if (sec === "files") void loadFiles();
  else if (sec === "code") loadCode();
  else if (sec === "settings") loadSettings();
  else if (sec === "support") loadSupport();
}

/**
 * Navigate to a section (and optional sub-panel). Driven by the app's
 * left-rail nav; `body.dataset.railSection` is the single source of section
 * truth. (The old #help-nav sidebar — hidden but load-bearing — is deleted.)
 */
export function gotoSection(section: string, sub?: string): void {
  const moved = SECTION_ALIAS[section];
  if (moved) { section = moved.section; sub = sub || moved.sub; }
  // Settings is a MODAL now — intercept before the workbench section swap so
  // the user-menu item, the "models" alias, and any deep link all open the
  // overlay instead of replacing the workspace with a full-page section.
  if (section === "settings") {
    void window.glyphh.setPreference?.("homeLastSection", "settings");
    void window.glyphh.setPreference?.("homeLastSub", sub || "");
    openSettingsModal(sub);
    return;
  }
  // "Customize" — the rail's app-settings entry. Opens the modal on the app-
  // config anchor ("app" → appearance via SETTINGS_SUB_ALIAS).
  if (section === "app") {
    openSettingsModal("app");
    return;
  }
  // Docs live on the site now (glyphh.ai/docs), not in the app.
  if (section === "docs") {
    void window.glyphh.openExternal(sub ? `https://glyphh.ai/docs/${sub}` : "https://glyphh.ai/docs");
    return;
  }
  // Apps + Connections (A2), Loops + Skills + Agents (A3), and Layouts moved
  // INTO the settings modal — each is a settings sub-panel now, not a full-page
  // rail section. (The rail keeps its Layouts quick-launch tray, which opens a
  // layout directly rather than this management page.)
  // Apps / Connections / Workspaces are WORKBENCH sections now (the rail's
  // panels); only the management-shaped pages (loops/skills/agents) stay in
  // the settings modal.
  // Loops + Skills are WORKPANEL apps now (his rule, 2026-08-24) — they open
  // as section panels beside the agent, never inside settings.
  if (["drips", "connections"].includes(section)) {
    (window as unknown as { __wbOpenSection?: (s: string) => void }).__wbOpenSection?.(section);
    return;
  }
  // Content sections need the window body — if Glyphh is collapsed to the
  // rail, expand it (the workspace apps slide back right).
  if (["files"].includes(section)) {
    void window.glyphh.railCollapseSet?.(false);
  }
  void window.glyphh.setPreference?.("homeLastSection", section);
  void window.glyphh.setPreference?.("homeLastSub", sub || "");
  // 2.5.0 shell: every section IS a workbench panel — opening one replaces
  // the workspace with just that panel; "code" is the agent surface. The
  // loader runs via __wbSectionLoad once the panel's DOM mounts.
  resetEditors();
  document.body.dataset.railSection = section;
  const w = window as unknown as { __initCodeWorkbench?: () => void; __wbOpenSection?: (s: string) => void };
  w.__initCodeWorkbench?.();
  let tries = 0;
  const go = (): void => {
    if (w.__wbOpenSection) w.__wbOpenSection(section);
    else if (tries++ < 40) { requestAnimationFrame(go); return; }
    // Settings and docs return early above (both open as the settings modal);
    // no remaining section here carries a deep-link sub through the workbench.
  };
  go();
}

// ── Settings modal ───────────────────────────────────────
//
// Settings is a centered modal overlay (A1), not a full-page workbench
// section. The two-column .settings-layout DOM is MOVED out of its hidden
// .help-section pen into the modal on open and moved back on close — so the
// panels keep their exact ids/classes and every existing loader (billing,
// members, workspaces, models, …) and the admin-only role-gating work
// untouched wherever the layout currently lives.

/** The layout's resting place — the section it lives in when the modal is
 *  closed. Captured on first open so it can be parked back precisely. */
let settingsHomePen: HTMLElement | null = null;
let settingsModalWebviewsGuarded = false;
let settingsModalPanelsHidden = false;
let settingsModalHidePromise: Promise<boolean> | null = null;

/** The MAIN settings nav's own items, wherever the rail keeps them: as its direct
 *  children, or under the scrolling list the desktop's user-chip footer wraps them in. */
function settingsNavOwn<T extends Element>(cls: string): T[] {
  return Array.from(document.querySelectorAll<T>(`.settings-nav > ${cls}, .settings-nav > .settings-nav-list > ${cls}`));
}

function selectSettingsSub(sub: string): void {
  const target = settingsSubAlias(sub);
  // Direct children of the MAIN settings nav/panels only.
  const navBtns = settingsNavOwn<HTMLButtonElement>(".settings-nav-item");
  const panels = document.querySelectorAll<HTMLDivElement>(".settings-modal-body > .settings-layout > .settings-panels > .settings-panel");
  // Two rail items may share a sub (Dashboard + Organization › Usage both
  // open "usage") — the programmatic path lights only the FIRST; a direct
  // click lights exactly the clicked one (its own handler).
  let seen = false;
  navBtns.forEach((n) => {
    const hit = n.dataset.sub === target && !seen;
    if (hit) seen = true;
    n.classList.toggle("active", hit);
  });
  panels.forEach((p) => p.classList.toggle("active", p.dataset.sub === target));
  const panelsWrap = document.querySelector<HTMLElement>(".settings-modal-body > .settings-layout > .settings-panels");
  if (panelsWrap) panelsWrap.scrollTop = 0;
  // A deep link must POPULATE the panel too — an empty Billing page because
  // nobody clicked the tab is the same bug as not loading it.
  loadSettingsSub(target);
}

export function isSettingsModalOpen(): boolean {
  return !!document.getElementById("settings-modal");
}

export function closeSettingsModal(): void {
  // PLATFORM shell (web /platform): the settings surface IS the page — there
  // is nothing behind it to return to, so close is a no-op (the close button
  // and backdrop are CSS-hidden there too; this catches Esc and data-jump).
  if (document.body.classList.contains("platform-shell")) return;
  const overlay = document.getElementById("settings-modal");
  if (!overlay) return;
  document.removeEventListener("keydown", onSettingsModalKey, true);
  // Park every adopted section body (the whole-node sections) back into
  // its own hidden section FIRST, so the settings layout below doesn't carry
  // any of them back into the settings pen.
  for (const s of Object.keys(SETTINGS_SECTIONS)) parkSettingsSection(s);
  // Park the shared .settings-layout DOM back in its hidden section pen so its
  // ids stay unique and it's ready to be re-adopted next open.
  const layout = overlay.querySelector<HTMLElement>(".settings-modal-body > .settings-layout");
  if (layout && settingsHomePen) settingsHomePen.appendChild(layout);
  overlay.remove();
  // A Build / Customize page left up in the workbench borrows its pages back.
  rehostOpenGroups();
  if (settingsModalWebviewsGuarded) { guardWebviewsForModal(false); settingsModalWebviewsGuarded = false; }
  void (settingsModalHidePromise ?? Promise.resolve(false)).then(() => {
    restorePanelsForModal(settingsModalPanelsHidden);
    settingsModalPanelsHidden = false;
    settingsModalHidePromise = null;
    try { window.glyphh.panelsShow?.(); } catch { /* */ }
    // The wall came back with STALE geometry (clicks/zoom dead until a real
    // window resize) — run the stage's own resize repaint on the way out.
    try { (window as unknown as { __wbEchoRepaint?: () => void }).__wbEchoRepaint?.(); } catch { /* */ }
  });
}

function onSettingsModalKey(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  e.preventDefault();
  e.stopPropagation();
  // STAGED escape: fullscreen reverts to the normal size first; a second Esc
  // (or the X) closes the modal.
  const panel = document.querySelector<HTMLElement>(".settings-modal-panel.fullscreen");
  if (panel) {
    panel.classList.remove("fullscreen");
    const maxBtn = panel.querySelector<HTMLElement>(".settings-modal-max");
    if (maxBtn) {
      maxBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
      maxBtn.setAttribute("aria-label", "Expand settings to full screen");
    }
    return;
  }
  closeSettingsModal();
}

/** THE APP'S SETTINGS NAV SHAPE, idempotent (moves are moves; a row already
 *  in place stays). Runs when the modal opens AND when the Customize page
 *  builds its tabs (his report, 2026-10-05: the web's Build page listed
 *  Artifacts — the row sits in the group in settings.html and only moved
 *  under Settings once the modal had opened, so a group page built first
 *  listed it on either host). */
function arrangeAppSettingsNav(): void {
  // DESKTOP nav shape (his spec, 2026-08-25): the Settings group (General,
  // Appearance, Account, Voice, MCP Server), then an Organization group
  // holding Usage + Billing, and the user chip pinned at the rail's bottom.
  if (!document.body.classList.contains("platform-shell")) {
    const nav = document.querySelector<HTMLElement>(".settings-nav");
    const groups = Array.from(nav?.querySelectorAll(".settings-nav-group") ?? []);
    const settingsGroup = groups.find((g) => g.textContent?.trim() === "Settings");
    if (settingsGroup && nav) {
      let anchor: Element = settingsGroup;
      const pick = (sub: string): Element | null =>
        nav.querySelector(`.settings-nav-item.not-on-platform[data-sub="${sub}"]`) ?? nav.querySelector(`.settings-nav-item:not(.platform-only)[data-sub="${sub}"]`);
      // SETTINGS holds the app's own pages (his order, 2026-09-19): General,
      // Memory, Appearance, Account, Artifacts, Usage, MCP Server.
      // Appearance sits right under General (his order, 2026-09-20).
      // Connections lives in BUILD on both hosts (his order, 2026-10-05: the
      // web's Build page is the desktop's, tab for tab).
      for (const sub of ["general", "appearance", "memory", "privacy", "devices", "remote", "account", "artifacts", "usage", "mcp"]) {
        const item = pick(sub);
        if (item) { anchor.after(item); anchor = item; }
      }
      let orgGroup = nav.querySelector("#app-nav-group-org");
      if (!orgGroup) {
        orgGroup = document.createElement("div");
        orgGroup.id = "app-nav-group-org";
        orgGroup.className = "settings-nav-group";
        orgGroup.textContent = "Organization";
      }
      anchor.after(orgGroup);
      anchor = orgGroup;
      for (const sub of ["billing"]) {
        const item = pick(sub);
        if (item) { anchor.after(item); anchor = item; }
      }
      // A header with nothing under it is not drawn (his report, 2026-09-29):
      // Billing is its only item and is org_admin's alone.
      orgGroup.classList.toggle("hidden", !!document.getElementById("nav-billing")?.classList.contains("hidden"));
      // ONE CUSTOMIZE GROUP follows Organization (his report, 2026-10-07:
      // "The Build and Customize tabs are confusing. It should just be one
      // tab"): the Build rows and the Customize rows under one header, in
      // the page's tab order (surface.ts CUSTOMIZE_TAB_ORDER; artifacts
      // moved to Settings). groupTabs reads this group for the page's tabs.
      const customizeGroup = nav.querySelector("#nav-group-customize");
      if (customizeGroup) {
        anchor.after(customizeGroup);
        anchor = customizeGroup;
        for (const sub of CUSTOMIZE_TAB_ORDER) {
          const item = pick(sub);
          if (item) { anchor.after(item); anchor = item; }
        }
      }
      wireAppUserChip(nav as HTMLElement);
    }
  }

}

export function openSettingsModal(sub?: string): void {
  // Settings is another thing opened: Customize and Artifacts step aside (his order, 2026-10-09).
  (window as unknown as { __wbClosePagePanels?: () => void }).__wbClosePagePanels?.();
  // THE GROUP PAGE (his order, 2026-10-07): a Customize row is a tab of the
  // full-screen page on both surfaces, never a page of the modal — a deep
  // link, the + menu's Manage rows and every older caller land there.
  const group = sub ? groupOfSub(sub) : null;
  if (group && sub) { openGroupTab(group, sub); return; }
  // WEB (his rule, 2026-08-26, replacing 2026-08-21's redirect): app-web gets
  // the SAME settings modal as desktop. The platform page keeps its own
  // settings surface — the two are separate on purpose; never route the app's
  // gear to /platform.
  // Already open — just switch the sub-panel.
  // Desktop lands on General now — Account left the nav rail for the user
  // menu (his order, 2026-09-10), so it can't be the modal's landing row.
  // Platform LANDS on the Dashboard (his order, 2026-09-11) — not General.
  const defaultSub = document.body.classList.contains("platform-shell") ? "dash" : "general";
  if (isSettingsModalOpen()) { selectSettingsSub(sub || defaultSub); return; }
  // Pages a Build / Customize work-panel borrowed go home first: the modal
  // adopts the whole layout and every loader looks for them under it.
  returnGroupPanels();

  const layout = document.querySelector<HTMLElement>(
    ".help-section[data-section='settings'] > .settings-layout") ??
    document.querySelector<HTMLElement>(".settings-nav")?.closest<HTMLElement>(".settings-layout") ??
    null;
  if (!layout) return;
  // Remember where the layout lives so it can be parked back on close.
  settingsHomePen = layout.parentElement as HTMLElement | null;

  // Freeze the workbench's <webview> panels — they composite ABOVE page HTML in
  // Electron, so without this the modal renders underneath the open apps and
  // can't be seen or clicked. Same guard the confirm/prompt modals use. The
  // capture-based freeze-frame is a best-effort extra for any legacy panels.
  guardWebviewsForModal(true);
  settingsModalWebviewsGuarded = true;
  // SEQUENCED, not fire-and-forget: a fast open→close raced panelsHide past
  // panelsShow, leaving every zoomed-up panel hidden ("settings killed the
  // command center"). Close awaits this promise before restoring.
  settingsModalHidePromise = hidePanelsForModal().then((hidden) => { settingsModalPanelsHidden = hidden; return hidden; });

  const overlay = document.createElement("div");
  overlay.id = "settings-modal";
  overlay.className = "yo-modal yo-settings-modal";

  const backdrop = document.createElement("div");
  backdrop.className = "yo-modal-backdrop";
  backdrop.addEventListener("click", () => closeSettingsModal());

  const panel = document.createElement("div");
  panel.className = "yo-modal-panel settings-modal-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Settings");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "settings-modal-close";
  closeBtn.setAttribute("aria-label", "Close settings");
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.addEventListener("click", () => closeSettingsModal());

  // Expand / collapse — toggles the panel between its normal size and full
  // screen (see .settings-modal-panel.fullscreen). Session-local by design:
  // nothing is persisted, and closing the modal (which removes the overlay)
  // resets it. The side-by-side editors are %/flex based, so they simply get
  // the extra room.
  const EXPAND_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
  const COLLAPSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
  const maxBtn = document.createElement("button");
  maxBtn.type = "button";
  maxBtn.className = "settings-modal-close settings-modal-max";
  maxBtn.setAttribute("aria-label", "Expand settings to full screen");
  maxBtn.innerHTML = EXPAND_SVG;
  maxBtn.addEventListener("click", () => {
    const full = panel.classList.toggle("fullscreen");
    maxBtn.innerHTML = full ? COLLAPSE_SVG : EXPAND_SVG;
    maxBtn.setAttribute("aria-label", full ? "Exit full screen" : "Expand settings to full screen");
  });

  const body = document.createElement("div");
  body.className = "settings-modal-body";
  // Adopt the real two-column layout — same nodes, so every loader + the
  // admin-only nav gating keep working exactly as before.
  body.appendChild(layout);

  panel.appendChild(maxBtn);
  panel.appendChild(closeBtn);
  panel.appendChild(body);
  overlay.appendChild(backdrop);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  document.addEventListener("keydown", onSettingsModalKey, true);

  arrangeAppSettingsNav();

  // RAIL SEARCH (app only; his spec, 2026-08-24): type → a popup under the
  // box lists matching sections and individual settings; clicking opens the
  // section. Index = visible nav labels + each panel's row/label titles.
  if (!document.body.classList.contains("platform-shell")) {
    const input = overlay.querySelector<HTMLInputElement>("#settings-nav-search");
    const pop = overlay.querySelector<HTMLElement>("#settings-nav-search-pop");
    if (input && pop && !input.dataset.wired) {
      input.dataset.wired = "1";
      const index = (): Array<{ label: string; sub: string; section: string }> => {
        const out: Array<{ label: string; sub: string; section: string }> = [];
        overlay.querySelectorAll<HTMLElement>(".settings-nav-item").forEach((b) => {
          if (getComputedStyle(b).display === "none") return;
          const sub = b.dataset.sub || "";
          const label = b.textContent?.trim() || "";
          if (sub && label) out.push({ label, sub, section: label });
        });
        overlay.querySelectorAll<HTMLElement>(".settings-panel").forEach((panel) => {
          const sub = panel.dataset.sub || "";
          const navBtn = overlay.querySelector<HTMLElement>(`.settings-nav-item[data-sub="${sub}"]`);
          if (!sub || !navBtn || getComputedStyle(navBtn).display === "none") return;
          const section = navBtn.textContent?.trim() || sub;
          panel.querySelectorAll<HTMLElement>(".set-pref-title, .settings-label, .settings-subheading, .acct-row-head").forEach((t) => {
            const label = (t.childNodes[0]?.textContent || t.textContent || "").trim();
            if (label && label.length > 1) out.push({ label, sub, section });
          });
        });
        return out;
      };
      const render = (): void => {
        const q = input.value.trim().toLowerCase();
        pop.textContent = "";
        if (!q) { pop.classList.add("hidden"); return; }
        const hits = index().filter((e) => e.label.toLowerCase().includes(q));
        const seen = new Set<string>();
        const top = hits.filter((e) => {
          const k = `${e.sub}:${e.label.toLowerCase()}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }).slice(0, 10);
        if (!top.length) {
          const empty = document.createElement("div");
          empty.className = "pop-empty";
          empty.textContent = "No settings match.";
          pop.appendChild(empty);
        }
        for (const e of top) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = e.label;
          if (e.section && e.section !== e.label) {
            const sub = document.createElement("span");
            sub.className = "pop-sub";
            sub.textContent = e.section;
            b.appendChild(sub);
          }
          b.addEventListener("click", () => {
            pop.classList.add("hidden");
            input.value = "";
            selectSettingsSub(e.sub);
          });
          pop.appendChild(b);
        }
        pop.classList.remove("hidden");
      };
      input.addEventListener("input", render);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { pop.classList.add("hidden"); input.value = ""; }
        if (e.key === "Enter") (pop.querySelector("button") as HTMLElement | null)?.click();
      });
      document.addEventListener("click", (e) => {
        if (!(e.target as HTMLElement).closest("#settings-nav-search-wrap")) pop.classList.add("hidden");
      });
    }
  }

  // Populate the whole panel set + admin gating, then reveal the requested sub.
  loadSettings();
  gateAdminSubs();
  initOrgSwitcher();
  initCollapsibleNavGroups();
  selectSettingsSub(sub || (document.body.classList.contains("platform-shell") ? "dash" : "account"));
}

// ── Collapsible rail sections (his order, 2026-09-02, PLATFORM only) ─────────
// Every .settings-nav-group header toggles the items under it. Organization
// stays open by default; everything else starts collapsed. The preference
// follows the USER server-side (ui-state — zero-local-storage law), so the
// rail looks the same on every device.
const NAV_COLLAPSE_KEY = "platformNavCollapsed";
let navGroupsWired = false;

function navGroupKey(el: HTMLElement): string {
  return (el.textContent || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "group";
}

/** The items a group owns: every sibling until the next group header. */
function navGroupItems(group: HTMLElement): HTMLElement[] {
  const items: HTMLElement[] = [];
  for (let el = group.nextElementSibling; el && !el.classList.contains("settings-nav-group"); el = el.nextElementSibling) {
    items.push(el as HTMLElement);
  }
  return items;
}

function initCollapsibleNavGroups(): void {
  if (!document.body.classList.contains("platform-shell") || navGroupsWired) return;
  navGroupsWired = true;
  const nav = document.querySelector<HTMLElement>(".settings-nav");
  if (!nav) return;
  const groups = Array.from(nav.querySelectorAll<HTMLElement>(".settings-nav-group"));
  const apply = (group: HTMLElement, collapsed: boolean): void => {
    group.classList.toggle("nav-group-closed", collapsed);
    for (const item of navGroupItems(group)) item.classList.toggle("nav-collapsed", collapsed);
  };
  const readMap = (): Record<string, boolean> => {
    try { return JSON.parse(uiStateGet(NAV_COLLAPSE_KEY) || "{}") as Record<string, boolean>; } catch { return {}; }
  };
  for (const group of groups) {
    group.classList.add("nav-group-collapsible");
    group.addEventListener("click", () => {
      const collapsed = !group.classList.contains("nav-group-closed");
      apply(group, collapsed);
      const map = readMap();
      map[navGroupKey(group)] = collapsed;
      uiStateSet(NAV_COLLAPSE_KEY, JSON.stringify(map));
    });
  }
  // Initial state once the server pref is in memory: the user's map, else the
  // default — Organization open, everything else closed.
  void loadUiState().then(() => {
    const map = readMap();
    for (const group of groups) {
      const key = navGroupKey(group);
      const collapsed = key in map ? !!map[key] : key !== "organization";
      apply(group, collapsed);
    }
  });
}

/** Hide the admin-only surfaces for non-admins on modal open — the SAME rule
 *  Members/Workspaces use (their own loaders gate on the eager loadSettings()
 *  call). The old Organization/Runtime/Guardrails TABS live as groups on
 *  Billing/General now, so the gate toggles those groups instead of nav
 *  entries. Each loader re-asserts the gate + the admin-only body message. */
/** The DESKTOP settings rail's user chip — bottom-left, like the platform's:
 *  avatar initial, first name, plan; clicking opens Account. */
function wireAppUserChip(nav: HTMLElement): void {
  // THE CHIP IS THE RAIL'S FOOTER (his report, 2026-10-03: it sat above Support,
  // floating over the groups as they scrolled under it). The groups scroll in
  // a list of their own; the search box stays at the top and the chip at the
  // very bottom, outside the scroll, so nothing is ever drawn beneath it.
  let list = nav.querySelector<HTMLElement>("#app-settings-nav-list");
  if (!list) {
    list = document.createElement("div");
    list.id = "app-settings-nav-list";
    list.className = "settings-nav-list";
    for (const el of Array.from(nav.children)) {
      if (el.id !== "settings-nav-search-wrap") list.appendChild(el);
    }
    nav.appendChild(list);
  }
  let chip = nav.querySelector<HTMLButtonElement>("#app-settings-user");
  if (!chip) {
    chip = document.createElement("button");
    chip.id = "app-settings-user";
    chip.type = "button";
    chip.innerHTML = `<span class="asu-avatar"></span><span class="asu-meta"><span class="asu-name">—</span><span class="asu-plan"></span></span>`;
    const menu = document.createElement("div");
    menu.id = "app-settings-user-menu";
    menu.className = "hidden";
    menu.setAttribute("role", "menu");
    buildUserMenuInto(menu, (sub) => {
      // Route through the (possibly hidden) nav rows so panel switching stays
      // the one existing path — same trick the platform chip uses. Account's
      // row is hidden (the menu owns it), but a hidden row still takes the
      // programmatic click.
      nav.querySelector<HTMLElement>(`.settings-nav-item[data-sub="${sub}"]`)?.click();
    }, () => menu.classList.add("hidden"), true);
    chip.addEventListener("click", (ev) => {
      ev.stopPropagation();
      menu.classList.toggle("hidden");
    });
    document.addEventListener("click", () => menu.classList.add("hidden"));
    nav.appendChild(menu);
    nav.appendChild(chip);
  }
  const paintChip = (info: { email?: string; firstName?: string; tier?: string } | null): void => {
    if (!info || !chip) return;
    const name = (info.firstName || info.email || "").trim();
    const face = chip.querySelector(".asu-avatar") as HTMLElement;
    const avatar = (info as { avatarUrl?: string }).avatarUrl || "";
    if (avatar) {
      face.innerHTML = "";
      const img = document.createElement("img");
      img.alt = "";
      // A dead URL falls back to the initial rather than a broken-image glyph.
      img.addEventListener("error", () => { face.textContent = (name || "?").charAt(0).toUpperCase(); });
      img.src = avatar;
      face.appendChild(img);
    } else {
      face.textContent = (name || "?").charAt(0).toUpperCase();
    }
    (chip.querySelector(".asu-name") as HTMLElement).textContent = name || "—";
    const tier = (info.tier || "none");
    // A member sees their organization here, not its plan (his order, 2026-09-29).
    const role = (info as { role?: string }).role;
    const admin = !!role && ["org_admin", "super_admin"].includes(role);
    (chip.querySelector(".asu-plan") as HTMLElement).textContent = !admin
      ? String((info as { orgName?: string }).orgName || "")
      : tier === "none" || tier === "free" ? "Free plan" : `${tier.charAt(0).toUpperCase()}${tier.slice(1)} plan`;
  };
  void Promise.resolve(window.glyphh.getAccountInfo?.()).then(paintChip).catch(() => { /* signed out — the dash stays */ });
  // RE-PAINT on every account refresh (his report, 2026-09-01: a first paint
  // that raced the account cache — or a freshly uploaded avatar — left the
  // initial sitting here for the whole run).
  window.glyphh.onAccountUpdated?.(paintChip);
}

function gateAdminSubs(): void {
  void window.glyphh.getAccountInfo?.().then((info) => {
    // The mid-tier 'admin' is "org_admin minus Billing" (his spec, 2026-09-02):
    // every org surface admits admins; only the money door stays org_admin's.
    const orgAdmin = !!info?.role && ["org_admin", "super_admin"].includes(info.role);
    const admin = orgAdmin || info?.role === "admin";
    document.getElementById("nav-org-general")?.classList.toggle("hidden", !admin);
    // The LIBRARY is the admin's curation surface (his ruling, 2026-09-12) —
    // members meet the library through Marketplace/installs, never this door.
    document.getElementById("nav-org-library")?.classList.toggle("hidden", !admin);
    // SECURITY and GATEWAY are admin groups too (his ruling, 2026-09-12) —
    // the whole cluster (headers + items) rides one class, like nav-super.
    // The server enforces the role on every route regardless.
    settingsNavOwn<HTMLElement>(".nav-admin").forEach((el) => el.classList.toggle("hidden", !admin));
    // BILLING IS THE MONEY DOOR and it is org_admin's alone, on every surface
    // (his order, 2026-09-17: a member of an org should not see it in the app
    // either). Someone who signed up alone is org_admin of their own org, so
    // they keep it; an invited member does not. The server 403s the reads
    // regardless — this hides the door.
    document.getElementById("nav-billing")?.classList.toggle("hidden", !orgAdmin);
    document.getElementById("app-nav-group-org")?.classList.toggle("hidden", !orgAdmin);
    // The Platform group (the super-admin console — Catalog / Plans / Usage /
    // Orgs) is a TIER above the org-admin gate: super_admin only. The server
    // enforces the role on every route regardless — this only hides the nav.
    // The platform axis is the REAL gate (bootstrap seeds the admin as an
    // org_admin member with is_platform_admin=true); role kept as fallback.
    const superAdmin = (info as { isPlatformAdmin?: boolean } | null)?.isPlatformAdmin === true || info?.role === "super_admin";
    settingsNavOwn<HTMLElement>(".nav-super").forEach((el) => el.classList.toggle("hidden", !superAdmin));
    paintImpersonationBanner(info as { orgName?: string; impersonatingOrgId?: string | null } | null);
  }).catch(() => { /* signed out — items stay hidden (they start hidden) */ });
}

/**
 * The ORG SWITCHER (multi-org membership, his order 2026-09-02): a member of
 * two-plus orgs gets a workspace dropdown — platform rail top-left and the
 * Settings nav — that re-pins THIS session's active org server-side and
 * reloads. Single-org members never see it; there is no forced picker (the
 * session defaults to the member's default/first org).
 */
export function initOrgSwitcher(): void {
  void (async () => {
    type Membership = { orgId: string; orgName: string; role: string; active: boolean };
    // SDK first (web — window.glyphh is a fabricating proxy there), IPC on desktop.
    const sdk = (window as unknown as { glyphhSdk?: { memberships?: { orgs?: () => Promise<Membership[]>; setActiveOrg?: (id: string) => Promise<unknown> } } }).glyphhSdk?.memberships;
    const ipc = window.glyphh as unknown as { orgMemberships?: () => Promise<Membership[]>; orgSwitch?: (id: string) => Promise<{ ok: boolean; error?: string }> };
    let list: Membership[] = [];
    try { list = (sdk?.orgs ? await sdk.orgs() : await ipc.orgMemberships?.()) ?? []; }
    catch { return; /* signed out / no seam — no switcher */ }
    if (list.length < 2) return;

    const paint = (host: HTMLElement): void => {
      host.classList.remove("hidden");
      host.innerHTML = "";
      const sel = document.createElement("select");
      // Self-owned styling — settings-input's global margins fought the nav's
      // flow and overlapped the first item (his report, 2026-09-02).
      sel.className = "org-switch-select";
      sel.title = "Switch organization";
      for (const m of list) {
        const opt = document.createElement("option");
        opt.value = m.orgId;
        opt.textContent = m.orgName;
        opt.selected = m.active;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => {
        void (async () => {
          sel.disabled = true;
          try {
            if (sdk?.setActiveOrg) await sdk.setActiveOrg(sel.value);
            else {
              const r = await ipc.orgSwitch?.(sel.value);
              if (r && !r.ok) throw new Error(r.error || "switch failed");
            }
            // Scope changed server-side — a full reload repaints every surface
            // (sessions, apps, settings) as the newly active org.
            window.location.reload();
          } catch {
            sel.disabled = false;
            sel.value = list.find((m) => m.active)?.orgId ?? sel.value;
          }
        })();
      });
      host.appendChild(sel);
    };
    for (const id of ["org-switch-rail", "org-switch-settings"]) {
      const host = document.getElementById(id);
      if (host) paint(host);
    }
  })();
}

/**
 * The IMPERSONATION banner (scoped-membership epic, his order 2026-09-01):
 * while a platform admin rides another org, EVERY surface shows a loud fixed
 * red bar naming where they are, with the way back. The session scope is
 * server-side, so stopping + a reload restores their real org everywhere.
 */
function paintImpersonationBanner(info: { orgName?: string; impersonatingOrgId?: string | null } | null): void {
  document.getElementById("impersonation-banner")?.remove();
  if (!info?.impersonatingOrgId) return;
  const bar = document.createElement("div");
  bar.id = "impersonation-banner";
  bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:100000;display:flex;align-items:center;justify-content:center;gap:12px;padding:9px 16px;background:#b91c1c;color:#fff;font-size:13px;font-weight:600;box-shadow:0 -2px 10px rgba(0,0,0,.35);";
  const label = document.createElement("span");
  label.textContent = `You are impersonating ${info.orgName || "another organization"} — everything you do here acts as its admin.`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "action-btn";
  btn.textContent = "Stop impersonating";
  btn.style.cssText = "background:#fff;color:#b91c1c;border-color:#fff;font-weight:700;";
  btn.addEventListener("click", () => {
    void (async () => {
      btn.disabled = true;
      // SDK first (web — window.glyphh is a fabricating proxy there), IPC on desktop.
      const sdk = (window as unknown as { glyphhSdk?: { admin?: { stopImpersonate?: () => Promise<unknown> } } }).glyphhSdk?.admin;
      try {
        if (sdk?.stopImpersonate) await sdk.stopImpersonate();
        else await (window.glyphh as unknown as { adminImpersonate?: (o: null) => Promise<unknown> }).adminImpersonate?.(null);
      } catch { /* the reload below re-reads the true scope either way */ }
      window.location.reload();
    })();
  });
  bar.append(label, btn);
  document.body.appendChild(bar);
}

/**
 * Retired sub-panels, pointed at wherever they went. A saved nav app or a
 * remembered `homeLastSub` that names "organization" must still land somewhere
 * — without this, every nav item and panel deactivates and Settings opens
 * blank.
 */
const SETTINGS_SUB_ALIAS: Record<string, string> = {
  // "Customize" (the rail's app-settings entry) opens the modal on Appearance —
  // the app-level customization panel (themes, browser). General/Appearance/
  // Drips/Desktop/MCP are the app-config subs; Appearance is the natural anchor.
  app: "appearance",
  // Organization / Runtime / Guardrails retired as tabs — Organization is
  // now Organization › General; Runtime + Guardrails live on General (the
  // Sessions group and the folded Guardrails group).
  organization: "org-general",
  runtime: "general",
  guardrails: "general",
  // Apps and tasks are skills with a type now (2026-09-17) — their tabs are
  // hidden and every link to them lands on Skills, which lists them.
  apps: "skills",
  tasks: "skills",
};

/** Retired top-level sections, redirected to the Settings sub-panel that
 *  absorbed them — a rail item or `homeLastSection` naming "models" must not
 *  open a section that no longer exists. */
const SECTION_ALIAS: Record<string, { section: string; sub: string }> = {
  models: { section: "settings", sub: "general" },
};
const settingsSubAlias = (sub: string): string => {
  const target = SETTINGS_SUB_ALIAS[sub] || sub;
  // MCP shows EVERYWHERE (his order, 2026-08-25). General/Voice/Appearance
  // hide only on the platform. Every DESKTOP-ONLY sub (web-surface.ts
  // DESKTOP_ONLY_SUBS: plugins, remote control, and since the web cut of
  // 2026-10-05 the whole Build and Customize groups) lands on General on
  // web; its nav item + panel are CSS-hidden there.
  if (onWeb() && DESKTOP_ONLY_SUBS.has(target)) {
    return document.body.classList.contains("platform-shell") ? "dash" : "general";
  }
  if ((target === "voice" || target === "appearance" || target === "general") && document.body.classList.contains("platform-shell")) return "org-general";
  return target;
};

/** Settings sub-panels that fetch on show. Shared by the sub-nav click handler
 *  and gotoSection's deep-link path so both populate identically. */
function loadSettingsSub(sub: string): void {
  // THE PURGE: the settings shell is the minimal platform — account, org,
  // members, billing (the license), apps, download, support, docs,
  // and the super-admin Plans/Orgs console.
  if (sub === "dash") { paintDashGreeting(); void loadUsageChart(); void loadUsageMetrics(); void loadUsageMembers(); }
  else if (sub === "mcp") loadMcp();
  else if (sub === "support") void loadSupportPanel();
  else if (sub === "about") loadAbout();
  else if (sub === "billing") void loadBilling();
  else if (sub === "workspaces") void loadWorkspacesPanel();
  else if (sub === "org-library") loadOrgLibrary();
  else if (sub === "connections-cfg") void loadSettingsConnections();
  else if (sub === "skills") void loadSkillsSettings();
  else if (sub === "agents") void loadAgentsSettings();
  else if (sub === "apps") void loadAppsSettings();
  else if (sub === "plugins") void loadPluginsSettings();
  else if (sub === "tasks") void loadTasksSettings();
  else if (sub === "gateway") void loadGatewayMetrics();
  else if (sub === "gateway-keys") void loadGatewayKeys();
  else if (sub === "oauth") { initOAuth(); void loadOAuth(); }
  else if (sub === "connections") { mountSettingsSection("connections"); void loadConnections(); }
  else if (sub === "usage") { void loadUsageAppView(); void loadUsageChart(); void loadUsageMetrics(); void loadUsageMembers(); }
  // Organization › General — the org record page (admin-gated nav).
  else if (sub === "org-general") void loadOrgPanel();
  else if (sub === "account") void loadProfile();
  else if (sub === "members") void loadMembers();
  // The Platform group — the super-admin console (settings-admin.ts). Each
  // loader re-checks the role and paints an honest gate; the server enforces.
  else if (sub === "padmin-models") loadAdminModels();
  else if (sub === "padmin-plans") loadAdminPlans();
  else if (sub === "padmin-usage") loadAdminUsage();
  else if (sub === "padmin-orgs") loadAdminOrgs();
  else if (sub === "download") void loadDownload();
  else if (sub === "memory" || sub === "privacy") void loadMemorySettings();
  else if (sub === "remote") void loadRemoteControl();
  else if (sub === "devices") { initDevices(); void loadDevices(); }
  // The installer is a terminal panel, not a settings page: open it and step aside.
  // Artifacts adopts the FILES section (the gallery page) — same page, second door.
  else if (sub === "artifacts") { mountSettingsSection("files"); void loadFiles(); }
}

// ── The Customize work-panel ──────────────────────────────────────────────
//
// The Settings GROUP (the nav's Customize rows) opens as ONE workbench page
// with the group's pages as tabs (his order, 2026-09-20: "the same settings
// pages, just tabs, bigger"; one page since his report, 2026-10-07: "The
// Build and Customize tabs are confusing. It should just be one tab").
// Move-not-clone, like the modal: the .settings-panel nodes are MOVED from
// .settings-panels into the page's own .settings-panels (inside a
// .settings-modal-body host, so every modal rule applies verbatim) and moved
// back the moment the modal opens. The tab list is read from the nav group
// itself, so role gating (hidden rows) carries over.

/** The .settings-panels pen each borrowed panel came from, by sub. */
const groupPanelPen: Record<string, HTMLElement | null> = {};
/** The tab each group last showed, so reopening lands where the user was —
 *  remembered across launches as the `customizeLastSub` pref (his report,
 *  2026-10-07: "switching it should stay"). */
const groupLastSub: Record<string, string> = {};
const LAST_SUB_PREF = "customizeLastSub";
/** ONE Yours | Discover SWITCH FOR THE WHOLE PAGE (his report, 2026-10-07:
 *  "instead of each tab having a different Yours / Discover it should span
 *  all the tabs and switching it should stay"): the scope every tab shows
 *  under, remembered as the `customizeScope` pref. */
type GroupScope = "mine" | "discover";
let groupScope: GroupScope = "mine";
const SCOPE_PREF = "customizeScope";
const asScope = (v: unknown): GroupScope => (v === "discover" ? "discover" : "mine");

/** Read both prefs once at init, before any door opens the page (the same
 *  door every other remembered pref uses: window.glyphh.getPreference, served
 *  by the preload on the desktop and the bridge on the web). */
function primeGroupPrefs(): void {
  // A page asking for the other scope by itself (the directory's
  // "Connections" crumb in settings-connections.ts) flips the one switch.
  document.addEventListener("glyphh:customize-scope", (ev) => setGroupScope(asScope((ev as CustomEvent).detail)));
  void window.glyphh.getPreference?.(SCOPE_PREF, "mine").then((v) => { groupScope = asScope(v); }).catch(() => {});
  void window.glyphh.getPreference?.(LAST_SUB_PREF, "").then((v) => {
    const sub = typeof v === "string" ? v : "";
    if (sub && !groupLastSub.customize) groupLastSub.customize = sub;
  }).catch(() => {});
}

/** Hand the scope to the page a tab shows: the library pages and Connections
 *  carry a Discover half; every other tab shows the empty state below.
 *  `force` is the switch's own click (Yours leaves a secondary tab such as
 *  Updates for the list); a tab switch only applies the scope. */
function applyScopeTo(sub: string, scope: GroupScope, force: boolean): void {
  if (setLibraryScope(sub, scope, force)) return;
  if (sub === "connections-cfg") setConnectionsScope(scope);
}

/** The inline empty state a tab without a Discover half shows under
 *  Discover — the switch stays live, the tab says there is nothing to find. */
function paintNoDiscover(host: HTMLElement | null, sub: string, label: string, scope: GroupScope): void {
  const panel = host?.querySelector<HTMLElement>(`:scope > .settings-panel[data-sub="${sub}"]`);
  if (!panel) return;
  const bare = scope === "discover" && !subHasDiscover(sub);
  panel.classList.toggle("scope-discover-empty", bare);
  let note = panel.querySelector<HTMLElement>(":scope > .settings-group-nodiscover");
  if (!bare) { note?.remove(); return; }
  if (!note) {
    note = document.createElement("div");
    note.className = "crud-empty settings-group-nodiscover";
    panel.prepend(note);
  }
  note.textContent = `Nothing to discover for ${label} yet.`;
}

/** Set the page's scope — the switch's click, or a door that wants Discover
 *  (the composer's "Add connector"). Persists when it changed, repaints the
 *  switch and, with the page open, re-shows the current tab under the scope
 *  (a Yours click on Updates returns to the list, so the switch is never a
 *  dead button). */
export function setGroupScope(scope: GroupScope): void {
  if (groupScope !== scope) void window.glyphh.setPreference?.(SCOPE_PREF, scope);
  groupScope = scope;
  document.querySelectorAll<HTMLElement>(".settings-group-scope > .skills-tab").forEach((b) => b.classList.toggle("active", b.dataset.scope === scope));
  const sec = document.querySelector<HTMLElement>(`.help-section.settings-group[data-section="customize"]`);
  const shown = sec?.querySelector<HTMLElement>(".settings-group-tabs > .skills-tab.active")?.dataset.sub;
  if (sec && shown && sec.classList.contains("active")) showGroupTab("customize", shown, true);
}

function groupTabs(group: string): Array<{ sub: string; label: string }> {
  const head = document.getElementById(`nav-group-${group}`);
  const out: Array<{ sub: string; label: string }> = [];
  // ONE RULE ON BOTH HOSTS (his order, 2026-10-05: "why is the web build tab
  // different than the desktop one?"): the tabs are the group's nav rows that
  // are not `.hidden`. The web cut marks its rows WEB_CUT_ROW_CLASS, never
  // `.hidden` (web-surface.ts), so the web page lists exactly the desktop's.
  for (let el = head?.nextElementSibling; el && !el.classList.contains("settings-nav-group"); el = el.nextElementSibling) {
    const b = el as HTMLElement;
    const sub = b.dataset.sub;
    if (!sub || b.classList.contains("hidden")) continue;
    out.push({ sub, label: b.querySelector("span")?.textContent?.trim() || sub });
  }
  return out;
}

/** Build (or refresh) the group page: tabs from its nav rows, panels adopted,
 *  the one scope switch wired once. */
export function loadSettingsGroup(group: string): void {
  const sec = document.querySelector<HTMLElement>(`.help-section.settings-group[data-section="${group}"]`);
  const strip = sec?.querySelector<HTMLElement>(".settings-group-tabs");
  const host = sec?.querySelector<HTMLElement>(".settings-group-host > .settings-panels");
  if (!sec || !strip || !host) return;
  arrangeAppSettingsNav();
  const tabs = groupTabs(group);
  if (!tabs.length) { host.innerHTML = `<div class="ws-empty">Nothing to show here yet.</div>`; return; }
  const scopeStrip = sec.querySelector<HTMLElement>(".settings-group-scope");
  if (scopeStrip && !scopeStrip.dataset.wired) {
    scopeStrip.dataset.wired = "1";
    scopeStrip.querySelectorAll<HTMLButtonElement>(".skills-tab[data-scope]").forEach((b) => b.addEventListener("click", () => setGroupScope(asScope(b.dataset.scope))));
  }
  scopeStrip?.querySelectorAll<HTMLElement>(".skills-tab").forEach((b) => b.classList.toggle("active", b.dataset.scope === groupScope));
  strip.innerHTML = "";
  for (const t of tabs) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "skills-tab";
    b.dataset.sub = t.sub;
    b.setAttribute("role", "tab");
    b.textContent = t.label;
    b.addEventListener("click", () => showGroupTab(group, t.sub));
    strip.appendChild(b);
    const panel = document.querySelector<HTMLElement>(`.settings-panel[data-sub="${t.sub}"]`);
    if (panel && panel.parentElement !== host) {
      groupPanelPen[t.sub] ||= panel.parentElement as HTMLElement | null;
      host.appendChild(panel);
    }
  }
  const want = groupLastSub[group];
  showGroupTab(group, tabs.some((t) => t.sub === want) ? want : tabs[0].sub);
}

/** Open the Customize page AT a tab — the composer's `+` menu "Manage skills
 *  / connectors", a deep link, the app card's Publish. The tab is remembered
 *  first so a fresh mount lands on it (loadSettingsGroup shows it); an
 *  already-open page just switches. Whether the page was painted is read
 *  BEFORE the open (his report, 2026-10-07: a fresh mount painted the tab
 *  through loadSettingsGroup and then showed it a second time). */
export function openGroupTab(group: GroupPage, sub: string): void {
  groupLastSub[group] = sub;
  const painted = !!document.querySelector<HTMLElement>(`.help-section.settings-group[data-section="${group}"] .settings-group-tabs > .skills-tab[data-sub="${sub}"]`);
  (window as unknown as { __wbOpenSection?: (s: string) => void }).__wbOpenSection?.(group);
  if (painted) showGroupTab(group, sub);
}

/** THE PAGE'S ONE TOOLBAR (his order, 2026-10-09: "make the header of the
 *  customize tab look more like this", Claude's Customize: tabs, Yours |
 *  Discover, then search / filter / sort / Add on one row right above the
 *  list). The shown tab LENDS its own controls to the head's right end —
 *  the same nodes, listeners and ids intact — and gets them back on the
 *  next tab, or before its panel returns to the Settings modal. */
let lentTools: Array<{ el: HTMLElement; parent: HTMLElement; next: Node | null }> = [];
// The workbench hands lent tools home before a section leaves for its own page.
(window as unknown as { __glyphhReturnGroupTools?: () => void }).__glyphhReturnGroupTools = () => returnGroupTools();
function returnGroupTools(): void {
  for (const t of lentTools.reverse()) {
    try { t.parent.insertBefore(t.el, t.next && t.next.parentNode === t.parent ? t.next : null); } catch { /* origin gone with its panel */ }
  }
  lentTools = [];
}
function adoptGroupTools(sec: HTMLElement, panel: HTMLElement | null): void {
  returnGroupTools();
  const slot = sec.querySelector<HTMLElement>(".settings-group-tools");
  if (!slot || !panel) return;
  const head = panel.querySelector<HTMLElement>(".skills-head");
  const after = head?.nextElementSibling as HTMLElement | null;
  const row = after?.classList.contains("skills-tabs") ? after : null;
  const lend: HTMLElement[] = [];
  const search = head?.querySelector<HTMLElement>(":scope > .skills-search");
  if (search) lend.push(search);
  row?.querySelectorAll<HTMLElement>(":scope > .skills-pill").forEach((p) => lend.push(p));
  const actions = head?.querySelector<HTMLElement>(":scope > .skills-head-actions");
  if (actions) lend.push(actions);
  else head?.querySelectorAll<HTMLElement>(":scope > button").forEach((b) => lend.push(b));
  for (const el of lend) {
    if (!el.parentElement) continue;
    lentTools.push({ el, parent: el.parentElement, next: el.nextSibling });
    // An icon-only pill keeps its words as the tooltip.
    if (el.classList.contains("skills-pill")) el.title = el.querySelector("span")?.textContent?.trim() || el.title;
    slot.appendChild(el);
  }
}

function showGroupTab(group: string, sub: string, forceScope = false): void {
  const sec = document.querySelector<HTMLElement>(`.help-section.settings-group[data-section="${group}"]`);
  if (!sec) return;
  if (groupLastSub[group] !== sub) void window.glyphh.setPreference?.(LAST_SUB_PREF, sub);
  groupLastSub[group] = sub;
  sec.querySelectorAll<HTMLElement>(".settings-group-tabs > .skills-tab").forEach((b) => b.classList.toggle("active", b.dataset.sub === sub));
  const host = sec.querySelector<HTMLElement>(".settings-group-host > .settings-panels");
  host?.querySelectorAll<HTMLElement>(":scope > .settings-panel").forEach((p) => p.classList.toggle("active", p.dataset.sub === sub));
  if (host) host.scrollTop = 0;
  returnGroupTools();
  // The page's one scope reaches the tab before it loads, so the tab paints
  // straight into Yours or Discover (his report, 2026-10-07).
  applyScopeTo(sub, groupScope, forceScope);
  loadSettingsSub(sub);
  // After the load: a section tab (Schedules) is mounted by it, so its tools exist now.
  adoptGroupTools(sec, host?.querySelector<HTMLElement>(`:scope > .settings-panel[data-sub="${sub}"]`) ?? null);
  const label = sec.querySelector<HTMLElement>(`.settings-group-tabs > .skills-tab[data-sub="${sub}"]`)?.textContent?.trim() || sub;
  paintNoDiscover(host ?? null, sub, label, groupScope);
}

/**
 * Every borrowed panel goes back to its .settings-panels pen.
 *
 * THE CYCLE (his report, 2026-09-25: "when customize from the left rail is
 * opened the settings panel will never open again"). A group's panel can be a
 * host for a WHOLE adopted section — #settings-tabs-host holds the apps
 * section — and that section is an ancestor of the entire settings layout,
 * pen included. So by the time we try `pen.appendChild(panel)`, the pen sits
 * INSIDE the panel, and the DOM refuses:
 *
 *   HierarchyRequestError: The new child element contains the parent.
 *
 * openSettingsModal calls this FIRST, so the throw escaped before the overlay
 * was ever built — settings stopped opening, permanently, with no visible
 * error. Unmounting the adopted sections first breaks the cycle; the
 * try/catch is the belt-and-braces guarantee that one bad node can never
 * again cost the user their settings.
 */
function returnGroupPanels(): void {
  returnGroupTools();   // a lent search / Add goes home with its panel
  // Park adopted sections BEFORE moving their hosts: a section mounted into a
  // group panel makes that panel an ancestor of the pen it must return to.
  for (const s of Object.keys(SETTINGS_SECTIONS)) parkSettingsSection(s);
  for (const sub of Object.keys(groupPanelPen)) {
    const pen = groupPanelPen[sub];
    const panel = document.querySelector<HTMLElement>(`.settings-group-host .settings-panel[data-sub="${sub}"]`);
    if (!panel || !pen) continue;
    // Still cyclic (an adopted node we don't own)? Skip this one panel rather
    // than take the whole settings surface down with it.
    if (panel.contains(pen)) continue;
    panel.classList.remove("active");
    try { pen.appendChild(panel); } catch { /* leave it where it is */ }
  }
}

/** A group page still up in the workbench after the modal closes gets its
 *  panels back, so it never sits empty. */
function rehostOpenGroups(): void {
  document.querySelectorAll<HTMLElement>(".help-section.settings-group.wb-hosted").forEach((sec) => {
    const g = sec.dataset.section;
    if (g) loadSettingsGroup(g);
  });
}

// ── Whole-section in-modal adoption (A2 apps/connections, A3 loops/skills/
//    agents) ────────────
//
// Move-not-clone discipline. These layouts are styled through selectors scoped to
// `.help-section[data-section=X]` and its DIRECT children — so moving only the
// children out would break those rules. Instead the WHOLE `.help-section` node
// is moved into the panel host and given `.active` (so its full-height flex +
// detail-pane CSS still applies), then parked straight back into #page-body on
// close. Its `data-section` never triggers the workbench, since nothing routes
// these sections there anymore.
const SETTINGS_SECTIONS: Record<string, { host: string; section?: string }> = {
  files: { host: "settings-files-host" },
  connections: { host: "settings-connections-host" },
};

/** Where a moved section lives when NOT adopted (the hidden #page-body pen),
 *  captured on first mount so it can be parked back precisely. */
const settingsSectionPen: Record<string, HTMLElement | null> = {};

/** Adopt the whole .help-section[data-section=X] node into its settings-modal
 *  host and activate it. Idempotent — a no-op once already adopted. */
function mountSettingsSection(section: string): void {
  const cfg = SETTINGS_SECTIONS[section];
  if (!cfg) return;
  const host = document.getElementById(cfg.host);
  const sec = document.querySelector<HTMLElement>(`.help-section[data-section='${cfg.section ?? section}']`);
  if (!host || !sec) return;
  if (sec.parentElement === host) { sec.classList.add("active"); return; }
  settingsSectionPen[section] = sec.parentElement as HTMLElement | null;
  sec.classList.add("active");
  host.appendChild(sec);
}

/** Park a section's node back into its hidden #page-body pen and deactivate it. */
function parkSettingsSection(section: string): void {
  const cfg = SETTINGS_SECTIONS[section];
  if (!cfg) return;
  const host = document.getElementById(cfg.host);
  const sec = host?.querySelector<HTMLElement>(`.help-section[data-section='${cfg.section ?? section}']`);
  const pen = settingsSectionPen[section];
  if (sec && pen) { sec.classList.remove("active"); pen.appendChild(sec); }
}

// ── Init ─────────────────────────────────────────────────

export function initHelp() {
  hideDesktopOnlySubs();   // both: the group rows leave the modal; web: the desktop's capability rows too
  primeGroupPrefs();       // the Customize page's remembered tab and scope (his report, 2026-10-07)
  document.getElementById("help-close")?.addEventListener("click", closeHelp);

  // The workbench bundle can't import help modules — it calls this bridge
  // after mounting a section panel so the section's data actually loads.
  (window as unknown as { __wbSectionLoad?: (s: string) => void }).__wbSectionLoad =
    (section: string) => loadActiveSection(section);
  // (The header's Glyphh mark is gone — no logo in the chrome cluster.)
  // The code section is the permanent shell now — always active.
  document.querySelector(`.help-section[data-section="code"]`)?.classList.add("active");
  document.body.dataset.railSection ||= "code";

  // Settings sub-nav — the buttons live inside the .settings-layout that gets
  // MOVED into the settings modal on open, so bind by data-attr (not by
  // section-scoped selectors that break once the layout leaves the section)
  // and re-query the panel set at click time from wherever the layout now is.
  // Scope to the MAIN settings nav's own direct items.
  const settingsSubNav = settingsNavOwn<HTMLButtonElement>(".settings-nav-item");
  settingsSubNav.forEach((btn) => {
    if (btn instanceof HTMLAnchorElement) return; // an external row (Platform) is a plain link
    btn.addEventListener("click", () => {
      // Docs has its own topics nav, so it opens as its own section — and the
      // settings modal must step aside for it.
      const jump = btn.dataset.jump;
      if (jump) {
        closeSettingsModal();
        gotoSection(jump);
        return;
      }
      const sub = btn.dataset.sub!;
      settingsNavOwn(".settings-nav-item").forEach((n) => n.classList.remove("active"));
      document.querySelectorAll(".settings-panels > .settings-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const target = document.querySelector(`.settings-panels > .settings-panel[data-sub="${sub}"]`);
      if (target) target.classList.add("active");
      loadSettingsSub(sub);
    });
  });

  // (The rail's nav rows and the More fly-out are gone, his order 2026-10-09.)
  // (Artifacts rides the same data-settings-sub path — every rail link opens
  // the settings modal; the files PAGE stays reachable via gotoSection for
  // other callers, and closing the modal parks the adopted node back.)

  // The "More" fly-out (Loops / Skills / Agents) was removed in A3 — those
  // sections live in the Settings modal now, so the rail no longer carries a
  // More toggle or its dynamic menu.

  // User area — dropdown opens upward: Settings / Account / Logout.
  const GEAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  const USER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  const LOGOUT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;
  const userBtn = document.getElementById("app-rail-user-btn");
  let userMenu: HTMLDivElement | null = null;
  let userMenuAnchor: HTMLElement | null = null;
  const closeUserMenu = () => { userMenu?.remove(); userMenu = null; userMenuAnchor = null; };
  /** The account dropdown — Account / About / Log out. ANCHOR-aware:
   *  opens upward from a bottom-of-screen anchor (the retired rail button)
   *  and downward from a top one. (No visible opener today — the retired
   *  rail button keeps the binding; Settings/Account run through the dock's
   *  gear → settings modal.) */
  const openUserMenu = (anchor: HTMLElement): void => {
    if (userMenu) { closeUserMenu(); return; }
    const m = document.createElement("div");
    m.className = "code-menu app-rail-user-menu";
    const mk = (label: string, icon: string, cb: () => void, danger = false) => {
      const b = document.createElement("button");
      b.className = "code-menu-item" + (danger ? " danger" : "");
      b.innerHTML = `${icon}<span></span>`;
      (b.querySelector("span") as HTMLElement).textContent = label;
      b.addEventListener("click", () => { closeUserMenu(); cb(); });
      m.appendChild(b);
    };
    buildUserMenuInto(m, (sub) => { gotoSection("settings", sub); }, closeUserMenu);
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    const openUp = r.top > window.innerHeight / 2;
    const top = openUp
      ? Math.max(8, r.top - m.offsetHeight - 6)
      : Math.min(r.bottom + 6, window.innerHeight - m.offsetHeight - 8);
    m.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${top}px`;
    userMenu = m;
    userMenuAnchor = anchor;
  };
  userBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    openUserMenu(userBtn);
  });
  document.addEventListener("mousedown", (e) => {
    if (userMenu && !userMenu.contains(e.target as Node) && !userMenuAnchor?.contains(e.target as Node)) closeUserMenu();
  });
  // The wall's dock gear lands here (the workbench bundle can't import this
  // module): open the SETTINGS MODAL — gotoSection("settings") is the modal
  // path. Account/Logout live inside it.
  (window as unknown as { __glyphhOpenSettings?: (sub?: string) => void }).__glyphhOpenSettings = (sub?: string) => gotoSection("settings", sub);
  // The workbench's Close all shuts the Settings modal too (his report, 2026-10-07).
  (window as unknown as { __glyphhCloseSettings?: () => void }).__glyphhCloseSettings = () => closeSettingsModal();
  // Fill the user name from account info (email fallback) — and REFILL on
  // every account update, so logging out and back in as a different user
  // repaints it instead of showing the previous identity all run.
  const fillRailUser = (info: { email?: string; firstName?: string; lastName?: string; avatarUrl?: string } | null): void => {
    const nameEl = document.getElementById("app-rail-user-name");
    if (!nameEl) return;
    nameEl.textContent = info
      ? (info.firstName ? `${info.firstName} ${info.lastName || ""}`.trim() : info.email) || "Account"
      : "Account";
    // The avatar he set in his profile (his report, 2026-09-01): this chip
    // painted the generic person glyph forever. Swap in the resolved avatar
    // when there is one; a load error falls back to the glyph.
    const btn = document.getElementById("app-rail-user-btn");
    if (!btn) return;
    const svg = btn.querySelector<SVGElement>("svg");
    let img = btn.querySelector<HTMLImageElement>(".rail-user-avatar");
    const src = info?.avatarUrl || "";
    if (src) {
      if (!img) {
        img = document.createElement("img");
        img.className = "rail-user-avatar";
        img.alt = "";
        img.addEventListener("error", () => { img?.remove(); svg?.classList.remove("hidden"); });
        btn.prepend(img);
      }
      if (img.src !== src) img.src = src;
      svg?.classList.add("hidden");
    } else {
      img?.remove();
      svg?.classList.remove("hidden");
    }
  };
  void window.glyphh.getAccountInfo?.().then(fillRailUser).catch(() => { /* signed out — placeholder stays */ });
  window.glyphh.onAccountUpdated?.(fillRailUser);
  // Multi-org members get the workspace dropdown at the rail's top-left.
  initOrgSwitcher();

  // Initialize all section event handlers. Each init is ISOLATED — one panel
  // throwing (a moved element, a missing id after a refactor) must not kill
  // every init after it in the chain (that's how "the button isn't wired"
  // bugs happen silently).
  const boot = (name: string, fn: () => void): void => {
    try { fn(); } catch (err) { console.error(`[init] ${name} failed:`, err); }
  };
  boot("dashboard", initDashboardEvents);
  boot("org", initOrgPanel);
  boot("settings", initSettings);
  boot("files", initFiles);
  // A4 settings panels — wire their controls once at boot (idempotent).
  boot("support", initSupportPanel);
  boot("drips", initDripsEvents);
  boot("schedules", initSchedulesEvents);
  boot("connections", initConnections);
  boot("code", initCode);
  boot("dot-commands", wireGlobalDotCommands);
  // The shell steers sections too (the first-run walkthrough lands on Home).
  window.glyphh.onGotoSection?.((section) => {
    // "settings:account" → section + sub-panel (the nav apps use this).
    const [sec, sub] = String(section).split(":");
    gotoSection(sec, sub || undefined);
  });
}
