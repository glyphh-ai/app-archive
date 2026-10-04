/**
 * devices-rows.ts — ONE row shape for Settings → Devices, from either answer
 * (his order, 2026-10-04): the server's /api/attach/devices (attached
 * machines + the ones disconnected from the web) or, until it lands,
 * attach.status's machines. Pure — no DOM — so settings-devices.ts paints
 * what this decides and the unit test runs it bare.
 */

export interface DeviceRow {
  /** The per-connection machine id (Disconnect takes it). */
  machineId: string;
  /** The STABLE device key (Allow takes it). */
  device: string;
  name: string;
  app: string;
  version: string;
  since: number;
  capabilities: string[];
  folders: string[];
  remote: boolean;
}
export interface BlockedRow { device: string; name: string; app: string; disconnectedAt: number }

export interface DevicesAnswer {
  source: "devices" | "status";
  allowed?: boolean;
  devices: Array<Record<string, unknown>>;
  blocked: Array<Record<string, unknown>>;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
/** Seconds (the server's `since`) or milliseconds — both read as epoch ms. */
const epochMs = (v: unknown): number => { const n = num(v); return n && n < 1e12 ? n * 1000 : n; };

/** ONE row shape from either answer. Pure, for the test. */
export function deviceRowsOf(a: DevicesAnswer): { devices: DeviceRow[]; blocked: BlockedRow[] } {
  const devices = a.devices.map((d): DeviceRow => ({
    machineId: str(d.id) || str(d.machineId),
    device: str(d.device),
    name: str(d.name) || str(d.app) || "Glyphh desktop",
    app: str(d.app),
    version: str(d.version),
    since: epochMs(d.since),
    capabilities: strs(d.capabilities),
    folders: strs(d.folders),
    remote: typeof d.remote === "boolean" ? d.remote : strs(d.capabilities).length > 0,
  })).filter((d) => !!d.machineId || !!d.device);
  const blocked = a.blocked.map((b): BlockedRow => ({
    device: str(b.device),
    name: str(b.name) || str(b.app) || "Glyphh desktop",
    app: str(b.app),
    disconnectedAt: epochMs(b.disconnectedAt),
  })).filter((b) => !!b.device);
  return { devices, blocked };
}
