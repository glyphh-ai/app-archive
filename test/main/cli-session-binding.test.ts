/**
 * The chat ⇄ CLI-session binding. His report, 2026-09-25: "when the user is in
 * the cli and switches to the glyphh session the state is not in synch. They
 * MUST always be in sync 100000%% of the time."
 *
 * Each case below is one of the ways the binding could be wrong — pinned so it
 * cannot come back.
 */
import { describe, it, expect } from "vitest";
import {
  sessionCliOf, cliSidFor, applyCliBinding, chatForCliSession, forgetCliSession,
  sessionDisplayTitle, SESS_TITLE_MAX, DEFAULT_CLI, type CliBound, type LoopRow,
} from "../../src/renderer/help/cli-session-binding";

/** The roster as refreshLoops() builds it: server rows mirror cli into
 *  description, and the BUILT-IN default carries prose there instead. */
const LOOPS: LoopRow[] = [
  { id: "default", description: "The standard Glyphh agent loop." },
  { id: "loop-claude", cli: "claude", description: "claude" },
  { id: "loop-codex", cli: "codex", description: "codex" },
  { id: "loop-gemini", cli: "gemini", description: "gemini" },
];

describe("which CLI a chat runs on", () => {
  it("reads the loop's cli field", () => {
    expect(sessionCliOf("loop-codex", LOOPS)).toBe("codex");
    expect(sessionCliOf("loop-gemini", LOOPS)).toBe("gemini");
  });

  it("does NOT take the built-in default's prose as a CLI key", () => {
    // The bug: `loops.find(...).description` returned "The standard Glyphh
    // agent loop." — a key no binding map will ever hold, so every lookup
    // missed and the run silently fell back to claude.
    const cli = sessionCliOf("default", LOOPS);
    expect(cli).toBe(DEFAULT_CLI);
    expect(cli).not.toContain(" ");
  });

  it("falls back to claude for an unknown or absent loop", () => {
    expect(sessionCliOf("loop-that-was-deleted", LOOPS)).toBe("claude");
    expect(sessionCliOf(undefined, LOOPS)).toBe("claude");
    expect(sessionCliOf("", LOOPS)).toBe("claude");
  });
});

describe("resolving a resume id for one lane", () => {
  it("returns the lane's own id", () => {
    const row: CliBound = { cliSessionIds: { claude: "c-sid", codex: "x-sid" } };
    expect(cliSidFor(row, "claude")).toBe("c-sid");
    expect(cliSidFor(row, "codex")).toBe("x-sid");
  });

  it("NEVER feeds one CLI's id to another (his ruling, 2026-09-14)", () => {
    const row: CliBound = { cliSessionIds: { claude: "c-sid" }, cliSessionId: "c-sid" };
    // codex has no binding here — the honest answer is null, so the terminal
    // opens fresh rather than resuming with a claude id it cannot use.
    expect(cliSidFor(row, "codex")).toBeNull();
    expect(cliSidFor(row, "gemini")).toBeNull();
  });

  it("reads the legacy single slot for claude only", () => {
    const legacy: CliBound = { cliSessionId: "old-sid" };
    expect(cliSidFor(legacy, "claude")).toBe("old-sid");
    expect(cliSidFor(legacy, "codex")).toBeNull();
  });

  it("prefers the per-CLI map over the legacy slot", () => {
    const row: CliBound = { cliSessionIds: { claude: "new-sid" }, cliSessionId: "stale-sid" };
    expect(cliSidFor(row, "claude")).toBe("new-sid");
  });

  it("answers null for no row at all", () => {
    expect(cliSidFor(undefined, "claude")).toBeNull();
  });
});

describe("writing a binding", () => {
  it("mirrors into the legacy slot for claude", () => {
    const row: CliBound = {};
    expect(applyCliBinding(row, "claude", "sid-1")).toBe(true);
    expect(row.cliSessionIds).toEqual({ claude: "sid-1" });
    expect(row.cliSessionId).toBe("sid-1");
  });

  it("does NOT park a codex id in the claude-only legacy slot", () => {
    // A codex sid there is exactly what a later claude resume would pick up.
    const row: CliBound = {};
    applyCliBinding(row, "codex", "x-sid");
    expect(row.cliSessionIds).toEqual({ codex: "x-sid" });
    expect(row.cliSessionId).toBeUndefined();
    expect(cliSidFor(row, "claude")).toBeNull();
  });

  it("keeps lanes independent when a chat has run on several CLIs", () => {
    const row: CliBound = {};
    applyCliBinding(row, "claude", "c1");
    applyCliBinding(row, "codex", "x1");
    applyCliBinding(row, "gemini", "g1");
    expect(cliSidFor(row, "claude")).toBe("c1");
    expect(cliSidFor(row, "codex")).toBe("x1");
    expect(cliSidFor(row, "gemini")).toBe("g1");
  });

  it("reports no change when the binding already holds", () => {
    const row: CliBound = {};
    expect(applyCliBinding(row, "codex", "x1")).toBe(true);
    expect(applyCliBinding(row, "codex", "x1")).toBe(false);   // no save owed
    expect(applyCliBinding(row, "codex", "x2")).toBe(true);
  });

  it("heals a row whose legacy slot drifted from its map", () => {
    const row: CliBound = { cliSessionIds: { claude: "sid" }, cliSessionId: "stale" };
    expect(applyCliBinding(row, "claude", "sid")).toBe(true);
    expect(row.cliSessionId).toBe("sid");
  });

  it("ignores an empty id", () => {
    const row: CliBound = {};
    expect(applyCliBinding(row, "claude", "")).toBe(false);
    expect(row.cliSessionIds).toBeUndefined();
  });

  it("treats a missing cli as the claude lane", () => {
    const row: CliBound = {};
    applyCliBinding(row, "", "sid");
    expect(cliSidFor(row, "claude")).toBe("sid");
  });
});

describe("finding the chat that already holds a session", () => {
  it("matches a CODEX session held only in the per-CLI map", () => {
    // THE DUPLICATE-ROW BUG: the old lookup only checked the legacy slot,
    // which no codex session ever populates — so every hop back forked a new
    // chat for one conversation.
    const chats: CliBound[] = [
      { cliSessionIds: { claude: "c1" }, cliSessionId: "c1" },
      { cliSessionIds: { codex: "x1" } },
    ];
    expect(chatForCliSession(chats, "x1")).toBe(chats[1]);
  });

  it("matches a legacy claude row with no map at all", () => {
    const chats: CliBound[] = [{ cliSessionId: "old" }];
    expect(chatForCliSession(chats, "old")).toBe(chats[0]);
  });

  it("prefers the map holder when both could match", () => {
    const chats: CliBound[] = [{ cliSessionId: "s" }, { cliSessionIds: { codex: "s" } }];
    expect(chatForCliSession(chats, "s")).toBe(chats[1]);
  });

  it("finds nothing for an unknown or empty id", () => {
    const chats: CliBound[] = [{ cliSessionIds: { claude: "c1" } }];
    expect(chatForCliSession(chats, "nope")).toBeUndefined();
    expect(chatForCliSession(chats, "")).toBeUndefined();
    expect(chatForCliSession([], "c1")).toBeUndefined();
  });
});

describe("letting go of a deleted session", () => {
  it("clears every lane pointing at it, and the legacy slot", () => {
    const row: CliBound = { cliSessionIds: { claude: "dead", codex: "alive" }, cliSessionId: "dead" };
    expect(forgetCliSession(row, "dead")).toBe(true);
    expect(row.cliSessionId).toBeUndefined();
    expect(row.cliSessionIds).toEqual({ codex: "alive" });
  });

  it("leaves an unrelated row untouched", () => {
    const row: CliBound = { cliSessionIds: { claude: "mine" } };
    expect(forgetCliSession(row, "someone-elses")).toBe(false);
    expect(row.cliSessionIds).toEqual({ claude: "mine" });
  });
});

describe("one title grammar for the merged rail", () => {
  it("cuts the 80-char native titles down to the list's own width", () => {
    const native = "a".repeat(80);
    const shown = sessionDisplayTitle(native);
    expect(shown.length).toBeLessThanOrEqual(SESS_TITLE_MAX);
    expect(shown.endsWith("…")).toBe(true);
  });

  it("leaves a short title exactly as it is", () => {
    expect(sessionDisplayTitle("fix the sync bug")).toBe("fix the sync bug");
  });

  it("collapses the newlines a pasted prompt carries in", () => {
    expect(sessionDisplayTitle("fix   the\n\nsync\tbug")).toBe("fix the sync bug");
  });

  it("never renders an empty row", () => {
    expect(sessionDisplayTitle("")).toBe("Session");
    expect(sessionDisplayTitle("   ")).toBe("Session");
    expect(sessionDisplayTitle(undefined)).toBe("Session");
  });

  it("does not leave a dangling space before the ellipsis", () => {
    expect(sessionDisplayTitle(`${"b".repeat(SESS_TITLE_MAX - 1)} tail`)).not.toContain(" …");
  });
});
