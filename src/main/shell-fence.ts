/**
 * shell-fence.ts — THE SESSION'S SHELL, MATCHING CLAUDE CODE (his call,
 * 2026-10-09). On macOS every `bash` command runs under Seatbelt:
 *   writes   only inside the session's folder (+ tmp and the tool caches) —
 *            the SDK's own profile (@glyphh/sdk/loop shellProfile);
 *   reads    everywhere EXCEPT the deny-list: keys, cloud and git credentials,
 *            Keychains, browser profiles, and Glyphh's own data;
 *   network  only through the session's proxy (net-proxy.ts), plus the local
 *            ports the member allowed. Every other connection, loopback
 *            included, is refused by the kernel, whatever the command does.
 * Off macOS the shell starts in the folder unsandboxed, as the SDK's default does.
 */

import { existsSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { shellProfile } from "@glyphh/sdk/loop";
import { currentTurnChat } from "./turn-folder.js";
import { proxyUrlFor, savedLocalPorts } from "./net-proxy.js";

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** What a session's shell may not read (paths under the member's home). */
export function readDenied(home: string = homedir(), appData: readonly string[] = []): string[] {
  const h = (p: string): string => join(home, p);
  return [
    h(".ssh"), h(".aws"), h(".gnupg"), h(".azure"), h(".kube"), h(".docker"),
    h(".config/gh"), h(".config/gcloud"), h(".config/hub"), h(".netrc"), h(".git-credentials"),
    h(".npmrc"), h(".pypirc"), h(".cargo/credentials"), h(".cargo/credentials.toml"),
    h("Library/Keychains"), h("Library/Cookies"),
    h("Library/Application Support/Google/Chrome"), h("Library/Application Support/Firefox"),
    h("Library/Application Support/BraveSoftware"), h("Library/Application Support/Microsoft Edge"),
    h("Library/Safari"), h("Library/Messages"), h("Library/Mail"),
    h(".glyphh"), ...appData,
  ];
}

const sb = (p: string): string => JSON.stringify(p);

/** The profile: the SDK's write fence, the read deny-list, the network gate.
 *  Outbound goes ONLY to the session's proxy and the local ports the member
 *  allowed; loopback is not open (a local tunnel would carry data past the allowlist). */
export function fenceProfile(folder: string, denied: readonly string[], proxyPort: number | null, localPorts: readonly number[] = []): string {
  const reads = denied.length ? `(deny file-read* ${denied.map((p) => `(subpath ${sb(p)})`).join(" ")})` : "";
  const ports = [...new Set([...(proxyPort === null ? [] : [proxyPort]), ...localPorts])];
  return [
    shellProfile(folder),
    reads,
    "(deny network-outbound)",
    ...ports.map((p) => `(allow network-outbound (remote ip "localhost:${p}"))`),
    '(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))',
  ].filter(Boolean).join("\n");
}

let appDataDirs: string[] = [];
/** The app's own data folders (Electron userData): never readable by a session's shell. */
export function setAppDataDirs(dirs: string[]): void { appDataDirs = dirs.filter(Boolean); }

/** The loop's shell launcher (GlyphhLoop deps.shell). */
export function fencedShell(shell: string, cmd: string, folder: string): { file: string; args: string[]; sandboxed: boolean } {
  if (process.platform !== "darwin" || !existsSync(SANDBOX_EXEC)) return { file: shell, args: ["-lc", cmd], sandboxed: false };
  let root = folder;
  try { root = realpathSync(folder); } catch { /* the loop already checked it */ }
  const proxy = proxyUrlFor(currentTurnChat());
  const port = proxy ? Number(new URL(proxy).port) : null;
  // Localhost rides the proxy too (NO_PROXY empty): a new local port is asked like a new host.
  const env = proxy
    ? [`HTTP_PROXY=${proxy}`, `HTTPS_PROXY=${proxy}`, `http_proxy=${proxy}`, `https_proxy=${proxy}`, `ALL_PROXY=${proxy}`, "NO_PROXY=", "no_proxy="]
    : [];
  return {
    file: SANDBOX_EXEC,
    args: ["-p", fenceProfile(root, readDenied(homedir(), appDataDirs), port, savedLocalPorts()), "/usr/bin/env", ...env, shell, "-lc", cmd],
    sandboxed: true,
  };
}

const OUT_CAP = 60_000;

/** run_outside_sandbox, after the member said yes: the command, unfenced, in the folder. */
export function runUnfenced(cmd: string, folder: string, timeoutMs = 10 * 60_000): Promise<string> {
  const shell = process.env.SHELL || "/bin/zsh";
  return new Promise((resolve) => {
    const proc = spawn(shell, ["-lc", cmd], { cwd: folder, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = "";
    proc.stdout.on("data", (b: Buffer) => { if (out.length < OUT_CAP) out += b.toString(); });
    proc.stderr.on("data", (b: Buffer) => { if (err.length < OUT_CAP) err += b.toString(); });
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* gone */ } }, timeoutMs);
    proc.on("close", (code) => { clearTimeout(timer); resolve(["(ran outside the sandbox, with the member's approval)", out, err && `stderr:\n${err}`, `exit ${code ?? "?"}`].filter(Boolean).join("\n")); });
    proc.on("error", (e) => { clearTimeout(timer); resolve(`could not start: ${e.message}`); });
  });
}
