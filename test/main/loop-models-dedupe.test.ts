import { describe, it, expect, vi } from "vitest";

// loop-models reaches for Electron and the server client at import time; the
// dedupe itself is pure, so the seams are stubbed to nothing.
vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));
vi.mock("../../src/main/cli-agents", () => ({
  agentRowFor: () => null, CLI_PROFILES: {}, DIRECT_PREFIX: "direct:",
  gatewayLaneMode: () => "off", refreshGatewayMode: async () => {},
}));
vi.mock("../../src/main/glyphh-client", () => ({ getClient: () => ({ models: { available: async () => [], direct: async () => [] } }) }));
vi.mock("../../src/main/gateway-token", () => ({ gatewayCreds: async () => null }));

const { dedupeByName } = await import("../../src/main/loop-models");
const m = (name: string, lane?: "gateway" | "direct", extra: Record<string, unknown> = {}) =>
  ({ id: name, name, providerSlug: "anthropic", ...(lane ? { lane } : {}), ...extra }) as never;

describe("dedupeByName", () => {
  // His report, 2026-09-25: claude-fable-5-1 and claude-haiku-4-5 each listed twice.
  it("keeps one row per name and keeps the first", () => {
    const out = dedupeByName([
      m("claude-fable-5-1", "gateway", { source: "catalog" }),
      m("claude-haiku-4-5", "gateway"),
      m("claude-fable-5-1", "gateway", { source: "local" }),
      m("claude-haiku-4-5", "gateway"),
    ]);
    expect(out.map((r) => r.name)).toEqual(["claude-fable-5-1", "claude-haiku-4-5"]);
    expect(out[0].source).toBe("catalog");
  });

  it("never collapses across lanes: one model, two lanes, two picks", () => {
    const out = dedupeByName([m("claude-opus-5", "gateway"), m("claude-opus-5", "direct")]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.lane)).toEqual(["gateway", "direct"]);
  });

  it("reads a repeat through case and stray space", () => {
    expect(dedupeByName([m("GPT-5"), m(" gpt-5 ")])).toHaveLength(1);
  });

  it("leaves a list with no repeats exactly as it found it", () => {
    const rows = [m("a"), m("b"), m("c")];
    expect(dedupeByName(rows).map((r) => r.name)).toEqual(["a", "b", "c"]);
  });
});
