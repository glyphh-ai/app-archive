import { describe, it, expect } from "vitest";
import { isAuthTrouble, isPermissionDenial, authFix, cliFix, LOGIN_CMD } from "../../src/main/cli-auth.js";

describe("cli-auth", () => {
  it("recognizes what the CLIs actually print when a login runs out", () => {
    for (const said of [
      "Failed to authenticate: OAuth session expired and could not be refreshed",
      "Login expired · Please run /login",
      "Error: not logged in",
      "401 Unauthorized",
    ]) expect(isAuthTrouble(said), said).toBe(true);
  });

  it("does not claim an auth problem for an ordinary failure", () => {
    for (const said of [
      "the program exports no run(ctx, input) function",
      "ENOENT: no such file or directory",
      "the gateway refused this model: out of credits",
      "",
    ]) expect(isAuthTrouble(said), said).toBe(false);
  });

  it("names the command that fixes it, per CLI", () => {
    const fix = authFix("Failed to authenticate: OAuth session expired", "claude");
    expect(fix?.kind).toBe("signin");
    expect(fix?.command).toBe("claude");
    expect(fix?.message).toContain("/login");
    expect(authFix("not logged in", "codex")?.command).toBe(LOGIN_CMD.codex);
    expect(authFix("not logged in", "cursor")?.command).toBe("cursor-agent login");
    // An unknown CLI still gets a command: its own name.
    expect(authFix("401 Unauthorized", "someagent")?.command).toBe("someagent");
  });

  // His report, 2026-09-25: "any error in the cli is returning [Sign in to
  // continue]. When in fact the error was related to not being allowed to do
  // something." A refusal is a permission decision, never a dead login.
  it("never calls a permission refusal a login problem", () => {
    for (const said of [
      "Claude requested permissions to use Bash, but you haven't granted it yet.",
      "Error: permission denied",
      "The user doesn't want to proceed with this tool use.",
      "EACCES: permission denied, open '/etc/hosts'",
      "operation not permitted",
      "Bash command blocked by a hook",
      "403 Forbidden: you are not allowed to write here",
      "User rejected the edit",
    ]) {
      expect(isPermissionDenial(said), said).toBe(true);
      expect(isAuthTrouble(said), said).toBe(false);
      expect(authFix(said, "claude"), said).toBeNull();
      expect(cliFix(said, "claude")?.kind, said).not.toBe("signin");
    }
  });

  it("explains the refusal instead, and says the login is fine", () => {
    const fix = cliFix("Claude requested permissions to use Bash, but you haven't granted it yet.", "claude");
    expect(fix?.kind).toBe("explain");
    expect(fix?.message).toContain("not allowed");
    expect(fix?.message).toContain("login is fine");
  });

  // A denial phrase anywhere in the output vetoes the auth read: the mixed
  // tail is exactly what the bridge hands cliFix (stderr + the JSON buffer).
  it("lets a denial in a mixed tail veto a stray auth word", () => {
    const tail = "401 Unauthorized\nthe user denied this tool call";
    expect(isAuthTrouble(tail)).toBe(false);
    expect(cliFix(tail, "claude")?.kind).toBe("explain");
  });

  it("no longer reads a bare \"unauthorized\" as an expired login", () => {
    expect(isAuthTrouble("Unauthorized: this key cannot call that endpoint")).toBe(false);
  });

  it("stays out of the way when nothing is wrong with the login", () => {
    expect(authFix("exited 1", "claude")).toBeNull();
  });

  it("explains a known refusal in the user's words and keeps the CLI's line", () => {
    const fix = cliFix("⚠ Not inside a trusted directory and --skip-git-repo-check was not specified.", "codex");
    expect(fix?.kind).toBe("explain");
    expect(fix?.message).toContain("not a git repository");
    expect(fix?.message).toContain("codex said: ⚠ Not inside a trusted directory");
    const upd = cliFix("✨ Update available! 0.154.0 -> 0.155.1\nRelease notes: https://example\n1. Update now", "codex");
    expect(upd?.kind).toBe("explain");
    expect(upd?.message).toContain("update available");
    expect(cliFix("zsh: command not found: gemini", "gemini")?.message).toContain("CLI Installer");
    const acct = cliFix('{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-4.1\' model is not supported when using Codex with a ChatGPT account."}}', "codex");
    expect(acct?.kind).toBe("explain");
    expect(acct?.message).toContain("ChatGPT login");
  });

  it("still hands a login failure to the sign-in card, and shrugs at the unknown", () => {
    expect(cliFix("Failed to authenticate: OAuth session expired", "claude")?.kind).toBe("signin");
    expect(cliFix("exited 1", "claude")).toBeNull();
  });
});
