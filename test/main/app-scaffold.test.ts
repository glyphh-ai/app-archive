import { describe, expect, it, vi } from "vitest";

vi.mock("@glyphh/sdk", () => ({
  GLYPHH_APP_SPEC: "## Building a Glyphh app (spec)",
  SCAFFOLD_NEXT: ["edit", "app_install { dir }"],
  scaffoldAppFiles: (o: { name: string; slug?: string; connections?: string[]; connectionTools?: Array<{ app: string; tools: Array<{ name: string }> }> }) => ({
    "manifest.json": JSON.stringify({ name: o.name, slug: o.slug ?? o.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), connectors: o.connections ?? [] }),
    "worker.js": "x",
    ...(o.connections?.length ? { "CONNECTIONS.md": (o.connectionTools ?? []).map((c) => `${c.app}: ${c.tools.map((t) => t.name).join(",")}`).join("\n") } : {}),
  }),
}));

const { scaffoldAppFolder } = await import("../../src/main/app-scaffold.js");

function memFs() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files, dirs,
    existsSync: (p: string) => files.has(p) || dirs.has(p) || [...files.keys()].some((k) => k.startsWith(`${p}/`)),
    readdirSync: ((p: string) => [...files.keys()].filter((k) => k.startsWith(`${p}/`)).map((k) => k.slice(p.length + 1).split("/")[0]!)) as unknown as typeof import("node:fs").readdirSync,
    mkdirSync: ((p: string) => { dirs.add(p); return undefined; }) as unknown as typeof import("node:fs").mkdirSync,
    writeFileSync: ((p: string, c: string) => { files.set(p, c); }) as unknown as typeof import("node:fs").writeFileSync,
  };
}

describe("THE STARTER on this machine (2026-10-07)", () => {
  it("writes the SDK's files under the session's folder with the member's real connection tools, and answers the spec", () => {
    const f = memFs();
    const a = scaffoldAppFolder({ name: "Inbox Pulse", connections: ["Gmail"], base: "/w", connectorTools: (app) => (app === "gmail" ? [{ name: "gmail-find-email" }] : []), fsImpl: f });
    expect(a.dir).toBe("/w/inbox-pulse");
    expect(a.slug).toBe("inbox-pulse");
    expect(a.files).toEqual(["CONNECTIONS.md", "manifest.json", "worker.js"]);
    expect(a.connections).toEqual([{ app: "gmail", tools: 1 }]);
    expect(a.contract).toContain("Building a Glyphh app");
    expect(f.files.get("/w/inbox-pulse/CONNECTIONS.md")).toBe("gmail: gmail-find-email");
    expect(() => scaffoldAppFolder({ name: "Inbox Pulse", base: "/w", fsImpl: f })).toThrow(/already has files/);
    expect(scaffoldAppFolder({ name: "Other", dir: "/elsewhere/x", base: "/w", fsImpl: f }).dir).toBe("/elsewhere/x");
    expect(() => scaffoldAppFolder({ name: "", base: "/w", fsImpl: f })).toThrow(/`name` is required/);
    expect(() => scaffoldAppFolder({ name: "X", slug: "_no", base: "/w", fsImpl: f })).toThrow(/slug is lowercase/);
    expect(() => scaffoldAppFolder({ name: "X", base: "", fsImpl: f })).toThrow(/no folder/);
  });
});
