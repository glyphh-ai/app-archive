/**
 * settings-devices.ts — Settings → Devices (his order, 2026-10-04), on the web
 * AND the desktop: the member's machines attached with remote control on,
 * each with Disconnect, and the machines disconnected from the web, each
 * with Allow. Modelled on the mobile app's Desktops strip (web/src/mobile.tsx
 * HomeList): a laptop glyph, the name, the app + version, since when, the
 * granted folders.
 *
 * THE SERVER (glyphh_auth/attach.py):
 *   GET  /api/attach/devices                      → { allowed, devices: [{ id, app, version, name, since,
 *                                                    capabilities, folders, inst, device, remote }],
 *                                                    blocked: [{ device, app, name, disconnectedAt }] }
 *   POST /api/attach/devices/{machineId}/disconnect → { disconnected, device, hours }  — the desktop's socket
 *                                                    closes 4403 and it stops reconnecting (remote-control.ts)
 *   POST /api/attach/devices/{device}/allow        → { allowed }  (`device` = the STABLE key, not the machine id)
 * Until the routes land, `attach.status()`'s machines stand in (source "status") —
 * listed, no Disconnect.
 *
 * TRANSPORT: the desktop asks main (attach-devices:* IPC, remote-control.ts);
 * the web's contract answers the same names off the SDK handle.
 */

import { confirmAction, relativeTime } from "./shared.js";
import { deviceRowsOf, type BlockedRow, type DeviceRow, type DevicesAnswer } from "./devices-rows.js";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const LAPTOP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;

interface DevicesApi {
  attachDevicesList?: () => Promise<DevicesAnswer>;
  attachDeviceDisconnect?: (machineId: string) => Promise<{ disconnected: boolean; device?: string; hours?: number }>;
  attachDeviceAllow?: (device: string) => Promise<{ allowed: boolean }>;
}
const api = (): DevicesApi => window.glyphh as unknown as DevicesApi;
const el = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

let loading = false;

function appLabel(app: string, version: string): string {
  const name = app === "glyphh-desktop" ? "Glyphh Desktop" : app === "glyphh-cli" ? "Glyphh CLI" : app || "Glyphh";
  return version ? `${name} ${version}` : name;
}

function paint(rows: { devices: DeviceRow[]; blocked: BlockedRow[] }, a: DevicesAnswer): void {
  const list = el("devices-list");
  const blockedHost = el("devices-blocked");
  const blockedSec = el("devices-blocked-section");
  const orgOff = el("devices-org-off");
  if (!list) return;
  orgOff?.classList.toggle("hidden", a.allowed !== false);
  list.innerHTML = rows.devices.length
    ? rows.devices.map((d) => `
      <div class="set-pref-row devices-row" data-machine="${esc(d.machineId)}">
        <span class="devices-icon">${LAPTOP_SVG}</span>
        <div class="set-pref-text">
          <div class="set-pref-title">${esc(d.name)}${d.remote ? "" : ` <span class="devices-tag">not on remote control</span>`}</div>
          <div class="set-pref-desc">${esc(appLabel(d.app, d.version))}${d.since ? ` · attached ${esc(relativeTime(d.since))}` : ""}</div>
          ${d.folders.length ? `<div class="set-pref-desc devices-folders">${d.folders.map((f) => `<code>${esc(f)}</code>`).join(" ")}</div>` : `<div class="set-pref-desc">No folder granted.</div>`}
        </div>
        <div class="set-pref-value">${a.source === "devices" && d.machineId ? `<button class="action-btn" data-disconnect="${esc(d.machineId)}" data-name="${esc(d.name)}">Disconnect</button>` : ""}</div>
      </div>`).join("")
    : `<div class="crud-empty">No machine is attached. Turn on Remote control under Settings → System in the Glyphh desktop app (or run <code>glyphh remote-control</code>) and it lists here.</div>`;
  if (blockedHost && blockedSec) {
    blockedSec.classList.toggle("hidden", !rows.blocked.length);
    blockedHost.innerHTML = rows.blocked.map((b) => `
      <div class="set-pref-row devices-row" data-device="${esc(b.device)}">
        <span class="devices-icon devices-icon-off">${LAPTOP_SVG}</span>
        <div class="set-pref-text">
          <div class="set-pref-title">${esc(b.name)}</div>
          <div class="set-pref-desc">${esc(appLabel(b.app, ""))}${b.disconnectedAt ? ` · disconnected ${esc(relativeTime(b.disconnectedAt))}` : ""} — it cannot attach until allowed again.</div>
        </div>
        <div class="set-pref-value"><button class="action-btn" data-allow="${esc(b.device)}" data-name="${esc(b.name)}">Allow</button></div>
      </div>`).join("");
  }
  list.querySelectorAll<HTMLButtonElement>("[data-disconnect]").forEach((b) => {
    b.onclick = async () => {
      const ok = await confirmAction({
        title: `Disconnect ${b.dataset.name || "this device"}?`,
        body: "Its remote-control socket closes now and it cannot attach again until you allow it here (and turn remote control on there again).",
        confirmLabel: "Disconnect",
        danger: true,
      });
      if (!ok) return;
      b.disabled = true;
      try { await api().attachDeviceDisconnect?.(b.dataset.disconnect || ""); }
      catch (err) { b.disabled = false; setStatus(err instanceof Error ? err.message : String(err)); return; }
      await loadDevices();
    };
  });
  blockedHost?.querySelectorAll<HTMLButtonElement>("[data-allow]").forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { await api().attachDeviceAllow?.(b.dataset.allow || ""); }
      catch (err) { b.disabled = false; setStatus(err instanceof Error ? err.message : String(err)); return; }
      setStatus(`${b.dataset.name || "The device"} may attach again — turn remote control on there.`);
      await loadDevices();
    };
  });
}

function setStatus(text: string): void {
  const s = el("devices-status");
  if (!s) return;
  s.textContent = text;
  s.classList.toggle("hidden", !text);
}

export async function loadDevices(): Promise<void> {
  if (loading) return;
  loading = true;
  try {
    const list = el("devices-list");
    if (list && !list.children.length) list.innerHTML = `<div class="crud-empty">Loading…</div>`;
    const a = await api().attachDevicesList?.();
    if (!a) { if (list) list.innerHTML = `<div class="crud-empty">Devices are not available here.</div>`; return; }
    setStatus("");
    paint(deviceRowsOf(a), a);
  } catch (err) {
    const list = el("devices-list");
    if (list) list.innerHTML = `<div class="crud-empty">Could not read your devices: ${esc(err instanceof Error ? err.message : String(err))}</div>`;
  } finally {
    loading = false;
  }
}

let wired = false;
export function initDevices(): void {
  if (wired) return;
  wired = true;
  el("devices-refresh")?.addEventListener("click", () => { void loadDevices(); });
}
