/**
 * A power's program runs fenced (his call, 2026-10-09): it writes only inside its
 * folder, whatever it asks, and where no fence exists it does not run.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fencedArgv, spawnFenced } from "../../src/main/program-sandbox.js";

describe("a program's fence", () => {
  it("has no unfenced fallback: off macOS, or with no sandbox, there is no way to start it", () => {
    expect(fencedArgv("/x/host.js", "/f", "linux", true)).toBeNull();
    expect(fencedArgv("/x/host.js", "/f", "win32", true)).toBeNull();
    expect(fencedArgv("/x/host.js", "/f", "darwin", false)).toBeNull();
    const argv = fencedArgv("/x/host.js", "/f", "darwin", true)!;
    expect(argv.file).toBe("/usr/bin/sandbox-exec");
    expect(argv.args[1]).toContain('(allow file-write* (subpath "/f")');
    expect(argv.args.slice(-1)).toEqual(["/x/host.js"]);
  });

  it.runIf(process.platform === "darwin")("writes inside its folder and is refused outside it", async () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "fence-")));
    const outside = join(homedir(), `glyphh-fence-test-${process.pid}.txt`);
    const script = join(folder, "probe.cjs");
    writeFileSync(script, `
      const fs = require("fs");
      process.on("message", () => {
        const r = {};
        try { fs.writeFileSync(${JSON.stringify(join(folder, "in.txt"))}, "ok"); r.inside = "ok"; } catch (e) { r.inside = e.code; }
        try { fs.writeFileSync(${JSON.stringify(outside)}, "x"); r.outside = "WRITTEN"; } catch (e) { r.outside = e.code; }
        process.send(r, () => process.exit(0));
      });
    `);
    const proc = spawnFenced(script, folder);
    const got = await new Promise<{ inside: string; outside: string }>((resolve) => {
      proc.on("message", (m: never) => resolve(m as { inside: string; outside: string }));
      proc.postMessage({ go: true });
    });
    expect(got.inside).toBe("ok");
    expect(got.outside).toBe("EPERM");
    expect(existsSync(outside)).toBe(false);
  });
});
