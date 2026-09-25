import { describe, it, expect } from "vitest";
import { routeNewAgent, routeNewChatInPanel, resolveLoop } from "../../src/renderer/help/new-agent-route.js";

const LOOPS = ["claude", "codex", "gemini"];

describe("new-agent routing", () => {
  describe("the reported bug", () => {
    it("NEVER reuses the seated agent — a new agent is a new instance", () => {
      // His report: pressing New with an agent already up blanked that
      // agent's thread and spawned nothing. Whatever else changes, this
      // must not come back.
      const a = routeNewAgent({ loops: LOOPS, view: "glyphh", agentSeated: true });
      expect(a.kind).toBe("instance");
      expect(a.kind === "instance" && a.loop).toBe("claude");
    });

    it("mints a FRESH cli conversation, never re-attaching a parked buffer", () => {
      // Without fresh, openAgentCliCard re-attaches the parked pty and the
      // "new" agent resumes the old conversation — the same bug wearing a
      // terminal.
      const a = routeNewAgent({ loops: LOOPS, view: "cli", agentSeated: true });
      expect(a).toEqual({ kind: "cli", loop: "claude", fresh: true });
    });

    it("keeps the header + as its own verb: in place, always", () => {
      expect(routeNewChatInPanel()).toEqual({ kind: "in-place" });
    });
  });

  describe("the two verbs stay distinct", () => {
    it("a new agent in cli view is never the in-place action", () => {
      for (const seated of [true, false]) {
        const a = routeNewAgent({ loops: LOOPS, view: "cli", agentSeated: seated });
        expect(a.kind).not.toBe("in-place");
      }
    });

    it("with nothing seated the ordinary open IS the new agent", () => {
      const a = routeNewAgent({ loops: LOOPS, view: "glyphh", agentSeated: false });
      expect(a).toEqual({ kind: "open", loop: "claude" });
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
      const a = routeNewAgent({ loops: [], view: "cli", agentSeated: false });
      expect(a).toEqual({ kind: "open", loop: null });
    });

    it("falls back to the chat open when cli view has no loop to run", () => {
      // view is "cli" but nothing is installed — there is no cli to spawn.
      const a = routeNewAgent({ loops: [], view: "cli", agentSeated: true });
      expect(a.kind).toBe("instance");
    });
  });

  describe("web", () => {
    it("falls back in place only where an instance panel is impossible", () => {
      // No <webview> on web, so the instance panel cannot be hosted.
      const a = routeNewAgent({ loops: LOOPS, view: "glyphh", agentSeated: true, web: true });
      expect(a).toEqual({ kind: "in-place" });
    });

    it("still opens normally on web when nothing is seated", () => {
      const a = routeNewAgent({ loops: LOOPS, view: "glyphh", agentSeated: false, web: true });
      expect(a).toEqual({ kind: "open", loop: "claude" });
    });

    it("still mints a fresh cli on web when the view is cli", () => {
      const a = routeNewAgent({ loops: LOOPS, view: "cli", agentSeated: true, web: true });
      expect(a).toEqual({ kind: "cli", loop: "claude", fresh: true });
    });
  });
});
