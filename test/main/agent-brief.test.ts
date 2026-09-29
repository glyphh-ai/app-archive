import { describe, it, expect, vi, beforeEach } from "vitest";

// The generator's seams: the gateway credential, the member's prefs, their
// team's models, and the one gateway call.
vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));
let creds: { baseUrl: string; token: string } | null = { baseUrl: "https://gw", token: "k" };
vi.mock("../../src/main/gateway-token", () => ({ gatewayCreds: async () => creds }));
let teamDefault = "claude-opus-5";
vi.mock("../../src/main/org-models", () => ({
  bareModel: (m: string) => m.replace(/^[a-z0-9_-]+::/i, "").trim(),
  orgRequiredModel: () => teamDefault,
}));
let prefDefault = "";
vi.mock("../../src/main/stores/preferences-db", () => ({ getPreference: (k: string, d: unknown) => (k === "defaultModel" ? prefDefault : d) }));
vi.mock("../../src/main/loop-models", () => ({
  listLoopModels: async () => ({ ok: true, models: [{ id: "claude-opus-5" }, { id: "gemini-3.8-flash" }] }),
}));
const sent: Array<{ model: string; content: string }> = [];
vi.mock("@glyphh/sdk/loop", () => ({
  streamMessage: async (o: { body: { model: string; messages: Array<{ content: string }> } }) => {
    sent.push({ model: o.body.model, content: o.body.messages[0]!.content });
    return { content: [{ type: "text", text: "  You research one question at a time.  " }] };
  },
}));

const { generateAgentBrief } = await import("../../src/main/agent-brief");

describe("generateAgentBrief — the wand (his order, 2026-09-29)", () => {
  beforeEach(() => { sent.length = 0; creds = { baseUrl: "https://gw", token: "k" }; teamDefault = "claude-opus-5"; prefDefault = ""; });

  it("asks for information first, and spends nothing without it", async () => {
    const r = await generateAgentBrief({ name: " ", description: "" });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/Say what the agent is for first/);
    expect(sent).toEqual([]);
  });

  it("writes on the member's OWN default model when their team still carries it", async () => {
    prefDefault = "google::gemini-3.8-flash";
    const r = await generateAgentBrief({ name: "Researcher", description: "Cites sources", model: "claude-opus-5", draft: "be terse" });
    expect(r).toEqual({ ok: true, brief: "You research one question at a time.", model: "gemini-3.8-flash" });
    expect(sent[0]!.model).toBe("gemini-3.8-flash");
    // Everything the person typed goes in — the draft is improved, not dropped.
    expect(sent[0]!.content).toContain("Name: Researcher");
    expect(sent[0]!.content).toContain("Cites sources");
    expect(sent[0]!.content).toContain("be terse");
  });

  it("falls back to the team's default when the member's pick is gone, and says so when there is none", async () => {
    prefDefault = "retired-model";
    await generateAgentBrief({ name: "X" });
    expect(sent[0]!.model).toBe("claude-opus-5");
    teamDefault = "";
    prefDefault = "";
    const r = await generateAgentBrief({ name: "X" });
    expect((r as { error: string }).error).toMatch(/Pick a default model in Settings/);
  });

  it("the gateway off is a sentence, not a crash", async () => {
    creds = null;
    const r = await generateAgentBrief({ name: "X" });
    expect((r as { error: string }).error).toMatch(/gateway isn't available/);
  });
});
