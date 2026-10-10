/**
 * shell-fence.ts — THE SESSION'S SHELL, MATCHING CLAUDE CODE (his call,
 * 2026-10-09). On macOS every `bash` command runs under Seatbelt:
 *   writes   only inside the session's folder (+ tmp and the tool caches) —
 *            the SDK's own profile (@glyphh/sdk/loop shellProfile);
 *   reads    everywhere EXCEPT the deny-list: keys, cloud and git credentials,
 *            Keychains, browser profiles, and Glyphh's own data;
 *   network  only through the session's proxy (net-proxy.ts), plus loopback
 *            for the member's own local services. Every other connection is
 *            refused by the kernel, whatever the command does.
 * Off macOS the shell starts in the folder unsandboxed, as the SDK's default does.
 */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { shellProfile } from "@glyphh/sdk/loop";
import { currentTurnChat } from "./turn-folder.js";
import { proxyUrlFor } from "./net-proxy.js";

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

/** The profile: the SDK's write fence, the read deny-list, the network gate. */
export function fenceProfile(folder: string, denied: readonly string[], proxyPort: number | null): string {
  const reads = denied.length ? `(deny file-read* ${denied.map((p) => `(subpath ${sb(p)})`).join(" ")})` : "";
  const net = [
    "(deny network-outbound)",
    '(allow network-outbound (remote ip "localhost:*"))',
    '(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))',
  ];
  return [shellProfile(folder), reads, ...(proxyPort === null ? net.filter((l) => !l.includes("localhost")) : net)].filter(Boolean).join("\n");
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
  const env = proxy
    ? [`HTTP_PROXY=${proxy}`, `HTTPS_PROXY=${proxy}`, `http_proxy=${proxy}`, `https_proxy=${proxy}`, `ALL_PROXY=${proxy}`, "NO_PROXY=localhost,127.0.0.1,::1", "no_proxy=localhost,127.0.0.1,::1"]
    : [];
  return {
    file: SANDBOX_EXEC,
    args: ["-p", fenceProfile(root, readDenied(homedir(), appDataDirs), port), "/usr/bin/env", ...env, shell, "-lc", cmd],
    sandboxed: true,
  };
}
