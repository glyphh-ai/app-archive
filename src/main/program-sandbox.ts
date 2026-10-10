/**
 * program-sandbox.ts — a power's PROGRAM (run.js) runs fenced (his call,
 * 2026-10-09: "yes fence it locally. This solves both surfaces"): the task host
 * starts as the app binary in Node mode under the same macOS Seatbelt profile
 * the loop's `bash` uses (@glyphh/sdk/loop shellProfile): it writes only inside
 * its folder (plus tmp and the tool caches), whatever the program asks.
 * Messages ride a standard IPC channel. Where no sandbox can be applied, a
 * program does not run: it fails closed.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { shellProfile } from "@glyphh/sdk/loop";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
/** Seatbelt could not be applied (already inside another sandbox, or policy): the program must not run unconfined. */
const sandboxApplyFailed = (stderr: string): boolean => /sandbox_apply|sandbox-exec: .*not permitted/i.test(stderr);

/** What the runner holds of a program's process. */
export interface TaskProc {
  readonly pid?: number;
  postMessage(msg: unknown): void;
  kill(): void;
  on(event: "message", fn: (msg: never) => void): void;
  on(event: "exit", fn: (code: number | null) => void): void;
}

/** The argv that starts `script` fenced to `folder`, or null where no fence exists. */
export function fencedArgv(script: string, folder: string, platform: NodeJS.Platform = process.platform, hasSandbox: boolean = existsSync(SANDBOX_EXEC)): { file: string; args: string[] } | null {
  if (platform !== "darwin" || !hasSandbox) return null;
  return { file: SANDBOX_EXEC, args: ["-p", shellProfile(folder), process.execPath, script] };
}

export function spawnFenced(script: string, folder: string): TaskProc {
  const root = realpathSync(folder);
  const argv = fencedArgv(script, root);
  if (!argv) throw new Error("this desktop can't fence a program (the macOS sandbox is not available), so it does not run here");
  const child: ChildProcess = spawn(argv.file, argv.args, {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["ignore", "inherit", "pipe", "ipc"],
  });
  child.stderr?.on("data", (b: Buffer) => {
    const s = b.toString();
    if (sandboxApplyFailed(s)) child.kill("SIGKILL");
    process.stderr.write(s);
  });
  return {
    get pid() { return child.pid; },
    postMessage: (msg) => { if (child.connected) child.send(msg as never); },
    kill: () => { child.kill(); },
    on: (event: "message" | "exit", fn: (arg: never) => void) => { child.on(event, fn as (...a: unknown[]) => void); },
  } as TaskProc;
}
