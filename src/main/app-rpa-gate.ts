/**
 * app-rpa-gate.ts — AN APP PANEL REACHES THE RPA TOOLING (his order,
 * 2026-10-07: "give apps, agents, skills, plugins — everything — the ability
 * to call the rpa tooling").
 *
 * A panel's `glyphh.call("rpa.*", args)` is the one call that does NOT ride
 * to the app's cloud instance: the mapped commands live on this desktop's
 * tabs, so main answers it here, on the relay registry (rpa-map.ts). The
 * gate is the manifest's capability list, checked the same way the bridge
 * checks everything else — an undeclared name is refused BEFORE any dispatch
 * with the bridge's own sentence, so an app sees one rule on both sides.
 *
 * Pure: the manifest is handed in, so the gate is testable on its own.
 */

/** Capability name → relay method on the registry. */
export const RPA_APP_METHODS: Readonly<Record<string, string>> = {
  "rpa.commands": "rpa.commands",
  "rpa.run": "rpa.run",
  "rpa.sequence": "rpa.sequenceRun",
};

export const isRpaAppMethod = (method: string): boolean => method.startsWith("rpa.");

export type RpaGate = { ok: true; relay: string } | { ok: false; error: string };

/** The bridge's words (rrotor app-server/bridge.ts) for a name the manifest
 *  does not declare, so a panel cannot tell the two sides apart. */
export const notGranted = (method: string): string => `capability not granted: ${method}`;

export function rpaCapabilityAllowed(manifest: { capabilities?: unknown } | null | undefined, method: string): RpaGate {
  const relay = RPA_APP_METHODS[method];
  if (!relay) return { ok: false, error: `unknown capability: ${method}` };
  const caps = Array.isArray(manifest?.capabilities) ? (manifest!.capabilities as unknown[]).map(String) : [];
  if (!caps.includes(method)) return { ok: false, error: notGranted(method) };
  return { ok: true, relay };
}
