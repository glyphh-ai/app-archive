/**
 * ada-device.ts — THIS COMPUTER AS AN ADA DEVICE (his order, 2026-10-01). An
 * org's "local" Ada model keeps its records on a device the org registered;
 * the server runs the kernel and reads them over the attach relay. This
 * computer holds those records and nothing else: no kernel, no model config.
 *
 * THE ZERO-LOCAL EXCEPTION (his call, 2026-10-01, option A): these two files
 * are the only things this app keeps on the machine for Ada — the device id
 * and the record store — because the customer chose to keep that model's data
 * here. They are the CLI's files too (cli/src/ada.ts), so the CLI and the app
 * are one device on one computer.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { openAdaStore, type SqlDatabase } from "@glyphh/sdk/runtime";
import { getClient } from "./glyphh-client.js";

type Handler = (params: unknown) => Promise<unknown>;

const HOME = process.env.GLYPHH_HOME || join(homedir(), ".glyphh");
export const DEVICE_FILE = join(HOME, "ada-device.json");
export const RECORDS_FILE = join(HOME, "ada-records.db");

export interface AdaDeviceInfo { device_id: string; name: string }

export function adaDevice(): AdaDeviceInfo | null {
  try {
    const d = JSON.parse(readFileSync(DEVICE_FILE, "utf8")) as Partial<AdaDeviceInfo>;
    return typeof d.device_id === "string" && /^dev_[0-9a-f]{12}$/.test(d.device_id) ? { device_id: d.device_id, name: String(d.name ?? "") } : null;
  } catch {
    return null;
  }
}

/** Register this computer with the signed-in member's org (once). */
export async function registerAdaDevice(): Promise<AdaDeviceInfo> {
  const existing = adaDevice();
  if (existing) return existing;
  const dev = await getClient().ada.registerDevice(hostname());
  mkdirSync(dirname(DEVICE_FILE), { recursive: true });
  writeFileSync(DEVICE_FILE, JSON.stringify(dev, null, 2), { mode: 0o600 });
  return dev;
}

let handlers: Record<string, Handler> | null = null;

/** The ada.* table over the record store, opened once; none until registered. */
export async function adaHandlers(): Promise<Record<string, Handler>> {
  if (!adaDevice()) return {};
  if (!handlers) {
    if (!existsSync(dirname(RECORDS_FILE))) mkdirSync(dirname(RECORDS_FILE), { recursive: true });
    handlers = await openAdaStore(RECORDS_FILE, (path) => new Database(path) as unknown as SqlDatabase);
  }
  return handlers;
}
