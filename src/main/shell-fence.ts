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
 * On Linux the same fence is bubblewrap (as Claude Code's): the system read-only,
 * the folder (+ tmp and the caches) writable, the deny-list hidden, and a
 * network namespace with nothing in it but relays to the proxy and the
 * member's allowed local ports (socat inside, a unix socket out). Without
 * bwrap and socat, nothing fenced can run: it fails closed.
 */

import { machineDenied } from "./machine-mode.js";
import { existsSync, mkdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import { tmpdir } from "node:os";
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

// ── Linux: bubblewrap ────────────────────────────────────────────────────────

const LINUX_TOOLS = ["/usr/bin/bwrap", "/usr/bin/socat"];
const linuxReady = (): boolean => LINUX_TOOLS.every((t) => existsSync(t));

/** Where a Linux shell may write besides its folder: tmp and the package caches. */
export function linuxWritable(home: string = homedir()): string[] {
  return ["/tmp", "/var/tmp", join(home, ".cache"), join(home, ".npm"), join(home, ".yarn"), join(home, ".cargo/registry"), join(home, ".local/share/pnpm")];
}

/** bubblewrap's argv for `inner`: fs fence, deny-list hidden, no network but
 *  the relays (each listed port, socat'd inside to `<sockDir>/<port>.sock`). */
export function bwrapArgs(folder: string, denied: readonly string[], writable: readonly string[], sockDir: string | null, ports: readonly number[], inner: readonly string[], exists: (p: string) => "dir" | "file" | null = kindOf): string[] {
  // --unshare-pid: the command is the namespace's life; its relays die when it ends.
  const a: string[] = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-net", "--unshare-pid", "--die-with-parent", "--new-session"];
  for (const w of writable) if (exists(w) === "dir") a.push("--bind", w, w);
  a.push("--bind", folder, folder);
  for (const d of denied) {
    const k = exists(d);
    if (k === "dir") a.push("--tmpfs", d);
    else if (k === "file") a.push("--ro-bind", "/dev/null", d);
  }
  if (sockDir) a.push("--bind", sockDir, sockDir);
  a.push("--chdir", folder, "--");
  if (sockDir && ports.length) {
    const relays = ports.map((p) => `/usr/bin/socat TCP-LISTEN:${p},bind=127.0.0.1,fork,reuseaddr UNIX-CONNECT:${sockDir}/${p}.sock >/dev/null 2>&1 &`).join(" ");
    a.push("/bin/sh", "-c", `${relays} sleep 0.2; exec "$@"`, "sh", ...inner);
  } else {
    a.push(...inner);
  }
  return a;
}

function kindOf(p: string): "dir" | "file" | null {
  try { const st = statSync(p); return st.isDirectory() ? "dir" : "file"; } catch { return null; }
}

/** The unix sockets a Linux shell's relays dial out through: one per port, each forwarding to 127.0.0.1:<port>. */
const SOCK_DIR = join(tmpdir(), `glyphh-net-${process.pid}`);
const relayServers = new Map<number, net.Server>();
function ensureRelay(port: number): void {
  if (relayServers.has(port)) return;
  mkdirSync(SOCK_DIR, { recursive: true, mode: 0o700 });
  const path = join(SOCK_DIR, `${port}.sock`);
  try { rmSync(path, { force: true }); } catch { /* fresh */ }
  const server = net.createServer((sock) => {
    const up = net.connect(port, "127.0.0.1");
    sock.pipe(up); up.pipe(sock);
    const close = (): void => { sock.destroy(); up.destroy(); };
    sock.on("error", close); up.on("error", close);
  });
  server.listen(path);
  relayServers.set(port, server);
}

/** THE FENCE FOR ANY ARGV (the shell, a program, a remote terminal): Seatbelt on
 *  macOS, bubblewrap on Linux, null where no fence exists (the caller refuses). */
export function fenceArgv(inner: readonly string[], folder: string, proxyPort: number | null, localPorts: readonly number[] = savedLocalPorts()): { file: string; args: string[] } | null {
  let root = folder;
  try { root = realpathSync(folder); } catch { /* the caller checked it */ }
  const denied = readDenied(homedir(), [...appDataDirs, ...machineDenied()]);
  if (process.platform === "darwin" && existsSync(SANDBOX_EXEC)) {
    return { file: SANDBOX_EXEC, args: ["-p", fenceProfile(root, denied, proxyPort, localPorts), ...inner] };
  }
  if (process.platform === "linux" && linuxReady()) {
    const ports = [...new Set([...(proxyPort === null ? [] : [proxyPort]), ...localPorts])];
    for (const p of ports) ensureRelay(p);
    return { file: "/usr/bin/bwrap", args: bwrapArgs(root, denied, linuxWritable(), ports.length ? SOCK_DIR : null, ports, inner) };
  }
  return null;
}

/** Why nothing fenced can run here, said plainly. */
export const NO_FENCE = process.platform === "linux"
  ? "this computer has no sandbox for the agent's shell: install bubblewrap and socat (e.g. sudo apt install bubblewrap socat), then try again"
  : "this computer has no sandbox for the agent's shell yet, so commands don't run here";

/** The loop's shell launcher (GlyphhLoop deps.shell). */
export function fencedShell(shell: string, cmd: string, folder: string): { file: string; args: string[]; sandboxed: boolean } {
  if (process.platform === "linux") {
    const proxy = proxyUrlFor(currentTurnChat());
    const port = proxy ? Number(new URL(proxy).port) : null;
    const env = proxy ? [`HTTP_PROXY=${proxy}`, `HTTPS_PROXY=${proxy}`, `http_proxy=${proxy}`, `https_proxy=${proxy}`, `ALL_PROXY=${proxy}`, "NO_PROXY=", "no_proxy="] : [];
    const fenced = fenceArgv(["/usr/bin/env", ...env, shell, "-lc", cmd], folder, port);
    // No fence: nothing runs (the SDK reports a failed sandbox as "not run").
    return fenced ? { ...fenced, sandboxed: true } : { file: "/bin/sh", args: ["-c", `echo 'sandbox_apply: ${NO_FENCE}' >&2; exit 126`], sandboxed: true };
  }
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
    args: ["-p", fenceProfile(root, readDenied(homedir(), [...appDataDirs, ...machineDenied()]), port, savedLocalPorts()), "/usr/bin/env", ...env, shell, "-lc", cmd],
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
