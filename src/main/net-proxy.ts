/**
 * net-proxy.ts — THE SHELL'S ONE WAY OUT (his call, 2026-10-09: the desktop
 * "matches Claude"). A session's `bash` may reach the network only through this
 * proxy (shell-fence.ts denies every other outbound connection): a host on the
 * allowlist goes through; a new one is asked of the member in the session's
 * panel — Allow once (this session), Always (the allowlist), Deny. A run with
 * nobody to ask (no panel) is denied anything new.
 *
 * One proxy on loopback; each session's shell is handed its own token in the
 * proxy URL, so a connection is judged for the session that made it.
 */

import http from "node:http";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { getPreference, setPreference } from "./stores/preferences-db.js";

export type NetChoice = "once" | "always" | "deny";

/** Where code comes from: package registries and git hosts. */
export const DEFAULT_ALLOWED: readonly string[] = [
  "registry.npmjs.org", "registry.yarnpkg.com", "*.npmjs.org", "nodejs.org",
  "github.com", "*.github.com", "*.githubusercontent.com", "codeload.github.com",
  "gitlab.com", "bitbucket.org",
  "pypi.org", "files.pythonhosted.org",
  "crates.io", "*.crates.io", "proxy.golang.org", "sum.golang.org",
  "rubygems.org", "repo.maven.apache.org", "repo1.maven.org", "jsr.io", "deno.land",
];

const PREF = "netAllow";
const LOCAL_PREF = "netLocalPorts";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
/** A loopback target is judged by host AND port: "localhost:3000". */
export function targetKey(host: string, port: number | string): string {
  const h = host.trim().toLowerCase();
  return LOOPBACK.has(h) ? `localhost:${Number(port) || 80}` : h;
}

/** STRICT SANDBOX (Settings → System): nothing runs outside the sandbox, whoever asks. */
const STRICT_PREF = "sandboxStrict";
export function sandboxStrict(): boolean { return getPreference<unknown>(STRICT_PREF) === true; }
export function setSandboxStrict(on: boolean): void { setPreference(STRICT_PREF, on === true); }

/** Settings → System: what the member allowed, and taking it back. */
export interface SandboxView { builtIn: readonly string[]; hosts: string[]; ports: number[]; strict: boolean }
export function sandboxView(): SandboxView {
  return { builtIn: DEFAULT_ALLOWED, hosts: savedAllowed().filter((h) => !/^localhost:\d+$/.test(h)), ports: savedLocalPorts(), strict: sandboxStrict() };
}
export function removeAllowedHost(host: string): SandboxView {
  setPreference(PREF, savedAllowed().filter((h) => h !== host));
  return sandboxView();
}
export function removeLocalPort(port: number): SandboxView {
  setPreference(LOCAL_PREF, savedLocalPorts().filter((p) => p !== port));
  setPreference(PREF, savedAllowed().filter((h) => h !== `localhost:${port}`));
  for (const s of st.once.values()) s.delete(`localhost:${port}`);
  return sandboxView();
}

/** Local ports a session's shell may reach DIRECTLY (a database client, any
 *  non-HTTP tool): the member allowed them with Always. */
export function savedLocalPorts(): number[] {
  const v = getPreference<unknown>(LOCAL_PREF);
  return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < 65536) : [];
}
const ASK_TIMEOUT_MS = 2 * 60_000;

/** `host` is `entry` or, for a `*.x` entry, any subdomain of x. */
export function hostMatches(entry: string, host: string): boolean {
  const e = entry.trim().toLowerCase();
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!e || !h) return false;
  if (e.startsWith("*.")) return h.endsWith(e.slice(1)) && h.length > e.length - 1;
  return h === e;
}

export function allowedBy(list: readonly string[], host: string): boolean {
  return list.some((e) => hostMatches(e, host));
}

/** The member's own allowlist (Always), beside the defaults. */
export function savedAllowed(): string[] {
  const v = getPreference<unknown>(PREF);
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}

type Asker = (chatId: string, host: string) => Promise<NetChoice>;

interface State {
  server: http.Server | null;
  port: number;
  tokens: Map<string, string>;          // token → chatId ("" = a run with nobody to ask)
  byChat: Map<string, string>;          // chatId → token
  once: Map<string, Set<string>>;       // chatId → hosts allowed for this session
  ask: Asker;
}

const st: State = { server: null, port: 0, tokens: new Map(), byChat: new Map(), once: new Map(), ask: async () => "deny" };

/** Who asks the member (glyphh-loop.ts wires the panel). */
export function setNetAsker(fn: Asker): void { st.ask = fn; }

/** A decision for one session and one host. Exported for tests. */
export async function decide(chatId: string | null, host: string, ask: Asker = st.ask, saved: () => string[] = savedAllowed, save: (list: string[]) => void = (l) => setPreference(PREF, l)): Promise<boolean> {
  if (allowedBy(DEFAULT_ALLOWED, host) || allowedBy(saved(), host)) return true;
  if (!chatId) return false;
  if (st.once.get(chatId)?.has(host)) return true;
  const choice = await Promise.race([ask(chatId, host), new Promise<NetChoice>((r) => setTimeout(() => r("deny"), ASK_TIMEOUT_MS))]);
  if (choice === "always") {
    save([...new Set([...saved(), host])]);
    const local = /^localhost:(\d+)$/.exec(host);
    if (local) setPreference(LOCAL_PREF, [...new Set([...savedLocalPorts(), Number(local[1])])]);
    return true;
  }
  if (choice === "once") { const s = st.once.get(chatId) ?? new Set(); s.add(host); st.once.set(chatId, s); return true; }
  return false;
}

function chatOf(req: http.IncomingMessage): string | null {
  const auth = String(req.headers["proxy-authorization"] ?? "");
  const m = /^Basic\s+(.+)$/i.exec(auth);
  if (!m) return null;
  const user = Buffer.from(m[1]!, "base64").toString("utf8").split(":")[0] ?? "";
  return st.tokens.get(user) ?? null;
}
/** A known token (a session, or a run with nobody to ask), else unknown. */
function knows(req: http.IncomingMessage): boolean {
  const m = /^Basic\s+(.+)$/i.exec(String(req.headers["proxy-authorization"] ?? ""));
  return !!m && st.tokens.has(Buffer.from(m[1]!, "base64").toString("utf8").split(":")[0] ?? "");
}

function refuse(sock: net.Socket, host: string): void {
  sock.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\n\r\nGlyphh's sandbox did not allow this session to reach ${host}.\r\n`);
}

/** The proxy, started on first use. Answers its loopback port. */
export async function ensureNetProxy(): Promise<number> {
  if (st.server) return st.port;
  const server = http.createServer((req, res) => {
    // A plain-HTTP request in absolute form.
    let target: URL;
    try { target = new URL(req.url ?? ""); } catch { res.writeHead(400).end("absolute URL required"); return; }
    if (!knows(req)) { res.writeHead(407).end("this proxy serves Glyphh sessions only"); return; }
    void decide(chatOf(req) || null, targetKey(target.hostname, target.port || 80)).then((ok) => {
      if (!ok) { res.writeHead(403, { "content-type": "text/plain" }).end(`Glyphh's sandbox did not allow this session to reach ${target.hostname}.`); return; }
      const headers = { ...req.headers };
      delete headers["proxy-authorization"]; delete headers["proxy-connection"];
      const up = http.request({ host: target.hostname, port: target.port || 80, path: `${target.pathname}${target.search}`, method: req.method, headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(up);
    });
  });
  server.on("connect", (req, sock: net.Socket, head) => {
    const [host, portRaw] = String(req.url ?? "").split(":");
    if (!host || !knows(req)) { sock.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"); return; }
    void decide(chatOf(req) || null, targetKey(host, portRaw || 443)).then((ok) => {
      if (!ok) { refuse(sock, host); return; }
      const up = net.connect(Number(portRaw) || 443, host, () => {
        sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head?.length) up.write(head);
        up.pipe(sock); sock.pipe(up);
      });
      const close = (): void => { up.destroy(); sock.destroy(); };
      up.on("error", close); sock.on("error", close);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  st.server = server;
  st.port = (server.address() as net.AddressInfo).port;
  return st.port;
}

/** The proxy URL a session's shell is handed, or "" before the proxy is up
 *  (the shell then has no way out at all: shell-fence.ts denies the rest). */
export function proxyUrlFor(chatId: string | null): string {
  if (!st.server) return "";
  const key = chatId ?? "";
  let token = st.byChat.get(key);
  if (!token) {
    token = randomBytes(12).toString("hex");
    st.byChat.set(key, token);
    st.tokens.set(token, key);
  }
  return `http://${token}:x@127.0.0.1:${st.port}`;
}
