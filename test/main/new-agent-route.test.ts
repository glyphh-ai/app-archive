import { describe, it, expect } from "vitest";
import { routeNewAgent, routeNewChatInPanel, resolveLoop } from "../../src/renderer/help/new-agent-route.js";

const LOOPS = ["claude", "codex", "gemini"];
const VIEWS = ["cli", "glyphh"] as const;

describe("new-agent routing", () => {
  describe("THE RULE: agents are not singletons", () => {
    // His ruling, 2026-09-25: "When you open a glyphh agent from the side
    // panel or from any of the agent icons on the home page they are NOT
    // singletons... they should open new agent windows every time you click
    // one. Period."
    it("opens another agent on EVERY press, in every view, seated or not", () => {
      for (const view of VIEWS) {
        for (const agentSeated of [true, false]) {
          const a = routeNewAgent({ loops: LOOPS, view, agentSeated });
          expect(a.kind, `view=${view} seated=${agentSeated}`).not.toBe("in-place");
        }
      }
    });

    it("never reuses the seated agent — pressing New twice gives two agents", () => {
      // The original bug: the second press blanked the first agent's thread
      // and spawned nothing.
      const first = routeNewAgent({ loops: LOOPS, view: "glyphh", agentSeated: false });
      const second = routeNewAgent({ loops: LOOPS, view: "glyphh", agentSeated: true });
      expect(first.kind).toBe("open");        // uses the page's own agent
      expect(second.kind).toBe("instance");   // a whole second panel
      expect(second.kind === "instance" && second.loop).toBe("claude");
    });

    it("keeps minting instances however many are already up", () => {
      // Seated stays true from the second press onward; it must never
      // saturate into "just focus the one that exists".
      for (let n = 0; n < 5; n++) {
        expect(routeNewAgent({ loops: LOOPS, view: "glyphh", agentSeated: true }).kind).toBe("instance");
      }
    });
  });

  describe("THE ONE EXCEPTION: the agent header's +", () => {
    it("starts a new chat in place — never a new agent", () => {
      // His ruling: "the only new agent door that doesn't is the + button in
      // the top right of the agent window."
      expect(routeNewChatInPanel()).toEqual({ kind: "in-place" });
    });

    it("is the ONLY route that ever answers in-place", () => {
      for (const view of VIEWS) {
        for (const agentSeated of [true, false]) {
          expect(routeNewAgent({ loops: LOOPS, view, agentSeated }).kind).not.toBe("in-place");
        }
      }
    });
  });

  describe("cli view", () => {
    it("mints a FRESH cli conversation, never re-attaching a parked buffer", () => {
      // Without fresh, openAgentCliCard re-attaches the parked pty and the
      // "new" agent silently resumes the old conversation.
      expect(routeNewAgent({ loops: LOOPS, view: "cli", agentSeated: true }))
        .toEqual({ kind: "cli", loop: "claude", fresh: true });
    });

    it("still opens an agent when no cli is installed to spawn", () => {
      // view says cli, but there is no loop — it must still produce an agent
      // rather than falling through to doing nothing.
      const a = routeNewAgent({ loops: [], view: "cli", agentSeated: true });
      expect(a).toEqual({ kind: "instance", loop: null });
    });
  });

  describe("loop resolution", () => {
    it("prefers the caller's loop, then the default, then the first installed", () => {
      expect(resolveLoop({ loops: LOOPS, view: "cli", agentSeated: false, loop: "codex", defaultLoop: "gemini" })).toBe("codex");
      expect(resolveLoop({ loops: LOOPS, view: "cli", agentSeated: false, defaultLoop: "gemini" })).toBe("gemini");
      expect(resolveLoop({ loops: LOOPS, view: "cli", agentSeated: false })).toBe("claude");
    });

    it("ignores a loop this machine does not have", () => {
      // Binding an agent to a loop that isn't installed opens it bound to
      // nothing — the model then rides whatever the chat happens to find.
      expect(resolveLoop({ loops: LOOPS, view: "cli", agentSeated: false, loop: "ghost" })).toBe("claude");
      expect(resolveLoop({ loops: LOOPS, view: "cli", agentSeated: false, defaultLoop: "ghost" })).toBe("claude");
    });

    it("survives a machine with no loops at all", () => {
      expect(routeNewAgent({ loops: [], view: "glyphh", agentSeated: false })).toEqual({ kind: "open", loop: null });
    });
  });
});
