/**
 * app-rpa-gate.test.ts — AN APP PANEL REACHES THE RPA TOOLING (his order,
 * 2026-10-07): rpa.* is gated by the instance's own manifest, refused with the
 * bridge's sentence, and mapped onto the relay registry's method names.
 */
import { describe, expect, it } from "vitest";
import { RPA_APP_METHODS, isRpaAppMethod, notGranted, rpaCapabilityAllowed } from "../../src/main/app-rpa-gate";

describe("rpaCapabilityAllowed", () => {
  const manifest = { name: "Mailer", tools: [], capabilities: ["db.exec", "rpa.run", "rpa.commands"], connectors: [] };

  it("a declared capability maps to its relay method", () => {
    expect(rpaCapabilityAllowed(manifest, "rpa.run")).toEqual({ ok: true, relay: "rpa.run" });
    expect(rpaCapabilityAllowed(manifest, "rpa.commands")).toEqual({ ok: true, relay: "rpa.commands" });
  });

  it("rpa.sequence rides to rpa.sequenceRun on the registry", () => {
    const m = { ...manifest, capabilities: ["rpa.sequence"] };
    expect(rpaCapabilityAllowed(m, "rpa.sequence")).toEqual({ ok: true, relay: "rpa.sequenceRun" });
    expect(RPA_APP_METHODS["rpa.sequence"]).toBe("rpa.sequenceRun");
  });

  it("an undeclared capability is refused with the bridge's words, before any dispatch", () => {
    expect(rpaCapabilityAllowed(manifest, "rpa.sequence")).toEqual({ ok: false, error: "capability not granted: rpa.sequence" });
    expect(notGranted("rpa.sequence")).toBe("capability not granted: rpa.sequence");
  });

  it("no manifest grants nothing", () => {
    expect(rpaCapabilityAllowed(null, "rpa.run")).toEqual({ ok: false, error: "capability not granted: rpa.run" });
    expect(rpaCapabilityAllowed(undefined, "rpa.run").ok).toBe(false);
    expect(rpaCapabilityAllowed({ capabilities: "rpa.run" }, "rpa.run").ok).toBe(false);
  });

  it("an rpa.* name that is not a capability is unknown, even when 'declared'", () => {
    const m = { ...manifest, capabilities: ["rpa.eval", "rpa.sequenceRun"] };
    expect(rpaCapabilityAllowed(m, "rpa.eval")).toEqual({ ok: false, error: "unknown capability: rpa.eval" });
    // The registry name is not the capability name: a panel declares rpa.sequence.
    expect(rpaCapabilityAllowed(m, "rpa.sequenceRun")).toEqual({ ok: false, error: "unknown capability: rpa.sequenceRun" });
  });

  it("isRpaAppMethod picks the rpa.* lane and nothing else", () => {
    expect(isRpaAppMethod("rpa.run")).toBe(true);
    expect(isRpaAppMethod("rpa.anything")).toBe(true);
    expect(isRpaAppMethod("db.exec")).toBe(false);
    expect(isRpaAppMethod("")).toBe(false);
  });
});
