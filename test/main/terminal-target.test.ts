/**
 * terminal-target.test.ts — where a Terminal tile's shell runs (his report,
 * 2026-10-04: "What happened to my terminals in the cloud?"): a cloud
 * session's shell is the pod's pty on BOTH surfaces, in the thread's
 * workspace; a local session's is the machine's — spawned by the desktop,
 * reached over the relay by the web; a slot's pin wins; and the line a cloud
 * CLI tile hands the worker is the bare binary, never main's machine line.
 */
import { describe, expect, it } from "vitest";
import { cloudScope, isCloudSource, podCliCommand, terminalTransport } from "../../src/renderer/help/terminal-target";

const space = { kind: "cloud-space", space: "th-space", dir: "packages/web" };
const born = { kind: "cloud-new" };
const repo = { kind: "cloud-repo", repo: "glyphh-ai/app", dir: "/apps/web/" };
const local = { kind: "local", path: "/Users/me/code/app" };

describe("a cloud session's terminal is the worker's pty", () => {
  it("on the desktop", () => {
    expect(terminalTransport({ surface: "desktop", source: born, chatId: "th-1" }))
      .toEqual({ kind: "remote", target: "worker", scope: "th-1" });
  });
  it("on the web", () => {
    expect(terminalTransport({ surface: "web", source: born, chatId: "th-1" }))
      .toEqual({ kind: "remote", target: "worker", scope: "th-1" });
  });
  it("re-enters a space on the space's own id, in the picked folder", () => {
    expect(terminalTransport({ surface: "desktop", source: space, chatId: "th-new" }))
      .toEqual({ kind: "remote", target: "worker", scope: "th-space", cwd: "packages/web" });
  });
  it("hands the folder RELATIVE to the workspace (the pod clamps it under its root)", () => {
    expect(terminalTransport({ surface: "web", source: repo, chatId: "th-2" }))
      .toEqual({ kind: "remote", target: "worker", scope: "th-2", cwd: "apps/web" });
  });
});

describe("a local session's terminal is the machine's", () => {
  it("the desktop spawns it itself", () => {
    expect(terminalTransport({ surface: "desktop", source: local, chatId: "th-3" })).toEqual({ kind: "local" });
  });
  it("the web reaches it over the relay", () => {
    expect(terminalTransport({ surface: "web", source: local, chatId: "th-3" })).toEqual({ kind: "remote", target: "desktop" });
  });
  it("with no session at all: the desktop's own shell; the web's only shell is a worker", () => {
    expect(terminalTransport({ surface: "desktop", source: null })).toEqual({ kind: "local" });
    expect(terminalTransport({ surface: "web", source: null })).toEqual({ kind: "remote", target: "worker", scope: "" });
  });
});

describe("a slot's pin wins over the session's locus", () => {
  it("a CLI session resumed off the machine's stores runs on the machine — locally on the desktop, over the relay on the web", () => {
    expect(terminalTransport({ surface: "desktop", source: born, chatId: "th-1", slotTarget: "desktop" })).toEqual({ kind: "local" });
    expect(terminalTransport({ surface: "web", source: born, chatId: "th-1", slotTarget: "desktop" })).toEqual({ kind: "remote", target: "desktop" });
  });
  it("a tile pinned to the worker stays there", () => {
    expect(terminalTransport({ surface: "desktop", source: local, chatId: "th-1", slotTarget: "worker" }))
      .toEqual({ kind: "remote", target: "worker", scope: "th-1" });
  });
});

describe("the helpers", () => {
  it("anything not local is the cloud; nothing is nowhere", () => {
    expect(isCloudSource(born)).toBe(true);
    expect(isCloudSource(local)).toBe(false);
    expect(isCloudSource(null)).toBe(false);
    expect(isCloudSource({ kind: "" })).toBe(false);
  });
  it("the scope is the space's id, else the thread's", () => {
    expect(cloudScope(space, "th-x")).toBe("th-space");
    expect(cloudScope(born, "th-x")).toBe("th-x");
    expect(cloudScope(born, null)).toBe("");
  });
});

describe("the line a cloud CLI tile hands the worker", () => {
  it("is the bare binary — no cd, no env, no MCP wiring", () => {
    expect(podCliCommand("claude")).toBe("claude");
    expect(podCliCommand("gemini")).toBe("gemini");
    expect(podCliCommand("cursor")).toBe("cursor-agent");
    expect(podCliCommand("codex")).toBe("codex -c check_for_update_on_startup=false");
    expect(podCliCommand("glyphh")).toBe("glyphh --trust");
  });
  it("carries the CLI's own resume and prompt flags", () => {
    expect(podCliCommand("claude", { resume: true })).toBe("claude --continue");
    expect(podCliCommand("claude", { resume: "abc'1" })).toBe("claude --resume 'abc1'");
    expect(podCliCommand("codex", { resume: true })).toBe("codex -c check_for_update_on_startup=false resume --last");
    expect(podCliCommand("gemini", { resume: true, prompt: "hi" })).toBe("gemini --resume latest -i 'hi'");
    expect(podCliCommand("claude", { prompt: "it's here" })).toBe("claude 'it'\\''s here'");
    expect(podCliCommand("copilot", { prompt: "x" })).toBe("copilot");
  });
  it("names nothing the pod does not carry", () => {
    expect(podCliCommand("vim")).toBeNull();
  });
});
