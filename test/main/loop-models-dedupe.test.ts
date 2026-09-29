import { describe, it, expect, vi } from "vitest";

// loop-models reaches for Electron and the server client at import time; the
// dedupe itself is pure, so the seams are stubbed to nothing.
vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));
vi.mock("../../src/main/glyphh-client", () => ({ getClient: () => ({ models: { available: async () => [] } }) }));
vi.mock("../../src/main/gateway-token", () => ({ gatewayCreds: async () => null }));

const { dedupeByName } = await import("../../src/main/loop-models");
const m = (name: string, extra: Record<string, unknown> = {}) =>
  ({ id: name, name, providerSlug: "anthropic", ...extra }) as never;

describe("dedupeByName", () => {
  // His report, 2026-09-25: claude-fable-5-1 and claude-haiku-4-5 each listed twice.
  it("keeps one row per name and keeps the first", () => {
    const out = dedupeByName([
      m("claude-fable-5-1", { source: "catalog" }),
      m("claude-haiku-4-5"),
      m("claude-fable-5-1", { source: "local" }),
      m("claude-haiku-4-5"),
    ]);
    expect(out.map((r) => r.name)).toEqual(["claude-fable-5-1", "claude-haiku-4-5"]);
    expect(out[0].source).toBe("catalog");
  });

  // The two-lane exception went with the CLI lane (2026-09-28): one list now,
  // so the same name IS the same pick.
  it("collapses a repeat whatever else the row carries", () => {
    expect(dedupeByName([m("claude-opus-5", { source: "catalog" }), m("claude-opus-5", { source: "local" })])).toHaveLength(1);
  });

  it("reads a repeat through case and stray space", () => {
    expect(dedupeByName([m("GPT-5"), m(" gpt-5 ")])).toHaveLength(1);
  });

  it("leaves a list with no repeats exactly as it found it", () => {
    const rows = [m("a"), m("b"), m("c")];
    expect(dedupeByName(rows).map((r) => r.name)).toEqual(["a", "b", "c"]);
  });
});
