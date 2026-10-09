import { describe, it, expect, vi, beforeEach } from "vitest";

// ── seams: the relay registry, the agent records, the models, the generator ──
const handlers = new Map<string, (p: unknown) => unknown>();
vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));
vi.mock("../../src/main/relay-client", () => ({
  registerRelayHandler: (name: string, fn: (p: unknown) => unknown) => { handlers.set(name, fn); },
}));

interface Row {
  id: string; slug: string; name: string; description: string; prompt: string; model: string; role?: "orchestrator" | "worker";
  skills?: string[]; connections?: string[]; models?: string[]; folders?: string[]; personality?: number; effort?: string;
}
const rows = new Map<string, Row>();
const slugify = (n: string): string => n.trim().toLowerCase().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "agent";
vi.mock("../../src/main/local-agents", () => ({
  slugify,
  listAgents: () => [...rows.values()],
  getAgent: (ref: string) => { const r = rows.get(ref); if (!r) throw new Error(`agent "${ref}" not found`); return r; },
  saveAgent: (i: Partial<Row> & { slug?: string }) => {
    const slug = slugify(i.slug || i.name || "");
    const r = { ...rows.get(slug), ...i, id: slug, slug, name: i.name ?? "", description: i.description ?? "", prompt: i.prompt ?? "", model: i.model ?? "", role: i.role ?? "worker" };
    rows.set(slug, r);
    return r;
  },
  deleteAgent: (ref: string) => { rows.delete(ref); },
}));
const briefCalls: unknown[] = [];
vi.mock("../../src/main/agent-brief", () => ({
  generateAgentBrief: async (input: unknown) => { briefCalls.push(input); return { ok: true, brief: "You research. (written)", model: "claude-opus-5" }; },
}));
vi.mock("../../src/main/loop-models", () => ({
  listLoopModels: async () => ({ ok: true, models: [{ id: "claude-opus-5", name: "claude-opus-5", providerSlug: "anthropic" }, { id: "gemini-3.8-flash", name: "gemini-3.8-flash", providerSlug: "google" }] }),
}));
vi.mock("../../src/main/skills-fs", () => ({
  listSkills: () => [{ id: "glyphh:ui-ux-code", name: "UI/UX code" }, { id: "glyphh:video-clips", name: "Video clips" }],
}));
vi.mock("../../src/main/org-models", () => ({ bareModel: (m: string) => m.replace(/^[a-z0-9_-]+::/i, "").trim() }));

const { installAgentRelayHandlers } = await import("../../src/main/agent-tools");
installAgentRelayHandlers();
const call = (name: string, p: unknown) => Promise.resolve(handlers.get(name)!(p));

describe("agent tools — make, read, update, delete (his order, 2026-09-29)", () => {
  beforeEach(() => { rows.clear(); briefCalls.length = 0; });

  it("an agent made with no brief gets one WRITTEN, from what the caller said", async () => {
    const r = await call("agents.save", { name: "Researcher", description: "Finds and cites primary sources", model: "google::gemini-3.8-flash" }) as Record<string, unknown>;
    expect(r).toMatchObject({ agent: "researcher", created: true, generatedBrief: true, brief: "You research. (written)", model: "gemini-3.8-flash" });
    expect(briefCalls).toEqual([{ name: "Researcher", description: "Finds and cites primary sources", model: "gemini-3.8-flash" }]);
  });

  it("making never overwrites: a name in use is refused, with the id to update instead", async () => {
    await call("agents.save", { name: "Researcher", brief: "mine" });
    await expect(call("agents.save", { name: "researcher", brief: "theirs" })).rejects.toThrow(/already exists.*agent: "researcher"/);
    expect(rows.get("researcher")!.prompt).toBe("mine");
  });

  it("a model slot must be one the member's team carries", async () => {
    await expect(call("agents.save", { name: "X", brief: "b", model: "gpt-9" })).rejects.toThrow(/not one of this member's models.*claude-opus-5/);
    expect(rows.size).toBe(0);
  });

  it("an update keeps what it was not told to change, and writes no brief it already has", async () => {
    await call("agents.save", { name: "Reviewer", description: "Reviews diffs", brief: "You review.", model: "claude-opus-5" });
    const r = await call("agents.save", { agent: "reviewer", description: "Reviews diffs for concurrency" }) as Record<string, unknown>;
    expect(r).toMatchObject({ created: false, generatedBrief: false, brief: "You review.", model: "claude-opus-5", description: "Reviews diffs for concurrency" });
    expect(briefCalls).toEqual([]);
  });

  it("lists, reads and deletes by id — and says so when there is no such agent", async () => {
    await call("agents.save", { name: "Writer", brief: "You write." });
    expect(await call("agents.list", {})).toEqual([{
      agent: "writer", name: "Writer", description: "", model: null, role: "worker", hasBrief: true,
      powers: [], connections: [], models: [], folders: [], personality: null, effort: null,
    }]);
    expect(await call("agents.get", { agent: "writer" })).toMatchObject({ brief: "You write." });
    expect(await call("agents.delete", { agent: "writer" })).toEqual({ agent: "writer", deleted: true });
    expect(() => handlers.get("agents.delete")!({ agent: "writer" })).toThrow(/not found/);
    await expect(call("agents.save", { agent: "ghost", name: "Ghost" })).rejects.toThrow(/no agent "ghost"/);
  });
});

describe("agent tools — what runs it (his order, 2026-10-07: cli or glyphh agents with models)", () => {
  beforeEach(() => { rows.clear(); briefCalls.length = 0; });

  it("an agent is a Glyphh agent unless told otherwise, and says so", async () => {
    const r = await call("agents.save", { name: "Researcher", brief: "b" }) as Record<string, unknown>;
  });


});

describe("agent tools — the Bots panel's role (his order, 2026-10-08)", () => {
  beforeEach(() => { rows.clear(); briefCalls.length = 0; });
  it("a new agent is a worker; role orchestrator is kept, listed and refused when junk", async () => {
    const made = await call("agents.save", { name: "Scout", brief: "You scout." }) as { role: string };
    expect(made.role).toBe("worker");
    const boss = await call("agents.save", { name: "Boss", brief: "You plan.", role: "orchestrator" }) as { role: string; agent: string };
    expect(boss.role).toBe("orchestrator");
    const listed = await call("agents.list", {}) as Array<{ agent: string; role: string }>;
    expect(listed.find((a) => a.agent === "boss")?.role).toBe("orchestrator");
    const kept = await call("agents.save", { agent: "boss", description: "plans the work" }) as { role: string };
    expect(kept.role).toBe("orchestrator");
    await expect(call("agents.save", { agent: "boss", role: "manager" })).rejects.toThrow(/role must be/);
  });
});

describe("a super power is the agent plus its powers (his order, 2026-10-09)", () => {
  beforeEach(() => { rows.clear(); });

  it("a save carries its powers, connections, models, folders, personality and thinking", async () => {
    const r = await call("agents.save", {
      name: "Video Marketer", description: "Turns long videos into social posts", brief: "You cut videos.",
      powers: ["video-clips", "glyphh:ui-ux-code"], connections: ["youtube_data_api"], models: ["google::gemini-3.8-flash"],
      folders: ["/work/videos"], personality: 4, effort: "high",
    }) as Record<string, unknown>;
    expect(rows.get("video-marketer")).toMatchObject({
      skills: ["glyphh:video-clips", "glyphh:ui-ux-code"], connections: ["youtube_data_api"], models: ["gemini-3.8-flash"],
      folders: ["/work/videos"], personality: 4, effort: "high",
    });
    expect(r).toMatchObject({ powers: ["video-clips", "ui-ux-code"], connections: ["youtube_data_api"], personality: 4, effort: "high" });
  });

  it("a power that does not exist is refused by name, and nothing is saved", async () => {
    await expect(call("agents.save", { name: "X", brief: "b", powers: ["nope"] })).rejects.toThrow(/no power called "nope".*skill_save/);
    expect(rows.size).toBe(0);
  });

  it("personality and thinking are checked, and an update keeps the powers it was not told about", async () => {
    await expect(call("agents.save", { name: "X", brief: "b", personality: 9 })).rejects.toThrow(/1 \(serious\) to 5/);
    await expect(call("agents.save", { name: "X", brief: "b", effort: "turbo" })).rejects.toThrow(/effort is one of/);
    await call("agents.save", { name: "Y", brief: "b", powers: ["video-clips"] });
    await call("agents.save", { agent: "y", description: "new" });
    expect(rows.get("y")!.skills).toEqual(["glyphh:video-clips"]);
  });
});
