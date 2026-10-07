/**
 * devices-pick — WHICH DEVICES A SESSION REACHES (his order, 2026-10-07): the
 * + menu's Devices rows are checks; an attached desktop is checked by default,
 * and the session's own list, once the member touches it, is what the run
 * names (HarnessRunBody.devices). The relay then opens ONLY those machines,
 * inside ONLY the folders each granted. Pure; code.ts and remote-run.ts call these.
 */

/** Is this device on for the session? No list yet = every attached device is. */
export function deviceChecked(chatDevices: readonly string[] | undefined, machineId: string): boolean {
  return chatDevices ? chatDevices.includes(machineId) : true;
}

/** The session's list after a toggle: materialised from the attached set the
 *  first time (the default was "all"), then the one id flipped. */
export function toggleDeviceIn(chatDevices: readonly string[] | undefined, machineId: string, attached: readonly string[]): string[] {
  const base = chatDevices ? [...chatDevices] : [...attached];
  return base.includes(machineId) ? base.filter((d) => d !== machineId) : [...base, machineId];
}

/** What the run names: the session's list, else every attached device; a
 *  device no longer attached is dropped either way (the gateway would refuse it). */
export function devicesForRun(chatDevices: readonly string[] | undefined, attached: readonly string[]): string[] {
  const picked = chatDevices ?? attached;
  return picked.filter((d) => attached.includes(d));
}

// ── THE DESKTOP IS ITS OWN DEVICE (his report, 2026-10-07: a Work session on
// the desktop, pointed at a local folder, was told "this session reaches no
// device"). A cloud turn born on a desktop names that desktop among its
// devices like any attached machine; what was missing was its FOLDER — the
// device tools reach only the folders a machine granted. The turn now
// carries its own folder for the machine it was born on. ─────────────────

/** This machine's row among the attached devices: the one whose stable
 *  device key is this host's name. Null when the desktop is not attached
 *  (remote control off) — then no folder can ride, and the steer says so. */
export function selfMachineId(rows: readonly { machineId: string; device: string }[], hostname: string): string | null {
  const host = hostname.trim().toLowerCase();
  if (!host) return null;
  const hit = rows.find((r) => r.device.trim().toLowerCase() === host && r.machineId);
  return hit ? hit.machineId : null;
}

/** The turn's own folders (HarnessRunBody.folders): on the desktop, the
 *  thread's local folder for this machine, when the turn names the machine. */
export function foldersForRun(opts: { surface: string; folder: string; selfId: string | null; devices: readonly string[] }): Record<string, string[]> {
  const folder = opts.folder.trim();
  if (opts.surface !== "desktop" || !folder.startsWith("/") || !opts.selfId || !opts.devices.includes(opts.selfId)) return {};
  return { [opts.selfId]: [folder.replace(/\/+$/, "") || "/"] };
}

/** The line a desktop-born cloud turn carries about its folder: where it is
 *  and the tools that reach it — or, with the desktop not attached, what to
 *  tell the member. Never a Terminal panel: that is not a tool. */
export function folderSteerLine(folder: string, hostname: string, attached: boolean): string {
  const f = folder.trim();
  if (!f) return "";
  const where = hostname.trim() ? `on the member's desktop "${hostname.trim()}"` : "on the member's desktop";
  if (!attached) {
    return `[The folder for this session is ${f} ${where}, but remote control is off there, so the device tools cannot reach it. Say so plainly and ask the member to turn on Settings → Remote control on that desktop; do not open a Terminal panel to work around it.]`;
  }
  return `[The folder for this session is ${f} ${where}. It is reachable now with the device tools — device_list_dir, device_read_file, device_search, device_write_file — on that device. Read it with those; a Terminal panel is not a tool you can drive.]`;
}
