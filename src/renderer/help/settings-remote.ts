/**
 * settings-remote.ts — Settings → Remote control (his order, 2026-09-30): this
 * computer takes turns from mobile.glyphh.ai only while the switch is on, and
 * only inside the folders granted here. The setting is this device's and lives
 * in the member's server prefs (main/remote-control.ts); an org admin's switch
 * overrides it.
 */

/** Mirrors main/remote-control.ts RemoteControlView. */
interface RemoteControlView { enabled: boolean; folders: string[]; device: string; allowed: boolean; attached: boolean; refused?: string; ada: { device_id: string; name: string } | null }

const el = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

let wired = false;

function paint(v: RemoteControlView): void {
  const toggle = el<HTMLInputElement>("toggle-remote-control");
  const status = el("remote-status");
  const orgOff = el("remote-org-off");
  const list = el("remote-folders");
  const add = el<HTMLButtonElement>("remote-add-folder");
  if (!toggle || !status || !list) return;

  orgOff?.classList.toggle("hidden", v.allowed);
  toggle.checked = v.enabled;
  toggle.disabled = !v.allowed;
  if (add) add.disabled = !v.allowed;
  status.textContent = !v.allowed
    ? "Off — your organization doesn't allow remote control."
    : v.refused
      ? `Stopped — ${v.refused}.`
      : !v.enabled
        ? "Off — this computer is not reachable from mobile."
        : !v.folders.length
          ? "On, but no folder is granted yet — add one below."
          : v.attached
            ? `On — ${v.device} is reachable from mobile.glyphh.ai.`
            : "On — connecting…";

  list.innerHTML = v.folders.length
    ? v.folders.map((f) => `
      <div class="set-pref-row">
        <div class="set-pref-text"><div class="set-pref-title">${esc(f.split("/").filter(Boolean).pop() || f)}</div><div class="set-pref-desc">${esc(f)}</div></div>
        <div class="set-pref-value"><button class="action-btn" data-remove-folder="${esc(f)}">Remove</button></div>
      </div>`).join("")
    : `<div class="set-pref-desc">No folders granted.</div>`;
  list.querySelectorAll<HTMLButtonElement>("[data-remove-folder]").forEach((b) => {
    b.onclick = () => { void window.glyphh.remoteControlRemoveFolder?.(b.dataset.removeFolder || "").then(paint); };
  });
  paintAda(v);
}

/** Ada: whether this computer holds the records of the org's local Ada models. */
function paintAda(v: RemoteControlView): void {
  const status = el("ada-device-status");
  const register = el<HTMLButtonElement>("ada-register-device");
  if (!status || !register) return;
  register.classList.toggle("hidden", !!v.ada);
  register.disabled = !v.allowed;
  status.textContent = !v.ada
    ? "Not an Ada device. Register it, and an org admin can create Ada models whose records stay on this computer."
    : `Ada device ${v.ada.device_id} (${v.ada.name || v.device}) · ${v.attached ? "serving its records" : v.allowed ? "connecting…" : "offline: your organization doesn't allow remote connections"}`;
}

export async function loadRemoteControl(): Promise<void> {
  const g = window.glyphh;
  if (!wired) {
    wired = true;
    el<HTMLInputElement>("toggle-remote-control")?.addEventListener("change", (e) => {
      void g.remoteControlSetEnabled?.((e.target as HTMLInputElement).checked).then(paint);
    });
    el<HTMLButtonElement>("remote-add-folder")?.addEventListener("click", () => { void g.remoteControlAddFolder?.().then(paint); });
    el<HTMLButtonElement>("ada-register-device")?.addEventListener("click", (e) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true;
      void g.adaRegisterDevice?.().then(paint).catch((err: unknown) => {
        b.disabled = false;
        const s = el("ada-device-status");
        if (s) s.textContent = `Could not register: ${err instanceof Error ? err.message : String(err)}`;
      });
    });
    if (!g.adaRegisterDevice) el("ada-device-block")?.classList.add("hidden");
    g.onRemoteControlChanged?.(paint);
  }
  const v = await g.remoteControlGet?.().catch(() => null);
  if (v) paint(v);
}
