/**
 * The session's shell matches Claude Code (his call, 2026-10-09): writes only in
 * its folder, reads everything but the deny-list, and reaches the network only
 * through the session's proxy, which lets known hosts through and asks about
 * new ones. These run real commands under the real Seatbelt profile.
 */
import { describe, expect, it, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/main/stores/preferences-db.js", () => ({ getPreference: () => [], setPreference: () => undefined }));
const { fenceProfile, readDenied } = await import("../../src/main/shell-fence.js");
const { allowedBy, decide, DEFAULT_ALLOWED, ensureNetProxy, hostMatches, proxyUrlFor, setNetAsker, targetKey } = await import("../../src/main/net-proxy.js");
const http = await import("node:http");

const mac = process.platform === "darwin";
const argv = (profile: string, cmd: string, env: Record<string, string>) => ["-p", profile, "/usr/bin/env", ...Object.entries(env).map(([k, v]) => `${k}=${v}`), "/bin/sh", "-c", cmd];
const run = (profile: string, cmd: string, env: Record<string, string> = {}) =>
  spawnSync("/usr/bin/sandbox-exec", argv(profile, cmd, env), { encoding: "utf8", timeout: 20_000 });
/** Async: the proxy under test lives in this process and must keep answering. */
const runAsync = (profile: string, cmd: string, env: Record<string, string> = {}) => new Promise<{ out: string }>((resolve) => {
  const p = spawn("/usr/bin/sandbox-exec", argv(profile, cmd, env));
  let out = "";
  p.stdout.on("data", (b: Buffer) => { out += b.toString(); });
  p.stderr.on("data", (b: Buffer) => { out += b.toString(); });
  p.on("close", () => resolve({ out }));
});

describe("the allowlist", () => {
  it("matches a host exactly or a *. entry's subdomains, never a lookalike", () => {
    expect(hostMatches("github.com", "github.com")).toBe(true);
    expect(hostMatches("github.com", "evilgithub.com")).toBe(false);
    expect(hostMatches("*.github.com", "api.github.com")).toBe(true);
    expect(hostMatches("*.github.com", "github.com")).toBe(false);
    expect(hostMatches("*.github.com", "api.github.com.evil.io")).toBe(false);
    expect(allowedBy(DEFAULT_ALLOWED, "registry.npmjs.org")).toBe(true);
    expect(allowedBy(DEFAULT_ALLOWED, "example.com")).toBe(false);
  });

  it("judges loopback by port, so each local service is its own ask", () => {
    expect(targetKey("127.0.0.1", 3000)).toBe("localhost:3000");
    expect(targetKey("LOCALHOST", "5432")).toBe("localhost:5432");
    expect(targetKey("::1", 80)).toBe("localhost:80");
    expect(targetKey("api.github.com", 443)).toBe("api.github.com");
  });

  it("asks about a new host: once is this session's, always is saved, deny or no one to ask refuses", async () => {
    let saved: string[] = [];
    const ask = vi.fn(async () => "once" as const);
    expect(await decide("c1", "a.example", ask, () => saved, (l) => { saved = l; })).toBe(true);
    expect(await decide("c1", "a.example", ask, () => saved, (l) => { saved = l; })).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await decide("c2", "a.example", async () => "deny", () => saved, (l) => { saved = l; })).toBe(false);
    expect(await decide("c3", "b.example", async () => "always", () => saved, (l) => { saved = l; })).toBe(true);
    expect(saved).toEqual(["b.example"]);
    expect(await decide(null, "c.example", ask, () => saved, (l) => { saved = l; }), "a run with nobody to ask").toBe(false);
    expect(await decide(null, "registry.npmjs.org", ask, () => saved, (l) => { saved = l; })).toBe(true);
  });
});

describe.runIf(mac)("the fence, for real", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "shellfence-")));
  const folder = join(base, "session");
  const home = join(base, "home");
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(home, ".ssh"), { recursive: true });
  writeFileSync(join(home, ".ssh", "id_ed25519"), "PRIVATE KEY");
  writeFileSync(join(home, "notes.txt"), "fine to read");

  it("writes only in the folder and reads everything but the deny-list", () => {
    const p = fenceProfile(folder, readDenied(home), null);
    expect(run(p, `echo ok > ${folder}/a.txt && cat ${folder}/a.txt`).stdout.trim()).toBe("ok");
    const outside = join(homedir(), `glyphh-fence-out-${process.pid}.txt`);
    expect(run(p, `echo x > ${outside}`).status, "a write outside the folder (and outside tmp)").not.toBe(0);
    expect(run(p, `cat ${home}/notes.txt`).stdout.trim()).toBe("fine to read");
    const key = run(p, `cat ${home}/.ssh/id_ed25519`);
    expect(key.status).not.toBe(0);
    expect(key.stdout).not.toContain("PRIVATE");
  });

  it("reaches the network only through the proxy, which refuses a host nobody allowed", async () => {
    setNetAsker(async () => "deny");
    const port = await ensureNetProxy();
    const proxy = proxyUrlFor("chat-under-test");
    const p = fenceProfile(folder, readDenied(home), port);
    const direct = await runAsync(p, "/usr/bin/curl -sS --max-time 5 -o /dev/null -w '%{http_code}' https://1.1.1.1/; echo \" exit=$?\"", { NO_PROXY: "*" });
    expect(direct.out, "a direct connection is refused by the kernel").not.toMatch(/^200/);
    expect(direct.out).toMatch(/exit=[1-9]/);
    const denied = await runAsync(p, "/usr/bin/curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://example.com/", { HTTPS_PROXY: proxy, https_proxy: proxy });
    expect(denied.out).toMatch(/403|CONNECT tunnel failed/);
  });

  it("loopback is closed except the ports the member allowed; localhost over the proxy is asked", async () => {
    const svc = http.createServer((_q, r) => r.end("local-ok"));
    await new Promise<void>((r) => svc.listen(0, "127.0.0.1", () => r()));
    const svcPort = (svc.address() as { port: number }).port;
    const asked: string[] = [];
    setNetAsker(async (_c, host) => { asked.push(host); return "deny"; });
    const proxyPort = await ensureNetProxy();
    const proxy = proxyUrlFor("chat-loopback");
    const closed = fenceProfile(folder, readDenied(home), proxyPort);
    const direct = await runAsync(closed, `/usr/bin/curl -sS --max-time 5 --noproxy '*' http://127.0.0.1:${svcPort}/; echo " exit=$?"`);
    expect(direct.out, "a local port nobody allowed").not.toContain("local-ok");
    const opened = fenceProfile(folder, readDenied(home), proxyPort, [svcPort]);
    expect((await runAsync(opened, `/usr/bin/curl -sS --max-time 5 --noproxy '*' http://127.0.0.1:${svcPort}/`)).out).toContain("local-ok");
    const viaProxy = await runAsync(closed, `/usr/bin/curl -sS --max-time 5 -o /dev/null -w '%{http_code}' http://localhost:${svcPort}/`, { http_proxy: proxy, HTTP_PROXY: proxy });
    expect(viaProxy.out).toContain("403");
    expect(asked).toContain(`localhost:${svcPort}`);
    svc.close();
  });
});

describe("the Linux fence (bubblewrap), as argv", () => {
  it("binds the system read-only, the folder and the caches writable, hides the deny-list, and leaves no network but the relays", async () => {
    const { bwrapArgs } = await import("../../src/main/shell-fence.js");
    const kinds: Record<string, "dir" | "file"> = { "/tmp": "dir", "/h/.cache": "dir", "/h/.ssh": "dir", "/h/.netrc": "file" };
    const a = bwrapArgs("/w/s", ["/h/.ssh", "/h/.netrc", "/h/.aws"], ["/tmp", "/h/.cache", "/h/.npm"], "/run/sock", [4100, 5432], ["/bin/sh", "-c", "make"], (p) => kinds[p] ?? null);
    const pairs = (flag: string) => a.flatMap((x, i) => (x === flag ? [a[i + 1]] : []));
    expect(a.slice(0, 3)).toEqual(["--ro-bind", "/", "/"]);
    expect(a).toContain("--unshare-net");
    expect(a).toContain("--unshare-pid");
    expect(pairs("--bind")).toEqual(["/tmp", "/h/.cache", "/w/s", "/run/sock"]);
    expect(pairs("--tmpfs"), "a denied folder is hidden").toEqual(["/h/.ssh"]);
    expect(a.join(" ")).toContain("--ro-bind /dev/null /h/.netrc");
    expect(a.join(" ")).not.toContain("/h/.aws");
    const script = a[a.indexOf("-c", a.indexOf("--")) + 1]!;
    expect(script).toContain("TCP-LISTEN:4100,bind=127.0.0.1");
    expect(script).toContain("UNIX-CONNECT:/run/sock/5432.sock >/dev/null 2>&1 &");
    expect(a.slice(-3)).toEqual(["/bin/sh", "-c", "make"]);
    const bare = bwrapArgs("/w/s", [], [], null, [], ["make"], () => null);
    expect(bare.slice(-2)).toEqual(["--", "make"]);
  });
});
