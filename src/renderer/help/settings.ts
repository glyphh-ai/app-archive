/**
 * Settings section — model config, toggles, remote relay.
 */

import { confirmAction } from "./shared.js";
import {
  applyRailTabsPerRow,
  clampRailTabsPerRow, railTabsLabel,
  RAIL_SHOW_APPS_PREF, RAIL_SHOW_LAYOUTS_PREF, RAIL_SHOW_DEFAULT, RAIL_SECTIONS_CHANGED_EVENT, railTrayShown,
} from "./wall-prefs.js";
import { loadAgentDefaults } from "./settings-agent.js";
import { loadVoiceSection } from "./settings-voice.js";
import { hostHas, keepIfHost, copyText } from "./web-surface.js";
import {
  STREAMED_PANELS_PREF, STREAMED_PANELS_WARNING, STREAMED_PANELS_CHANGED_EVENT,
  OPEN_STREAMED_PANELS_SETTING_EVENT, nextFlagStep, flagSwitchChecked, flagWarningShown, type FlagStep, type FlagAction,
} from "./streamed-panels-flag.js";
import { NOTIFY_PREF, NOTIFY_PREF_CHANGED_EVENT, NOTIFY_PREF_DEFAULT, NOTIFY_PREF_LABELS, NOTIFY_PREFS, readNotifyPref } from "./notify-pref.js";
import { initWorkspaces, loadWorkspacesPanel } from "./settings-workspaces.js";
import { initBilling, loadBilling, closeBuyForm, openBuyForm, autoReloadLine, setAutoReloadEnabled } from "./settings-billing.js";
import { accountApi, fmtUsd } from "./settings-api.js";
import { initProfile, loadProfile } from "./settings-profile.js";
import { initMembers, loadMembers } from "./settings-members.js";

// The account panels are big enough to own their own modules; Settings just
// initialises them and re-exports their loaders for navigation.ts.
export { loadBilling, loadProfile, loadMembers, loadWorkspacesPanel };

// ── Settings ─────────────────────────────────────────────

// General has no footer Save — every control in it
// toggles) owns its own save.

const toggleAutoUpdate = document.getElementById("toggle-auto-update") as HTMLInputElement;
const settingsBrowserHome = document.getElementById("settings-browser-home") as HTMLSelectElement;
const settingsBrowserHomeUrl = document.getElementById("settings-browser-home-url") as HTMLInputElement;
const browserHomeCustomRow = document.getElementById("browser-home-custom-row")!;

// MCP is now its own top-level dashboard tab (data-section="mcp"). The relay
// refreshers live inside initSettings' scope, so initSettings assigns this hook
// and loadMcp() (called by navigation on section open) invokes it.
let mcpSectionRefresh: () => void = () => {};

/** Settings → Desktop: live attach status (ported from the platform's Settings →
 *  Desktop page). Polls attach.status() through the SDK handle on web; on the
 *  desktop build the machine IS this app, so it reports attached locally. */
function initDesktopPanel(): void {
  const dot = document.getElementById("desktop-attach-dot");
  const title = document.getElementById("desktop-attach-title");
  const sub = document.getElementById("desktop-attach-sub");
  const get = document.getElementById("desktop-attach-get");
  if (!dot || !title || !sub) return;

  const sdk = (window as unknown as { glyphhSdk?: { attach?: { status?: () => Promise<{ attached?: boolean; machines?: Array<{ app?: string; version?: string; capabilities?: string[] }> }> } } }).glyphhSdk;
  const isWeb = typeof document !== "undefined" && document.documentElement.classList.contains("glyphh-web");

  const paint = (attached: boolean, machine?: { app?: string; version?: string; capabilities?: string[] }) => {
    dot.className = `connection-status-dot ${attached ? "connected" : "disconnected"}`;
    title.textContent = attached ? "Desktop attached" : "No desktop attached";
    sub.textContent = attached
      ? `${machine?.app || "glyphh-desktop"} ${machine?.version || ""} · ${(machine?.capabilities?.length || 0)} capabilities`.trim()
      : "Open the Glyphh desktop app and sign in — it connects on its own.";
    get?.classList.toggle("hidden", attached);
  };

  if (!isWeb) {
    // On the desktop build this IS the machine.
    paint(true, { app: "glyphh-desktop" });
    return;
  }
  const refresh = () => {
    void sdk?.attach?.status?.()
      .then((st) => paint(!!st?.attached, st?.machines?.[0]))
      .catch(() => paint(false));
  };
  refresh();
  // Attach state flips when the desktop app opens/closes — poll while visible.
  setInterval(() => { if (!document.hidden) refresh(); }, 5000);
}

function initSettings() {
  initDesktopPanel();
  initWorkspaces();
  // Billing / Organization / Account-profile own their wiring; they're
  // idempotent, so init here and let the sub-nav trigger their loads.
  initBilling();
  initProfile();
  initMembers();

  // Theme picker
  const themePicker = document.getElementById("theme-picker");
  if (themePicker) {
    window.glyphh.getTheme().then((theme) => {
      themePicker.querySelectorAll(".theme-option").forEach((btn) => {
        btn.classList.toggle("active", btn.getAttribute("data-theme") === theme);
      });
    });
    themePicker.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".theme-option") as HTMLElement | null;
      if (!btn) return;
      const theme = btn.getAttribute("data-theme")!;
      const resolved = theme === "system"
        ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
        : theme;
      document.documentElement.setAttribute("data-theme", resolved);
      window.glyphh.setTheme(theme);
      themePicker.querySelectorAll(".theme-option").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  }

  // Service toggles — show relaunch bar when changed
  const showRelaunch = () => {
    const bar = document.getElementById("settings-relaunch")!;
    if (bar) bar.classList.remove("hidden");
  };
  toggleAutoUpdate.addEventListener("change", () => {
    window.glyphh.setPreference("autoUpdate", toggleAutoUpdate.checked);
    showRelaunch();
  });

  // Keep-running-in-the-background — applies immediately (tray + login item),
  // no relaunch needed. DESKTOP ONLY: a browser tab has no tray and no login
  // item, so on web (where the bridge serves no setBackgroundMode) the whole
  // row is hidden rather than left as a switch that does nothing.
  const bgToggle = document.getElementById("toggle-background-mode") as HTMLInputElement | null;
  if (bgToggle && keepIfHost(bgToggle.closest(".settings-toggle"), "getBackgroundMode", "setBackgroundMode")) {
    void window.glyphh.getBackgroundMode?.().then((on) => { bgToggle.checked = !!on; }).catch(() => {});
    bgToggle.addEventListener("change", () => {
      void window.glyphh.setBackgroundMode?.(bgToggle.checked).then((on) => { bgToggle.checked = !!on; }).catch(() => {});
    });
  }


  // STREAMED WEB PANELS — the two-click flag (help/streamed-panels-flag.ts).
  // Shared pref, web and desktop. On = warning + "Turn on"; off = immediate.
  // Standard components only (an inline .settings-warn + action buttons), no
  // native confirm (memory law).
  {
    const sw = document.getElementById("toggle-streamed-panels") as HTMLInputElement | null;
    const warn = document.getElementById("streamed-panels-warn");
    const warnText = document.getElementById("streamed-panels-warn-text");
    const confirmBtn = document.getElementById("streamed-panels-confirm");
    const cancelBtn = document.getElementById("streamed-panels-cancel");
    if (sw && warn && warnText) {
      warnText.textContent = STREAMED_PANELS_WARNING;
      let step: FlagStep = "off";
      const paint = (): void => {
        sw.checked = flagSwitchChecked(step);
        warn.classList.toggle("hidden", !flagWarningShown(step));
      };
      const move = (action: FlagAction): void => {
        const r = nextFlagStep(step, action);
        step = r.step;
        if (r.persist !== undefined) {
          void window.glyphh.setPreference(STREAMED_PANELS_PREF, r.persist);
          // The panels in THIS document follow at once (the main-process
          // broadcast reaches the other documents on desktop).
          document.dispatchEvent(new CustomEvent(STREAMED_PANELS_CHANGED_EVENT, { detail: { on: r.persist } }));
        }
        paint();
      };
      void window.glyphh.getPreference(STREAMED_PANELS_PREF, false).then((v) => { step = v ? "on" : "off"; paint(); }).catch(paint);
      sw.addEventListener("change", () => move(sw.checked ? "toggle-on" : "toggle-off"));
      confirmBtn?.addEventListener("click", () => move("confirm"));
      cancelBtn?.addEventListener("click", () => move("cancel"));
      // A panel's "Open settings" link lands HERE: Settings → General, the row
      // scrolled into view and the switch focused.
      document.addEventListener(OPEN_STREAMED_PANELS_SETTING_EVENT, () => {
        (window as unknown as { __glyphhOpenSettings?: (sub?: string) => void }).__glyphhOpenSettings?.("general");
        const row = document.getElementById("streamed-panels-row");
        setTimeout(() => {
          row?.scrollIntoView({ block: "center", behavior: "smooth" });
          row?.classList.add("set-pref-focus");
          sw.focus({ preventScroll: true });
          setTimeout(() => row?.classList.remove("set-pref-focus"), 1800);
        }, 60);
      });
    }
  }

  // Notifications (help/notify-pref.ts): one select, three words. Turning it
  // on from HERE is the click a browser wants its permission asked on; the
  // ask toast's answers (help/notify.ts) repaint the select through the event.
  {
    const sel = document.getElementById("set-notifications") as HTMLSelectElement | null;
    if (sel) {
      for (const p of NOTIFY_PREFS) {
        const o = document.createElement("option");
        o.value = p;
        o.textContent = NOTIFY_PREF_LABELS[p];
        sel.appendChild(o);
      }
      sel.value = NOTIFY_PREF_DEFAULT;
      void window.glyphh.getPreference(NOTIFY_PREF, NOTIFY_PREF_DEFAULT).then((v) => { sel.value = readNotifyPref(v); }).catch(() => {});
      sel.addEventListener("change", () => {
        const pref = readNotifyPref(sel.value);
        void window.glyphh.setPreference(NOTIFY_PREF, pref);
        if (pref === "on") void window.glyphh.notifyPrepare?.();
      });
      document.addEventListener(NOTIFY_PREF_CHANGED_EVENT, (e) => { sel.value = readNotifyPref((e as CustomEvent<{ pref?: unknown }>).detail?.pref); });
    }
  }

  // Agent defaults — the model a new session opens with, from the org's own
  // allowed list (help/settings-agent.ts).
  void loadAgentDefaults();
  // Voice — mic mode, spoken replies, the voice (help/settings-voice.ts).
  void loadVoiceSection();
  // Embeddings upgrade — ONNX default, Together AI BYOK (desktop-only).
  // Embeddings + memory live on Settings → Memory now (his order, 2026-09-19).

  // Default workspace — what a fresh boot opens when there's nothing to
  // restore (code-workbench restoreWallOnce reads the same pref). Options are
  // the user's layouts; the three shipped defaults (Vibe/Dev/Design) are
  // always offered — a missing one backfills from its template on first open.
  const defWs = document.getElementById("settings-default-workspace") as HTMLSelectElement | null;
  if (defWs) {
    void (async () => {
      const current = String((await window.glyphh.getPreference?.("defaultWorkspace", "")) ?? "");
      let names: string[] = [];
      try { names = ((await window.glyphh.layoutsList?.()) ?? []).map((l) => String((l as { name?: string }).name || "")).filter(Boolean); } catch { /* offline */ }
      const seen = new Set<string>();
      const opts: string[] = [];
      for (const n of ["Design", ...names]) {
        const k = n.toLowerCase();
        if (!seen.has(k)) { seen.add(k); opts.push(n); }
      }
      defWs.innerHTML = "";
      const none = document.createElement("option");
      none.value = "";
      none.textContent = "None";
      defWs.appendChild(none);
      for (const n of opts) {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = n;
        defWs.appendChild(o);
      }
      defWs.value = opts.some((n) => n.toLowerCase() === current.toLowerCase()) ? opts.find((n) => n.toLowerCase() === current.toLowerCase())! : "";
      defWs.addEventListener("change", () => {
        void window.glyphh.setPreference?.("defaultWorkspace", defWs.value);
      });
    })();
  }

  // The cloud relay (external LLMs driving this machine) was removed. Its
  // in-page helper survives — escapeHtmlLocal is reused by the token list below.
  function escapeHtmlLocal(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── Local MCP server (127.0.0.1) — the no-cloud alternative. Available to
  // any user (it's purely local; no org/tier involved). ──
  const localMcpSection = document.getElementById("local-mcp-section");
  const localMcpToggle = document.getElementById("local-mcp-toggle") as HTMLInputElement | null;
  const localMcpStatusEl = document.getElementById("local-mcp-status");
  const localMcpBody = document.getElementById("local-mcp-body");
  const localMcpPortInput = document.getElementById("local-mcp-port") as HTMLInputElement | null;
  const localMcpConfigEl = document.getElementById("local-mcp-config");
  const localMcpTokensListEl = document.getElementById("local-mcp-tokens-list");
  const localMcpNewTokenBox = document.getElementById("local-mcp-new-token");
  const localMcpNewTokenValue = document.getElementById("local-mcp-new-token-value");
  const localMcpLabelInput = document.getElementById("local-mcp-token-label") as HTMLInputElement | null;

  function renderLocalMcpConfig(port: number): void {
    if (!localMcpConfigEl) return;
    localMcpConfigEl.textContent = `{
  "mcpServers": {
    "glyphh-local": {
      "type": "http",
      "url": "http://127.0.0.1:${port}/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}`;
  }

  async function refreshLocalMcp(): Promise<void> {
    const s = await window.glyphh.localMcpStatus();
    if (localMcpStatusEl) {
      localMcpStatusEl.textContent = s.running ? `Running on http://127.0.0.1:${s.port}` : "Stopped.";
      localMcpStatusEl.style.color = s.running ? "var(--accent)" : "var(--text-3)";
    }
    if (localMcpPortInput && document.activeElement !== localMcpPortInput) localMcpPortInput.value = String(s.port);
    renderLocalMcpConfig(s.port);
  }

  async function renderLocalMcpTokens(): Promise<void> {
    if (!localMcpTokensListEl) return;
    localMcpTokensListEl.innerHTML = "";
    const tokens = await window.glyphh.localMcpTokensList();
    if (!tokens.length) {
      localMcpTokensListEl.innerHTML = `<div style="font-size:12px;color:var(--text-3);">No tokens yet — generate one below.</div>`;
      return;
    }
    for (const t of tokens) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface-2);border:1px solid var(--border-2);border-radius:6px;margin-bottom:4px;font-size:12px;";
      const created = t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "";
      const expires = t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : "";
      row.innerHTML = `<span style="flex:1;color:var(--text);">${escapeHtmlLocal(t.label || "(unnamed)")}</span><span style="color:var(--text-3);font-size:11px;">${created} → ${expires}</span><button class="action-btn danger" data-revoke="${escapeHtmlLocal(t.id)}" style="font-size:11px;padding:3px 10px;">Revoke</button>`;
      row.querySelector("[data-revoke]")!.addEventListener("click", async () => {
        if (!(await confirmAction({
          title: `Revoke “${t.label || "this token"}”?`,
          body: "Local tools using it stop working immediately.",
          confirmLabel: "Revoke token",
          danger: true,
        }))) return;
        await window.glyphh.localMcpTokensRevoke(t.id);
        void renderLocalMcpTokens();
      });
      localMcpTokensListEl.appendChild(row);
    }
  }

  function setLocalMcpBodyVisible(on: boolean): void {
    if (localMcpBody) localMcpBody.style.display = on ? "" : "none";
  }

  // The local MCP server runs ON THIS MACHINE (127.0.0.1) — a browser tab has
  // no machine to run it on, and the web bridge serves no localMcpSetEnabled
  // (the toggle threw). Keep the whole section hidden wherever the host can't
  // run it (hostHas — the Proxy on web answers every name, typeof can't tell).
  if (localMcpSection && localMcpToggle && hostHas("localMcpSetEnabled")) {
    localMcpSection.classList.remove("hidden");
    void (async () => {
      const enabled = (await window.glyphh.getPreference("localMcpEnabled", true)) !== false;
      localMcpToggle.checked = enabled;
      setLocalMcpBodyVisible(enabled);
      await refreshLocalMcp();
      await renderLocalMcpTokens();
    })();

    localMcpToggle.addEventListener("change", async () => {
      const on = localMcpToggle.checked;
      setLocalMcpBodyVisible(on);
      const res = await window.glyphh.localMcpSetEnabled(on);
      if (!res.ok && res.error) {
        if (localMcpStatusEl) {
          localMcpStatusEl.textContent = res.error;
          localMcpStatusEl.style.color = "var(--danger)";
        }
        localMcpToggle.checked = false;
        setLocalMcpBodyVisible(false);
        return;
      }
      await refreshLocalMcp();
    });

    document.getElementById("local-mcp-port-save")?.addEventListener("click", async () => {
      const port = parseInt(localMcpPortInput?.value || "", 10);
      const res = await window.glyphh.localMcpSetPort(port);
      if (!res.ok && res.error) {
        if (localMcpStatusEl) {
          localMcpStatusEl.textContent = res.error;
          localMcpStatusEl.style.color = "var(--danger)";
        }
        return;
      }
      await refreshLocalMcp();
    });

    document.getElementById("local-mcp-gen-token")?.addEventListener("click", async () => {
      const label = localMcpLabelInput?.value.trim() || "default";
      const res = await window.glyphh.localMcpTokensCreate(label);
      if (localMcpLabelInput) localMcpLabelInput.value = "";
      if (localMcpNewTokenBox && localMcpNewTokenValue) {
        localMcpNewTokenValue.textContent = res.token;
        localMcpNewTokenBox.classList.remove("hidden");
      }
      void renderLocalMcpTokens();
    });

    document.getElementById("local-mcp-copy-token")?.addEventListener("click", () => {
      const val = localMcpNewTokenValue?.textContent || "";
      void copyText(val);
      const btn = document.getElementById("local-mcp-copy-token") as HTMLButtonElement;
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = "Copy"; }, 2000);
    });

    document.getElementById("local-mcp-copy-config")?.addEventListener("click", () => {
      const val = localMcpConfigEl?.textContent || "";
      void copyText(val);
      const btn = document.getElementById("local-mcp-copy-config") as HTMLButtonElement;
      btn.textContent = "Copied";
      setTimeout(() => { btn.textContent = "Copy"; }, 2000);
    });
  }

  // Expose the MCP refreshers so the MCP tab can refresh on open.
  mcpSectionRefresh = () => {
    void refreshLocalMcp();
    void renderLocalMcpTokens();
  };

  // Show URL Bar toggle removed — only the Browser panel shows a URL bar
  // now; everything else (Agent, Plan, Workbench, internal yo://) doesn't.

  // Browser homepage
  settingsBrowserHome.addEventListener("change", () => {
    const val = settingsBrowserHome.value;
    browserHomeCustomRow.classList.toggle("hidden", val !== "custom");
    if (val !== "custom") {
      window.glyphh.setPreference("browserHomepage", val);
    }
  });
  settingsBrowserHomeUrl.addEventListener("change", () => {
    const url = settingsBrowserHomeUrl.value.trim();
    if (url) {
      window.glyphh.setPreference("browserHomepage", "custom");
      window.glyphh.setPreference("browserHomepageUrl", url);
    }
  });

  // Show the address bar on app panels by default (roams to the server, since
  // it's not device-local). The workbench listens for the change to apply it
  // to newly-opened panels live.
  const appUrlBar = document.getElementById("settings-app-urlbar") as HTMLInputElement | null;
  appUrlBar?.addEventListener("change", () => {
    void window.glyphh.setPreference("showAppUrlBar", appUrlBar.checked);
    document.dispatchEvent(new CustomEvent("glyphh:app-urlbar-default", { detail: appUrlBar.checked }));
  });

  // Echo Agent panel transparency — applied LIVE while sliding (the CSS var
  // drives the caret panel), persisted on release.
  {
    const o = document.getElementById("settings-echo-agent-opacity") as HTMLInputElement | null;
    const ov = document.getElementById("settings-echo-agent-opacity-val");
    const paint = (): void => {
      if (!o) return;
      document.documentElement.style.setProperty("--echo-agent-opacity", o.value);
      if (ov) ov.textContent = `${Math.round(Number(o.value) * 100)}%`;
    };
    o?.addEventListener("input", paint);
    o?.addEventListener("change", () => {
      paint();
      void window.glyphh.setPreference("echoAgentOpacity", Number(o.value));
    });
  }
  // TEXT transparency — its own var, independent of the panel's.
  {
    const t = document.getElementById("settings-echo-agent-text-opacity") as HTMLInputElement | null;
    const tv = document.getElementById("settings-echo-agent-text-opacity-val");
    const paint = (): void => {
      if (!t) return;
      document.documentElement.style.setProperty("--echo-agent-text-opacity", t.value);
      if (tv) tv.textContent = `${Math.round(Number(t.value) * 100)}%`;
    };
    t?.addEventListener("input", paint);
    t?.addEventListener("change", () => {
      paint();
      void window.glyphh.setPreference("echoAgentTextOpacity", Number(t.value));
    });
  }
  // Max panel height (vh) — how tall the agent panel may grow.
  {
    const m = document.getElementById("settings-echo-agent-max-h") as HTMLInputElement | null;
    const mv = document.getElementById("settings-echo-agent-max-h-val");
    const paint = (): void => {
      if (!m) return;
      document.documentElement.style.setProperty("--echo-agent-max-h", `${m.value}vh`);
      if (mv) mv.textContent = `${m.value}%`;
    };
    m?.addEventListener("input", paint);
    m?.addEventListener("change", () => {
      paint();
      void window.glyphh.setPreference("echoAgentMaxH", Number(m.value));
    });
  }

  // Tabs per row — the sidebar's Tabs tray. Its grid reads --rail-tabs-cols;
  // the icon-rail collapse still overrides to one per row, as it always has.
  // 0 = Auto, which restores the auto-fill this grid shipped with: a fixed
  // count would otherwise have to pick a number for every rail width.
  {
    const c = document.getElementById("settings-rail-tabs-cols") as HTMLInputElement | null;
    const cv = document.getElementById("settings-rail-tabs-cols-val");
    const paint = (): void => {
      if (!c) return;
      applyRailTabsPerRow(c.value);
      if (cv) cv.textContent = railTabsLabel(c.value);
    };
    c?.addEventListener("input", paint);
    c?.addEventListener("change", () => {
      paint();
      void window.glyphh.setPreference("railTabsPerRow", Number(c.value));
    });
  }

  // THE SIDEBAR TRAYS (his order, 2026-10-08) — persist BEFORE announcing;
  // the rail re-reads the pref on the event (help/code.ts).
  for (const [id, pref] of [["settings-rail-apps", RAIL_SHOW_APPS_PREF], ["settings-rail-layouts", RAIL_SHOW_LAYOUTS_PREF]] as const) {
    const t = document.getElementById(id) as HTMLInputElement | null;
    t?.addEventListener("change", () => {
      void Promise.resolve(window.glyphh.setPreference(pref, t.checked)).then(() => {
        document.dispatchEvent(new CustomEvent(RAIL_SECTIONS_CHANGED_EVENT));
      });
    });
  }

  // Icon hover zoom — every icon in the app scales by this on hover.
  // Applied LIVE via the CSS var; persisted like every other preference.
  {
    const z = document.getElementById("settings-icon-zoom") as HTMLInputElement | null;
    const zv = document.getElementById("settings-icon-zoom-val");
    const paint = (): void => {
      if (!z) return;
      document.documentElement.style.setProperty("--icon-zoom", z.value);
      if (zv) zv.textContent = Number(z.value) <= 1 ? "Off" : `${Math.round((Number(z.value) - 1) * 100)}%`;
    };
    z?.addEventListener("input", paint);
    z?.addEventListener("change", () => {
      paint();
      void window.glyphh.setPreference("iconHoverZoom", Number(z.value));
    });
  }

  // Interface sound volume (his ask, 2026-08-19) — pref uiSoundVolume 0..1,
  // server-backed like every pref (/api/me/prefs → db). Live: dragging updates
  // the running volume at once and plays a sample tick so the level is
  // audible while choosing it.
  {
    const z = document.getElementById("general-ui-sound") as HTMLInputElement | null;
    const zv = document.getElementById("general-ui-sound-val");
    const paint = (): void => { if (z && zv) zv.textContent = Number(z.value) <= 0 ? "Off" : `${z.value}%`; };
    const w = window as unknown as { __uiSoundSetVolume?: (v: number) => void; __uiSound?: (k: "tick" | "focus") => void };
    z?.addEventListener("input", () => {
      paint();
      w.__uiSoundSetVolume?.(Number(z.value) / 100);
      w.__uiSound?.("tick");
    });
    z?.addEventListener("change", () => {
      paint();
      void window.glyphh.setPreference("uiSoundVolume", Number(z.value) / 100);
    });
  }

  // WEB on a TOUCH device (tablet / iPad-as-Mac): the door back to the mobile
  // app — the twin of mobile's Appearance → "Desktop site" toggle. Flipping it
  // clears the glyphh_force_desktop escape hatch (which is what keeps a tablet
  // pinned to this layout) and lands on /m. Hidden everywhere else: Electron
  // has no mobile shell, and a fine-pointer desktop was never redirected.
  {
    const row = document.getElementById("settings-mobile-ui-row");
    const toggle = document.getElementById("settings-mobile-ui") as HTMLInputElement | null;
    const onWeb = !!(window as unknown as { __GLYPHH_WEB__?: boolean }).__GLYPHH_WEB__;
    let coarse = false;
    try { coarse = window.matchMedia("(pointer: coarse)").matches; } catch { /* keep hidden */ }
    if (row && toggle && onWeb && coarse) {
      row.classList.remove("hidden");
      toggle.addEventListener("change", () => {
        if (!toggle.checked) return;
        try { localStorage.removeItem("glyphh_force_desktop"); } catch { /* private mode */ }
        window.location.href = "/m";
      });
    }
  }

  // Relaunch button — the desktop restarts itself; a browser tab reloads.
  document.getElementById("settings-relaunch-btn")?.addEventListener("click", () => {
    if (hostHas("relaunch")) window.glyphh.relaunch();
    else window.location.reload();
  });

  // REMOTE CONTROL is this COMPUTER's switch (main/remote-control.ts): the
  // desktop app attaching itself to the relay. A browser tab is not a machine
  // — on web the bridge serves no remoteControlGet, so the page and its nav
  // entry are hidden (the mobile/web side of remote control is the source
  // chip's "Connected machines" list, not a setting).
  if (!hostHas("remoteControlGet")) {
    document.querySelectorAll<HTMLElement>('.settings-nav-item[data-sub="remote"], .settings-panel[data-sub="remote"]')
      .forEach((n) => n.classList.add("hidden"));
  }

  // (Glyphh Skill export moved to its own Skills page — see help/skills.ts.)

  // "Manage account" is gone from the identity header — this panel IS that
  // page, so a button opening the platform's copy of it was a loop.

  // Refresh plan status — after an in-app upgrade/downgrade the cached session
  // tier is stale until the next heartbeat (or re-login). This forces a fresh
  // heartbeat and repaints the Plan chip, no re-auth needed.
  document.getElementById("account-refresh-tier")?.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const btn = document.getElementById("account-refresh-tier");
    btn?.classList.add("spinning");
    try {
      const r = await window.glyphh.refreshAuth();
      if (r?.tier) paintPlanChip(r.tier);
    } catch { /* offline — leave the current value */ }
    finally { setTimeout(() => btn?.classList.remove("spinning"), 400); }
  });

  // Sign out
  document.getElementById("account-logout-btn")?.addEventListener("click", async () => {
    document.getElementById("help-overlay")!.classList.add("hidden");
    await window.glyphh.logout();
  });

}

/** The plan chip — highlighted only when the plan is a paid one. The plan is
 *  the org admin's business (his order, 2026-09-29: "org users should not see
 *  the plan they are on"), so a member does not get the chip at all. */
function paintPlanChip(tier?: string | null, role?: string | null): void {
  const el = document.getElementById("account-tier");
  const chip = el?.closest(".acct-chip-plan");
  if (!el) return;
  if (role !== undefined) chip?.classList.toggle("hidden", !seesPlan(role));
  el.textContent = tier || "—";
  chip?.classList.toggle("paid", !!tier && tier !== "none" && tier !== "free");
}

export function seesPlan(role?: string | null): boolean {
  return !!role && ["org_admin", "super_admin"].includes(role);
}


async function loadSettings() {
  // Account's profile form loads with Settings rather than waiting on a
  // sub-nav click; the org record lives on Organization › General now and
  // loads there.
  void loadProfile();
  // Members hides its own nav item unless the caller is an org admin, so this
  // has to run on Settings open, not only when the tab is clicked.
  void loadMembers();

  // The Account header's ORG + PLAN chips. Name, email, role and the avatar
  // come from the server profile via loadProfile() — one painter each, so the
  // two loads can't race over the same element.
  const accountInfo = await window.glyphh.getAccountInfo();
  const orgEl = document.getElementById("account-org")!;
  orgEl.textContent = accountInfo?.orgName || "—";
  paintPlanChip(accountInfo?.tier, accountInfo?.role ?? null);

  // Load toggle states
  toggleAutoUpdate.checked = await window.glyphh.getPreference("autoUpdate", true) as boolean;

  const mcpSectionWrap = document.getElementById("mcp-section-wrap")!;
  mcpSectionWrap.classList.remove("hidden");

  // Browser homepage
  const homePref = await window.glyphh.getPreference("browserHomepage", "claude") as string;
  settingsBrowserHome.value = homePref === "custom" ? "custom" : homePref;
  browserHomeCustomRow.classList.toggle("hidden", homePref !== "custom");
  if (homePref === "custom") {
    settingsBrowserHomeUrl.value = await window.glyphh.getPreference("browserHomepageUrl", "") as string;
  }
  const appUrlBar = document.getElementById("settings-app-urlbar") as HTMLInputElement | null;
  if (appUrlBar) appUrlBar.checked = await window.glyphh.getPreference("showAppUrlBar", true) as boolean;

  const agTx = document.getElementById("settings-echo-agent-text-opacity") as HTMLInputElement | null;
  if (agTx) {
    const raw = Number(await window.glyphh.getPreference("echoAgentTextOpacity", 1));
    agTx.value = String(Number.isFinite(raw) ? Math.max(0.25, Math.min(1, raw)) : 1);
    const tv = document.getElementById("settings-echo-agent-text-opacity-val");
    if (tv) tv.textContent = `${Math.round(Number(agTx.value) * 100)}%`;
  }
  const agMh = document.getElementById("settings-echo-agent-max-h") as HTMLInputElement | null;
  if (agMh) {
    const raw = Number(await window.glyphh.getPreference("echoAgentMaxH", 76));
    agMh.value = String(Number.isFinite(raw) ? Math.max(20, Math.min(100, raw)) : 76);
    const mv = document.getElementById("settings-echo-agent-max-h-val");
    if (mv) mv.textContent = `${agMh.value}%`;
  }
  const agOp = document.getElementById("settings-echo-agent-opacity") as HTMLInputElement | null;
  if (agOp) {
    const raw = Number(await window.glyphh.getPreference("echoAgentOpacity", 0.92));
    agOp.value = String(Number.isFinite(raw) ? Math.max(0.25, Math.min(1, raw)) : 0.92);
    const ov = document.getElementById("settings-echo-agent-opacity-val");
    if (ov) ov.textContent = `${Math.round(Number(agOp.value) * 100)}%`;
  }
  for (const [id, pref] of [["settings-rail-apps", RAIL_SHOW_APPS_PREF], ["settings-rail-layouts", RAIL_SHOW_LAYOUTS_PREF]] as const) {
    const t = document.getElementById(id) as HTMLInputElement | null;
    if (t) t.checked = railTrayShown(await window.glyphh.getPreference(pref, RAIL_SHOW_DEFAULT));
  }
  const railCols = document.getElementById("settings-rail-tabs-cols") as HTMLInputElement | null;
  if (railCols) {
    railCols.value = String(clampRailTabsPerRow(await window.glyphh.getPreference("railTabsPerRow", 0)));
    const v = document.getElementById("settings-rail-tabs-cols-val");
    if (v) v.textContent = railTabsLabel(railCols.value);
  }
  const iconZoom = document.getElementById("settings-icon-zoom") as HTMLInputElement | null;
  if (iconZoom) {
    const raw = Number(await window.glyphh.getPreference("iconHoverZoom", 1.08));
    iconZoom.value = String(Number.isFinite(raw) ? Math.max(1, Math.min(1.5, raw)) : 1.08);
    const zv = document.getElementById("settings-icon-zoom-val");
    if (zv) zv.textContent = Number(iconZoom.value) <= 1 ? "Off" : `${Math.round((Number(iconZoom.value) - 1) * 100)}%`;
  }
  const snd = document.getElementById("general-ui-sound") as HTMLInputElement | null;
  if (snd) {
    const raw = Number(await window.glyphh.getPreference("uiSoundVolume", 0.3));
    const v = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.3;
    snd.value = String(Math.round(v * 100));
    const zv = document.getElementById("general-ui-sound-val");
    if (zv) zv.textContent = v <= 0 ? "Off" : `${Math.round(v * 100)}%`;
  }
}

/** MCP is its own top-level dashboard tab (data-section="mcp"). navigation.ts
 *  calls this on section open to refresh relay + expose state. */
export function loadMcp(): void { mcpSectionRefresh(); }

export { loadSettings, initSettings };

/** The APP's Usage view (plan-limits look) — the budget in dollars:
 *  a period bar + reset, plan pool, added funds, remaining, Add funds, refresh,
 *  the auto-reload toggle. Platform skips it. */
let uaWired = false;

export async function loadUsageAppView(): Promise<void> {
  // The spend limit is the ORG ADMIN's control (his ruling, 2026-09-12) —
  // members see the cap but cannot adjust it.
  void window.glyphh.getAccountInfo?.().then((info) => {
    const admin = !!info?.role && ["org_admin", "admin", "super_admin"].includes(info.role);
    el("ua-adjust-limit")?.classList.toggle("hidden", !admin);
  });
  const el = (id: string) => document.getElementById(id);
  if (!el("usage-app-view")) return;
  closeBuyForm();
  if (!uaWired) {
    uaWired = true;
    el("ua-refresh")?.addEventListener("click", () => void loadUsageAppView());
    // Add funds → the shared Add-funds form (settings-billing owns it;
    // Billing opens the same one breadcrumbed ← Billing).
    el("ua-buy")?.addEventListener("click", () => openBuyForm("usage"));
    // Adjust limit → the in-tab spend-limit form (← Usage brings the page back).
    const showLimitForm = (on: boolean) => {
      el("ua-main")?.classList.toggle("hidden", on);
      el("ua-limit-form")?.classList.toggle("hidden", !on);
    };
    el("ua-adjust-limit")?.addEventListener("click", () => {
      // Belt and braces beside the hide below — a member must never reach
      // the form even if the button is resurrected by other DOM work.
      void (async () => {
        const cap = Number(await window.glyphh.getPreference?.("billingMonthlyCapUsd", 0)) || 0;
        (el("ua-limit-input") as HTMLInputElement).value = cap > 0 ? String(cap) : "";
        showLimitForm(true);
        (el("ua-limit-input") as HTMLInputElement | null)?.focus();
      })();
    });
    el("ua-limit-back")?.addEventListener("click", () => showLimitForm(false));
    el("ua-limit-cancel")?.addEventListener("click", () => showLimitForm(false));
    el("ua-limit-save")?.addEventListener("click", () => {
      void (async () => {
        const cap = Math.max(0, Number((el("ua-limit-input") as HTMLInputElement).value) || 0);
        await window.glyphh.setPreference?.("billingMonthlyCapUsd", cap);
        const capEl = el("ua-cap");
        if (capEl) capEl.textContent = cap > 0 ? `$${cap.toLocaleString()}` : "Unlimited";
        showLimitForm(false);
      })();
    });
    const toggle = el("ua-autotopup") as HTMLInputElement | null;
    toggle?.addEventListener("change", () => {
      void (async () => {
        // Dollar defaults ride the first enable (settings-billing owns them).
        const res = await setAutoReloadEnabled(toggle.checked).catch(() => ({ ok: false }));
        if (!res.ok) toggle.checked = !toggle.checked;
        const line = el("ua-autotopup-line");
        if (line) line.textContent = autoReloadLine(await accountApi().autotopup().catch(() => null));
      })();
    });
  }
  // The ONE account transport (SDK on web, IPC on desktop) — the page is
  // identical on both surfaces by construction.
  const api = accountApi();
  // MEMBERS see their own usage and nothing org-financial (his scoping order,
  // 2026-08-24): no org budget, no buying, no auto-reload. The server 403s
  // the billing reads/writes for them regardless — this hides the controls.
  void Promise.resolve(window.glyphh.getAccountInfo?.()).then((info) => {
    const admin = !!info?.role && ["org_admin", "admin", "super_admin"].includes(info.role);
    document.querySelector(".ua-budget-toggle")?.classList.toggle("hidden", !admin);
    el("ua-balance-row")?.classList.toggle("hidden", !admin);
    // The spend limit is the org admin's; a member's line is their team's budget above.
    el("ua-cap-row")?.classList.toggle("hidden", !admin);
  }).catch(() => { /* signed out — the page renders read-only anyway */ });
  try {
    // dashboardData is the SPEND-LOG truth on both surfaces (desktop home-ipc /
    // the web contract): the budget off billing.balance, the plan's
    // name + monthly pool off the catalog. Dollars end to end.
    const [data, topup] = await Promise.all([
      Promise.resolve(window.glyphh.dashboardData?.()) as Promise<{ plan?: string; remainingUsd?: number; poolUsdPerMonth?: number; fundsUsd?: number; budgetSpentUsd?: number; periodEnd?: string | null; limitUsd?: number | null; limitSource?: string | null; mySpentUsd?: number; poolUsd?: number; poolSpentUsd?: number; poolRemainingUsd?: number; poolSource?: "member" | "team" | "org"; planUsd?: number } | undefined>,
      api.autotopup().catch(() => null),
    ]);
    const planEl = el("ua-plan");
    if (planEl && data?.plan) {
      planEl.textContent = data.plan.includes(" ") ? data.plan
        : `Glyphh ${data.plan.charAt(0).toUpperCase()}${data.plan.slice(1)}`;
    }
    // THE GLYPHH BUDGET (his order, 2026-09-20): one number, the member's
    // budget for connector and model calls through Glyphh (their team's share
    // when the org admin handed one out, else the org's pool), spent and
    // remaining against it. The org's own money is GlyphhRouter's to show.
    const pool = Math.max(0, data?.poolUsd ?? 0);
    const funds = Math.max(0, data?.fundsUsd ?? 0);
    const spent = Math.max(0, data?.poolSpentUsd ?? 0);
    const total = pool;
    const pct = total > 0 ? Math.min(100, Math.round((spent / total) * 100)) : 0;
    const fill = el("ua-month-fill");
    if (fill) fill.style.width = `${pct}%`;
    const pctEl = el("ua-month-pct");
    if (pctEl) pctEl.textContent = total > 0 ? `${pct}% used` : "—";
    // The server names the period's end; fall back to the calendar month.
    const reset = data?.periodEnd ? new Date(data.periodEnd) : new Date();
    if (!data?.periodEnd || Number.isNaN(reset.getTime())) reset.setMonth(reset.getMonth() + 1, 1);
    const resetEl = el("ua-month-reset");
    if (resetEl) resetEl.textContent = `Resets ${reset.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    const spentEl = el("ua-spent");
    if (spentEl) spentEl.textContent = fmtUsd(spent);
    const spentReset = el("ua-spent-reset");
    if (spentReset) spentReset.textContent = resetEl?.textContent ?? "";
    // The plan's dollars a month (or the team's monthly share); the added cash
    // shows on the remaining line below, once.
    const planUsd = Math.max(0, data?.planUsd ?? 0);
    const poolEl = el("ua-pool");
    // ONE line (his order, 2026-09-29): the member's own limit, else their team's, else the org's plan.
    const own = data?.poolSource === "member" || data?.poolSource === "team";
    if (poolEl) poolEl.textContent = `${fmtUsd(own ? total : planUsd)} / month`;
    const poolSub = el("ua-pool-sub");
    if (poolSub) {
      poolSub.textContent = data?.poolSource === "member"
        ? "Your monthly limit, set by your organization admin, for connector and model calls through Glyphh"
        : data?.poolSource === "team"
        ? "Your team's share of the Glyphh budget, for connector and model calls through Glyphh"
        : "From your plan, for connector and model calls through Glyphh";
    }
    const fundsEl = el("ua-funds");
    if (fundsEl) fundsEl.textContent = fmtUsd(funds);
    const balEl = el("ua-balance");
    if (balEl) balEl.textContent = fmtUsd(Math.max(0, data?.poolRemainingUsd ?? total - spent));
    const t = el("ua-autotopup") as HTMLInputElement | null;
    if (t && topup) t.checked = !!topup.enabled;
    const line = el("ua-autotopup-line");
    if (line) line.textContent = autoReloadLine(topup);
    const cap = Number(await window.glyphh.getPreference?.("billingMonthlyCapUsd", 0)) || 0;
    const capEl = el("ua-cap");
    if (capEl) capEl.textContent = cap > 0 ? `$${cap.toLocaleString()}` : "Unlimited";
    const upd = el("ua-updated");
    if (upd) upd.textContent = `Last updated: ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  } catch { /* offline — the view keeps its dashes */ }
}
