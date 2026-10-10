/**
 * The desktop app on a Glyphh machine (Phase 3): it signs in as the machine's
 * owner, takes the machine's readable name, hides the machine's token from
 * everything it runs, and fences the machine's own data away from shells.
 */
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { delete process.env.GLYPHH_MACHINE_TOKEN; vi.resetModules(); });

describe("off a machine", () => {
  it("is plain: the hostname, no extra fence, no sign-in", async () => {
    const m = await import("../../src/main/machine-mode");
    expect(m.onMachine()).toBe(false);
    expect(m.deviceName()).toBe(hostname());
    expect(m.machineDenied()).toEqual([]);
    await expect(m.machineSignIn("https://api.test", join(tmpdir(), "x"))).rejects.toThrow(/not a machine/);
  });
});

describe("on a machine", () => {
  it("takes the token out of the environment and signs in as the owner under the machine's name", async () => {
    process.env.GLYPHH_MACHINE_TOKEN = "gy_mk_m1.sig";
    const m = await import("../../src/main/machine-mode");
    expect(m.onMachine()).toBe(true);
    expect(process.env.GLYPHH_MACHINE_TOKEN).toBeUndefined();
    const asked: Array<{ url: string; auth: string }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      asked.push({ url, auth: String((init.headers as Record<string, string>).authorization) });
      return new Response(JSON.stringify({ data: { accessToken: "gy_at_1", refreshToken: "gy_rt_1", expiresIn: 3600, machine: { id: "m1", name: "amber-otter-4f2a" } } }), { status: 200 });
    }) as typeof fetch;
    const file = join(mkdtempSync(join(tmpdir(), "mach-")), ".glyphh", ".session");
    expect(await m.machineSignIn("https://api.test/", file, fetcher)).toBe("amber-otter-4f2a");
    expect(asked).toEqual([{ url: "https://api.test/api/machines/session", auth: "Bearer gy_mk_m1.sig" }]);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved).toMatchObject({ accessToken: "gy_at_1", refreshToken: "gy_rt_1" });
    expect(saved.expiresAt).toBeGreaterThan(Date.now());
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(m.deviceName()).toBe("amber-otter-4f2a");
  });

  it("a refused sign-in is an error, never a half-written session", async () => {
    process.env.GLYPHH_MACHINE_TOKEN = "gy_mk_m1.sig";
    const m = await import("../../src/main/machine-mode");
    const file = join(mkdtempSync(join(tmpdir(), "mach-")), ".session");
    await expect(m.machineSignIn("https://api.test", file, (async () => new Response("{}", { status: 401 })) as typeof fetch)).rejects.toThrow(/401/);
    expect(() => readFileSync(file)).toThrow();
  });

  it("hides the machine's own data from every shell", async () => {
    process.env.GLYPHH_MACHINE_TOKEN = "gy_mk_m1.sig";
    const m = await import("../../src/main/machine-mode");
    expect(m.machineDenied()).toEqual(["/data/pg", "/data/neo4j", "/data/apps", "/data/browser", "/data/build", "/data/app"]);
    expect(m.machineWorkspace()).toBe("/data/workspace");
  });
});
