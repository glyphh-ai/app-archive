/**
 * devices-pick — WHICH DEVICES A SESSION REACHES (his order, 2026-10-07): the
 * + menu's Devices rows are checks, and the session's own list is what the run
 * names (HarnessRunBody.devices). The relay then opens ONLY those machines,
 * inside ONLY the folders each granted.
 *
 * NOTHING IS ON BY ITSELF (his report, later that day: "Work is automatically
 * selecting the device; the user may not want to do that"). A session reaches
 * no device until the member checks one; the first check starts the list.
 * Pure; code.ts and remote-run.ts call these.
 */

/** Is this device on for the session? Only when the member checked it. */
export function deviceChecked(chatDevices: readonly string[] | undefined, machineId: string): boolean {
  return !!chatDevices && chatDevices.includes(machineId);
}

/** The session's list after a toggle: the one id flipped (an empty list the
 *  first time). `attached` is not consulted: nothing joins by default. */
export function toggleDeviceIn(chatDevices: readonly string[] | undefined, machineId: string, _attached: readonly string[]): string[] {
  const base = chatDevices ? [...chatDevices] : [];
  return base.includes(machineId) ? base.filter((d) => d !== machineId) : [...base, machineId];
}

/** What the run names: the session's list, none by default; a device no
 *  longer attached is dropped (the gateway would refuse it). */
export function devicesForRun(chatDevices: readonly string[] | undefined, attached: readonly string[]): string[] {
  return (chatDevices ?? []).filter((d) => attached.includes(d));
}

// ── THE DESKTOP IS ITS OWN DEVICE (his report, 2026-10-07: a Work session on
// the desktop, pointed at a local folder, was told "this session reaches no
// device"). A cloud turn born on a desktop names that desktop among its
// devices like any attached machine; what was missing was its FOLDER — the
// device tools reach only the folders a machine granted. The turn now
// carries its own folder for the machine it was born on. ─────────────────

/** This machine's row among the attached devices: the one whose NAME (its
 *  hello's hostname) is this host's. The server's `device` key is a HASH of
 *  app and hostname (attach.py device_key), so it never equals the hostname:
 *  matching on it lost this desktop and listed it as a remote machine (his
 *  report, 2026-10-09). Null when the desktop is not attached. */
export function selfMachineId(rows: readonly { machineId: string; device: string; name?: string }[], hostname: string): string | null {
  const host = hostname.trim().toLowerCase();
  if (!host) return null;
  const hit = rows.find((r) => r.machineId && (r.name ?? "").trim().toLowerCase() === host);
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
 *  and the tools that reach it — or, with the desktop not attached or not on
 *  for this session, what to tell the member. Never a Terminal panel: that is
 *  not a tool. */
export function folderSteerLine(folder: string, hostname: string, attached: boolean, on = true): string {
  const f = folder.trim();
  if (!f) return "";
  const where = hostname.trim() ? `on the member's desktop "${hostname.trim()}"` : "on the member's desktop";
  if (!attached) {
    return `[The folder for this session is ${f} ${where}, but remote control is off there, so the device tools cannot reach it. Say so plainly and ask the member to turn on Settings → System → Remote control on that desktop; do not open a Terminal panel to work around it.]`;
  }
  if (!on) {
    return `[The folder for this session is ${f} ${where}, but that device is not turned on for this session, so the device tools cannot reach it. Say so plainly and ask the member to check the device under + → Devices; do not open a Terminal panel to work around it.]`;
  }
  return `[The folder for this session is ${f} ${where}. It is reachable now with the device tools — device_list_dir, device_read_file, device_search, device_write_file — on that device. Read it with those; a Terminal panel is not a tool you can drive.]`;
}
