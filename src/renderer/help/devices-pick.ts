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
