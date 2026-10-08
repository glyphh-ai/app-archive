/**
 * task-slot-pick.test.ts — WHO FILLS A TASK SLOT (his order, 2026-10-07:
 * tasks define cli or glyphh agents with models). The slot's model beats the
 * agent's; an unbound slot is the default Glyphh agent, never the roster's
 * first; a vanished agent fails the run by slot name; a CLI agent runs
 * through its CLI.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_NAME, pickSlotAgent, type SlotRosterEntry } from "../../src/main/task-slot-pick";

const roster: SlotRosterEntry[] = [
  { id: "ag_first", name: "First" },
  { id: "ag_writer", name: "Writer" },
  { id: "ag_coder", name: "Coder", kind: "cli", cli: "claude" },
];
const contexts: Record<string, { prompt: string; model?: string }> = {
  ag_first: { prompt: "I am first", model: "first-model" },
  ag_writer: { prompt: "Write well.", model: "writer-model" },
  ag_coder: { prompt: "Code well.", model: "claude-sonnet" },
};
const contextOf = (id: string) => contexts[id] ?? null;

describe("pickSlotAgent", () => {
  it("an unbound slot is the default Glyphh agent on the default model with no brief — never the roster's first", () => {
    const b = pickSlotAgent({ name: "main", agent: null }, roster, contextOf);
    expect(b).toEqual({ kind: "glyphh", agentId: null, agentName: DEFAULT_AGENT_NAME, prompt: "" });
    expect(b.model).toBeUndefined();
  });

  it("an unbound slot keeps its own model", () => {
    const b = pickSlotAgent({ name: "main", agent: null, model: "gpt-x" }, roster, contextOf);
    expect(b.model).toBe("gpt-x");
    expect(b.agentId).toBeNull();
  });

  it("the slot's model wins over the agent's", () => {
    const b = pickSlotAgent({ name: "draft", agent: "ag_writer", model: "slot-model" }, roster, contextOf);
    expect(b.model).toBe("slot-model");
    expect(b.prompt).toBe("Write well.");
    expect(b.agentName).toBe("Writer");
    expect(b.kind).toBe("glyphh");
  });

  it("without a slot model the agent's own model rides", () => {
    const b = pickSlotAgent({ name: "draft", agent: "ag_writer" }, roster, contextOf);
    expect(b.model).toBe("writer-model");
  });

  it("a slot naming an agent that no longer exists fails by slot name", () => {
    expect(() => pickSlotAgent({ name: "review", agent: "ag_gone" }, roster, contextOf))
      .toThrow(/slot "review" names an agent "ag_gone" that no longer exists/);
  });

  it("a CLI agent runs through its CLI, with the slot's model on top", () => {
    const b = pickSlotAgent({ name: "build", agent: "ag_coder", model: "claude-opus" }, roster, contextOf);
    expect(b).toMatchObject({ kind: "cli", cli: "claude", agentId: "ag_coder", agentName: "Coder", prompt: "Code well.", model: "claude-opus" });
  });

  it("a slot may declare the CLI lane itself, with no agent", () => {
    const b = pickSlotAgent({ name: "build", agent: null, kind: "cli", cli: "codex" }, roster, contextOf);
    expect(b).toMatchObject({ kind: "cli", cli: "codex", agentId: null, prompt: "" });
  });

  it("a slot declaring kind cli without a CLI, bound to a Glyphh agent, is refused", () => {
    expect(() => pickSlotAgent({ name: "build", agent: "ag_writer", kind: "cli" }, roster, contextOf))
      .toThrow(/runs through a CLI but neither it nor "Writer" names one/);
    expect(() => pickSlotAgent({ name: "build", agent: null, kind: "cli" }, roster, contextOf))
      .toThrow(/says kind "cli" but names no CLI/);
  });

  it("a slot pinned to glyphh overrides a CLI agent's lane", () => {
    const b = pickSlotAgent({ name: "build", agent: "ag_coder", kind: "glyphh" }, roster, contextOf);
    expect(b.kind).toBe("glyphh");
    expect(b.cli).toBeUndefined();
    expect(b.model).toBe("claude-sonnet");
  });

  it("blank models are no models", () => {
    const b = pickSlotAgent({ name: "main", agent: "ag_writer", model: "  " }, roster, contextOf);
    expect(b.model).toBe("writer-model");
  });
});
