import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// The seams a CLI open leans on: the user-scoped folder, the local MCP server,
// the member's plan and the org's default model.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "cli-agents-"));
vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));
vi.mock("../../src/main/app-paths", () => ({ userScopedPath: (...s: string[]) => path.join(home, ...s) }));
vi.mock("../../src/main/local-mcp-server", () => ({
  startLocalMcpServer: async () => ({ ok: true }),
  localMcpStatus: () => ({ port: 4777 }),
  localMcpGenToken: () => ({ token: "local-token" }),
  localMcpTokenValid: (t: string) => t === "local-token",
}));
vi.mock("../../src/main/conn-tool-modes", () => ({ effectiveToolMode: () => "ask" }));
vi.mock("../../src/main/stores/preferences-db", () => ({ preferencesByPrefix: () => ({}), getPreference: (_k: string, d: unknown) => d }));
vi.mock("../../src/main/glyphh-client", () => ({ SERVER_URL: "https://api.test" }));
vi.mock("../../src/main/working-directory", () => ({ getWorkingDirectory: () => "" }));
let bundledCli: string | null = null;
vi.mock("../../src/main/bundled-cli", () => ({ bundledGlyphhCli: () => bundledCli }));
let orgDefault = "claude-sonnet-5";
vi.mock("../../src/main/org-models", () => ({
  bareModel: (m: string) => m.replace(/^[a-z0-9_-]+::/i, "").trim(),
  orgHasPlan: () => true,
  orgRequiredModel: () => orgDefault,
  refreshOrgModels: async () => {},
}));

const { opensViaGateway, composeCommand, composeHeadlessLine, agentRowFor } = await import("../../src/main/cli-agents");

describe("CLI agents — the gateway is a paid, chosen lane (his order, 2026-09-30)", () => {
  it("never passes the gateway on Free, whatever the member or the slot says", () => {
    expect(opensViaGateway("claude", true, false, true)).toBe(false);
    expect(opensViaGateway("codex", undefined, false, true)).toBe(false);
  });

  it("follows the member's default when the slot says nothing", () => {
    expect(opensViaGateway("claude", undefined, true, true)).toBe(true);
    expect(opensViaGateway("claude", undefined, true, false)).toBe(false);
  });

  it("lets a workspace slot override the default both ways", () => {
    expect(opensViaGateway("codex", false, true, true)).toBe(false);
    expect(opensViaGateway("codex", true, true, false)).toBe(true);
  });

  it("never passes it to a CLI with no base-URL seam", () => {
    expect(opensViaGateway("copilot", true, true, true)).toBe(false);
    expect(opensViaGateway("cursor", true, true, true)).toBe(false);
    expect(opensViaGateway("glyphh", true, true, true)).toBe(false);
  });
});

describe("composeCommand — what the terminal plays", () => {
  const envFile = path.join(home, "loops", "claude", "env");
  beforeEach(() => {
    orgDefault = "claude-sonnet-5";
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    fs.writeFileSync(envFile, 'ANTHROPIC_BASE_URL="https://gw"\nANTHROPIC_AUTH_TOKEN="k"\n');
  });

  it("sources the gateway lines only on the gateway lane", () => {
    const row = agentRowFor("claude")!;
    expect(composeCommand(row, {}, true, "posix")).toContain(envFile);
    expect(composeCommand(row, {}, false, "posix")).not.toContain(envFile);
  });

  it("runs the org's default model on the gateway and the CLI's own on its login", () => {
    const row = agentRowFor("claude")!;
    expect(composeCommand(row, {}, true, "posix")).toContain('--model "claude-sonnet-5"');
    expect(composeCommand(row, { model: "anthropic::claude-opus-5" }, true, "posix")).toContain('--model "claude-opus-5"');
    expect(composeCommand(row, { model: "anthropic::claude-opus-5" }, false, "posix")).not.toContain("--model");
  });

  it("routes codex through the Glyphh provider only on the gateway lane", () => {
    const row = agentRowFor("codex")!;
    expect(composeCommand(row, {}, true, "posix")).toContain('model_provider="glyphh"');
    expect(composeCommand(row, {}, false, "posix")).not.toContain('model_provider="glyphh"');
  });

  it("resumes the exact session a recents pick names", () => {
    expect(composeCommand(agentRowFor("claude")!, { resume: "abc-123" }, false, "posix")).toContain("--resume 'abc-123'");
    expect(composeCommand(agentRowFor("codex")!, { resume: "abc-123" }, false, "posix")).toContain("resume 'abc-123'");
  });

  it("keeps the Glyphh CLI's history apart from the Glyphh agent's", () => {
    const line = composeCommand(agentRowFor("glyphh")!, {}, false, "posix");
    expect(line).toContain(path.join(home, "glyphh-cli-sessions.json"));
    expect(line).not.toContain("agent-sessions.json");
  });

  it("runs the CLI the app carries with the app's own binary, on both shells (his order, 2026-10-01)", () => {
    bundledCli = "/Apps/Glyphh Desktop.app/Contents/Resources/glyphh-cli/run.mjs";
    try {
      const sh = composeCommand(agentRowFor("glyphh")!, {}, false, "posix");
      expect(sh).toContain(' ELECTRON_RUN_AS_NODE="1"');
      expect(sh).toContain(`"${process.execPath}" "${bundledCli}" --trust`);
      const ps = composeCommand(agentRowFor("glyphh")!, {}, false, "powershell");
      expect(ps).toContain("$env:ELECTRON_RUN_AS_NODE = '1';");
      expect(ps).toContain(`& "${process.execPath}" "${bundledCli}" --trust`);
    } finally {
      bundledCli = null;
    }
  });

  it("falls back to the glyphh on PATH when the build carries no CLI", () => {
    const line = composeCommand(agentRowFor("glyphh")!, {}, false, "posix");
    expect(line).toContain(" glyphh --trust");
    expect(line).not.toContain("ELECTRON_RUN_AS_NODE");
  });

  it("names the Glyphh CLI for what it is", () => {
    expect(agentRowFor("glyphh")!.name).toBe("Glyphh CLI");
  });
});

describe("composeHeadlessLine — a CLI agent with no terminal (his order, 2026-10-07)", () => {
  const envFile = path.join(home, "loops", "claude", "env");
  beforeEach(() => {
    orgDefault = "claude-sonnet-5";
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    fs.writeFileSync(envFile, 'ANTHROPIC_BASE_URL="https://gw"\nANTHROPIC_AUTH_TOKEN="k"\n');
  });

  it("claude runs in print mode with the Glyphh MCP wired and pre-allowed, the prompt shell-quoted", () => {
    const line = composeHeadlessLine(agentRowFor("claude")!, "say it's done", { gateway: false }, "posix");
    expect(line).toContain(`claude -p 'say it'\\''s done' --output-format text`);
    expect(line).toContain('--allowedTools "mcp__glyphh"');
    expect(line).toContain(`--mcp-config "${path.join(home, "loops", "claude", "mcp.json")}" --strict-mcp-config`);
    expect(line).not.toContain("--model");
    expect(line).not.toContain(envFile);
  });

  it("the model and the env file ride only the gateway lane", () => {
    const row = agentRowFor("claude")!;
    const gw = composeHeadlessLine(row, "go", { gateway: true }, "posix");
    expect(gw).toContain('--model "claude-sonnet-5"');
    expect(gw.startsWith(`set -a; . "${envFile}"; set +a;`)).toBe(true);
    expect(composeHeadlessLine(row, "go", { gateway: true, model: "anthropic::claude-opus-5" }, "posix")).toContain('--model "claude-opus-5"');
    expect(composeHeadlessLine(row, "go", { gateway: false, model: "anthropic::claude-opus-5" }, "posix")).not.toContain("--model");
  });

  it("codex runs `exec` with the prompt last, the model as a -c override, approvals auto", () => {
    const line = composeHeadlessLine(agentRowFor("codex")!, "list files", { gateway: true, model: "gpt-5" }, "posix");
    expect(line).toMatch(/codex .* exec 'list files'$/);
    expect(line).toContain(`-c 'model="gpt-5"'`);
    expect(line).toContain('model_provider="glyphh"');
    expect(line).toContain('default_tools_approval_mode="auto"');
    expect(line).toContain('mcp_servers.glyphh.url="http://127.0.0.1:4777/mcp"');
    expect(composeHeadlessLine(agentRowFor("codex")!, "x", { gateway: false }, "posix")).not.toContain('model_provider="glyphh"');
  });

  it("gemini runs -p with yolo approvals and -m on the gateway", () => {
    const line = composeHeadlessLine(agentRowFor("gemini")!, "hi", { gateway: true, model: "gemini-3.8-flash" }, "posix");
    expect(line).toContain(`gemini -p 'hi' -y -m "gemini-3.8-flash"`);
    expect(composeHeadlessLine(agentRowFor("gemini")!, "hi", { gateway: false }, "posix")).toBe("gemini -p 'hi' -y");
  });

  it("starts in the folder it was given", () => {
    expect(composeHeadlessLine(agentRowFor("gemini")!, "hi", { gateway: false, cwd: "/tmp/work" }, "posix")).toBe(`cd "/tmp/work" && gemini -p 'hi' -y`);
  });

  it("refuses a CLI whose row table shows no headless mode", () => {
    for (const id of ["copilot", "cursor", "glyphh"] as const) {
      expect(() => composeHeadlessLine(agentRowFor(id)!, "hi", {}, "posix")).toThrow(/has no headless mode/);
    }
  });
});
