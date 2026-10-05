/**
 * legacy-app-sweep.test.ts — PRE-CLOUD APP FOLDERS ARE DELETED, NO MIGRATION
 * (his word, 2026-10-05). The rule (legacyAppFolders) and the sweep over a
 * temp apps home: what goes, what stays, the once-per-user marker, and the
 * offline run that leaves everything in place for the next sign-in.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEGACY_SWEEP_MARKER, legacyAppFolders, sweepLegacyAppFolders, type SweepDeps } from "../../src/main/legacy-app-sweep.js";
import type { LocalAppRow } from "../../src/main/apps-store.js";

describe("legacyAppFolders — the rule", () => {
  it("names an app whose manifest says nothing about data, with no instance, that is not a house app", () => {
    expect(legacyAppFolders([{ slug: "expense-desk", manifest: { name: "Expense Desk" } as { data?: unknown }, isHouse: false, hasInstance: false }])).toEqual(["expense-desk"]);
  });
  it("keeps every app whose author spoke (cloud, local, per-home — or the scaffold's schema path)", () => {
    for (const data of ["cloud", "local", "per-home", "data/schema.sql", null]) {
      expect(legacyAppFolders([{ slug: "a", manifest: { data }, isHouse: false, hasInstance: false }])).toEqual([]);
    }
  });
  it("keeps an app that has an instance in the cloud, and a house app", () => {
    expect(legacyAppFolders([{ slug: "a", manifest: {}, isHouse: false, hasInstance: true }])).toEqual([]);
    expect(legacyAppFolders([{ slug: "images", manifest: {}, isHouse: true, hasInstance: false }])).toEqual([]);
  });
  it("never names a folder that is not an app (no manifest)", () => {
    expect(legacyAppFolders([{ slug: "crm", isHouse: false, hasInstance: false }, { slug: "x", manifest: null, isHouse: false, hasInstance: false }])).toEqual([]);
  });
  it("answers each slug once, lower-cased, in order, and skips an empty one", () => {
    const e = { manifest: {}, isHouse: false, hasInstance: false };
    expect(legacyAppFolders([{ slug: "B", ...e }, { slug: "a", ...e }, { slug: "b", ...e }, { slug: " ", ...e }])).toEqual(["b", "a"]);
  });
});

describe("sweepLegacyAppFolders — the first sign-in after the cut", () => {
  let home = "";
  let appsDir = "";
  let customRoot = "";
  let appsRoot = "";
  let marker = "";
  const logs: string[] = [];

  const row = (slug: string, over: Partial<LocalAppRow>): LocalAppRow => ({
    id: slug, kind: "web", slug, name: slug, prodUrl: null, nativeRef: null, config: null, description: "", access: "members", owned: true,
    latestVersion: null, version: "0.1.0", secretNames: [], requiredConnections: [], listing: null, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...over,
  });
  const write = (rel: string, body: string): void => {
    const file = path.join(home, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  const bundle = (slug: string, manifest: Record<string, unknown>): void => {
    write(`apps/${slug}/SKILL.md`, `---\nname: ${slug}\n---\n`);
    write(`apps/${slug}/app.json`, JSON.stringify(manifest));
    write(`apps/${slug}/ui/index.html`, "<h1>hi</h1>");
  };
  const tab = (slug: string, r: LocalAppRow): void => write(`apps/${slug}/tab.json`, JSON.stringify(r));
  const readRow = (slug: string): LocalAppRow | null => {
    try { return JSON.parse(fs.readFileSync(path.join(appsDir, slug, "tab.json"), "utf-8")) as LocalAppRow; } catch { return null; }
  };
  const deps = (instances: SweepDeps["instances"]): SweepDeps => ({ appsDir, appsRoot, customRoot, marker, instances, readRow, log: (l) => logs.push(l) });
  const has = (rel: string): boolean => fs.existsSync(path.join(home, rel));

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-sweep-"));
    appsDir = path.join(home, "apps");
    customRoot = path.join(home, "custom-apps");
    appsRoot = path.join(home, "org-apps");
    marker = path.join(home, LEGACY_SWEEP_MARKER);
    logs.length = 0;
    // From before the cloud: a bundle with no word on data …
    bundle("pre-cloud", { name: "Pre Cloud", ui: "ui/index.html" });
    // … a .glyphh unzipped into custom-apps with a glyphh row pointing at it …
    write("custom-apps/zipped/manifest.json", JSON.stringify({ manifestVersion: 2, kind: "glyphh-app", name: "Zipped", slug: "zipped", entry: "index.html" }));
    write("custom-apps/zipped/index.html", "<h1>z</h1>");
    tab("zipped", row("zipped", { kind: "glyphh", nativeRef: path.join(customRoot, "zipped", "index.html"), config: { capabilities: [] } }));
    // … one unzipped into the org-scoped root …
    write("org-apps/org1/scoped/manifest.json", JSON.stringify({ kind: "glyphh-app", name: "Scoped", slug: "scoped", entry: "index.html" }));
    write("org-apps/org1/scoped/index.html", "<h1>s</h1>");
    tab("scoped", row("scoped", { kind: "glyphh", nativeRef: path.join(appsRoot, "org1", "scoped", "index.html"), config: {} }));
    // … and a glyphh row whose payload is already gone.
    tab("row-only", row("row-only", { kind: "glyphh", nativeRef: path.join(customRoot, "row-only", "index.html"), config: {} }));
    // Current-model apps: the author spoke.
    bundle("scaffold", { name: "Scaffold", ui: "ui/index.html", data: "data/schema.sql" });
    bundle("keeper", { name: "Keeper", data: "local" });
    bundle("both", { name: "Both", data: "per-home" });
    // No word on data, but an instance of its slug is in the cloud.
    bundle("cloudy", { name: "Cloudy" });
    // A glyphh row that names its instance.
    tab("named", row("named", { kind: "glyphh", nativeRef: path.join(customRoot, "named", "index.html"), config: { instance: "named~u1" } }));
    write("custom-apps/named/manifest.json", JSON.stringify({ kind: "glyphh-app", name: "Named" }));
    // House apps: by slug, and by being a built-in panel.
    bundle("images", { name: "Images" });
    bundle("panel", { name: "Panel", tool: "gdesign" });
    // Not app folders at all: a web tab's row, a hidden folder, a link, a broken manifest.
    tab("crm", row("crm", { kind: "web", prodUrl: "https://crm" }));
    write("apps/.cache/x", "");
    bundle("broken", { name: "Broken" });
    fs.writeFileSync(path.join(appsDir, "broken", "app.json"), "{ not json");
    fs.mkdirSync(path.join(home, "dev-build"), { recursive: true });
    fs.writeFileSync(path.join(home, "dev-build", "app.json"), "{}");
    fs.symlinkSync(path.join(home, "dev-build"), path.join(appsDir, "linked"), "dir");
  });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  it("removes the pre-cloud folders (bundle, unzipped payload and its row, a row alone) and nothing else", async () => {
    const r = await sweepLegacyAppFolders(deps(async () => [{ slug: "cloudy" }]));
    expect(r.swept.sort()).toEqual(["pre-cloud", "row-only", "scoped", "zipped"]);
    expect(r.skipped).toBeUndefined();
    for (const gone of ["apps/pre-cloud", "apps/zipped", "custom-apps/zipped", "apps/scoped", "org-apps/org1/scoped", "apps/row-only"]) expect(has(gone), gone).toBe(false);
    for (const kept of ["apps/scaffold/ui/index.html", "apps/keeper", "apps/both", "apps/cloudy", "apps/named", "custom-apps/named", "apps/images", "apps/panel", "apps/crm/tab.json", "apps/.cache", "apps/broken", "apps/linked", "dev-build/app.json", "org-apps/org1"]) expect(has(kept), kept).toBe(true);
    expect(logs.join("\n")).toContain("removed 4 app folders from before the cloud");
    expect(JSON.parse(fs.readFileSync(marker, "utf-8")).swept.sort()).toEqual(["pre-cloud", "row-only", "scoped", "zipped"]);
  });

  it("runs once per user: the marker ends every later run before it reads anything", async () => {
    await sweepLegacyAppFolders(deps(async () => []));
    bundle("late", { name: "Late" });
    const r = await sweepLegacyAppFolders(deps(async () => { throw new Error("must not be asked"); }));
    expect(r).toEqual({ swept: [], skipped: "done" });
    expect(has("apps/late")).toBe(true);
  });

  it("offline (the instances cannot be listed): removes nothing, writes no marker, says so", async () => {
    const r = await sweepLegacyAppFolders(deps(async () => { throw new Error("401 Unauthorized"); }));
    expect(r).toEqual({ swept: [], skipped: "offline" });
    expect(has("apps/pre-cloud")).toBe(true);
    expect(has("custom-apps/zipped")).toBe(true);
    expect(fs.existsSync(marker)).toBe(false);
    expect(logs.join("\n")).toContain("sweep deferred");
  });

  it("with nothing from before the cloud, still marks the user done", async () => {
    for (const slug of ["pre-cloud", "zipped", "scoped", "row-only"]) fs.rmSync(path.join(appsDir, slug), { recursive: true, force: true });
    const r = await sweepLegacyAppFolders(deps(async () => [{ slug: "cloudy" }]));
    expect(r.swept).toEqual([]);
    expect(fs.existsSync(marker)).toBe(true);
    expect(logs.join("\n")).toContain("no app folders from before the cloud");
  });
});
