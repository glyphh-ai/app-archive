/**
 * The turn's folder is its perimeter (his rule, 2026-10-09): a desktop tool that
 * takes a path resolves it inside the folder of the turn it runs in, and
 * nowhere else.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentTurnFolder, inTurnFolder, turnPath } from "../../src/main/turn-folder.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "turn-folder-")));
const session = join(root, "session");
const outside = join(root, "outside");
mkdirSync(join(session, "sub"), { recursive: true });
mkdirSync(outside, { recursive: true });
symlinkSync(outside, join(session, "link-out"));

describe("a tool's path inside the turn's folder", () => {
  it("resolves relative paths and new files inside the folder", async () => {
    await inTurnFolder(session, async () => {
      expect(currentTurnFolder()).toBe(session);
      expect(await turnPath("sub/a.png")).toBe(join(session, "sub", "a.png"));
      expect(await turnPath(join(session, "b.txt"))).toBe(join(session, "b.txt"));
      expect(await turnPath(".")).toBe(session);
    });
  });

  it("refuses .., an absolute path elsewhere, and a symlink that leads out", async () => {
    await inTurnFolder(session, async () => {
      await expect(turnPath("../outside/x")).rejects.toThrow(/outside this session's folder/);
      await expect(turnPath(join(outside, "x"))).rejects.toThrow(/outside this session's folder/);
      await expect(turnPath("link-out/x")).rejects.toThrow(/outside this session's folder/);
      await expect(turnPath("/etc/passwd")).rejects.toThrow(/outside this session's folder/);
    });
  });

  it("refuses everything outside a turn", async () => {
    expect(currentTurnFolder()).toBeNull();
    await expect(turnPath("a")).rejects.toThrow(/only inside a session/);
  });
});
