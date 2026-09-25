/**
 * The line a Windows terminal is handed. His report, 2026-09-25: PowerShell
 * met a POSIX line and died on `The token '&&' is not a valid statement
 * separator in this version` — before the CLI was ever reached.
 *
 * cli-agents imports electron and the server client, so both are stubbed: the
 * unit under test is the COMPOSITION, not the wiring around it.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "glyphh-dialect-"));

vi.mock("electron", () => ({ ipcMain: { handle: () => {}, on: () => {} }, app: { getPath: () => TMP } }));
vi.mock("../../src/main/glyphh-client.js", () => ({ getClient: () => ({}), SERVER_URL: "https://example.test" }));
vi.mock("../../src/main/app-paths.js", () => ({ userScopedPath: (...seg: string[]) => path.join(TMP, ...seg), APP_DIR: () => TMP }));

let composeHeadless: typeof import("../../src/main/cli-agents.js")["composeHeadless"];
let loopEnvPrefix: typeof import("../../src/main/cli-agents.js")["loopEnvPrefix"];

beforeAll(async () => {
  const m = await import("../../src/main/cli-agents.js");
  composeHeadless = m.composeHeadless;
  loopEnvPrefix = m.loopEnvPrefix;
  // The env file is what turns the POSIX prefix on — the gateway writes one
  // for every configured loop, which is why this hit every Windows user.
  fs.mkdirSync(path.join(TMP, "loops", "claude"), { recursive: true });
  fs.writeFileSync(path.join(TMP, "loops", "claude", "env"), 'ANTHROPIC_API_KEY="sk-test"\n');
});

const ROW = { id: "claude", name: "Claude", cli: "claude", icon: "", cmd: "claude", model: "", mcp: false, cwd: "C:\\Users\\timmetim", session: "keep", apiKey: null, createdAt: "", updatedAt: "" } as never;

describe("composed lines are in the shell's own dialect", () => {
  it("emits no POSIX-only syntax for PowerShell", () => {
    const line = composeHeadless({ ...(ROW as object) } as never, "hello", "", undefined, undefined, undefined, "powershell");
    expect(line).not.toContain("&&");        // the exact token that errored
    expect(line).not.toMatch(/(^|\s)set [+-]a\b/);
    expect(line).not.toMatch(/(^|;)\s*\.\s+"/);  // POSIX source
    expect(line).not.toMatch(/(^|\s)unset\s/);
  });

  it("still emits the POSIX line on macOS/Linux", () => {
    const line = composeHeadless({ ...(ROW as object) } as never, "hello", "", undefined, undefined, undefined, "posix");
    expect(line).toContain("&&");
    expect(line).toContain("set -a;");
  });

  it("guards the cd in both dialects — a failed cd never runs the CLI elsewhere", () => {
    expect(composeHeadless({ ...(ROW as object) } as never, "hi", "", undefined, undefined, undefined, "powershell")).toContain("if ($?)");
    expect(composeHeadless({ ...(ROW as object) } as never, "hi", "", undefined, undefined, undefined, "posix")).toContain("&&");
  });

  it("sources the loop's env file in PowerShell's words, and never prints the value", () => {
    const ps = loopEnvPrefix(ROW, "powershell");
    expect(ps).toContain("Get-Content");
    expect(ps).not.toContain("set -a");
    expect(ps).not.toContain("sk-test");
    expect(loopEnvPrefix(ROW, "posix")).toContain("set -a; . ");
  });
});
