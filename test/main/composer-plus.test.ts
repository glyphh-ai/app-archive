/**
 * composer-plus.test.ts — the composer's `+` menu as data (his order,
 * 2026-10-06, Claude's composer as the reference): ONE menu on both surfaces,
 * every row with an icon; the web (the desktop with capability checks) never
 * lists a native row; the toggles call the doors the Settings pages already
 * call; "Manage …" lands where each surface keeps the page.
 */
import { describe, it, expect, vi } from "vitest";
import {
  plusCapsOf, plusMenuRows, manageTargetOf, readConnectorRows,
  readMemoryState, toggleMemory, MEMORY_PREFS, ATTACH_LABEL, ATTACH_SHORTCUT, PLUS_ICONS,
  type PlusApi, type PlusState,
} from "../../src/renderer/help/composer-plus.js";

/** The desktop preload serves every door; the web's contract has no native picker. */
const DESKTOP_HAS = new Set(["glyphhPickAttachments", "pickWorkingDir", "skillsList", "skillSetEnabled", "connectionsList", "mcpConnectionsList", "mcpConnectionsUpdate", "loopModels", "attachDevicesList", "getPreference", "setPreference"]);
const WEB_HAS = new Set(["skillsList", "skillSetEnabled", "connectionsList", "mcpConnectionsList", "mcpConnectionsUpdate", "attachDevicesList", "getPreference", "setPreference"]);
const desktop = plusCapsOf((n) => DESKTOP_HAS.has(n));
const web = plusCapsOf((n) => WEB_HAS.has(n));
const st = (over: Partial<PlusState> = {}): PlusState => ({ surface: "desktop", space: "code", memoryOn: true, ...over });

describe("the rows, per surface", () => {
  it("desktop: attach ⌘U, then THE POWERS — Connections, Models, Your powers, Browse all, each opening the powers modal — then Memory ✓ (his order, 2026-10-09: no Devices)", () => {
    const rows = plusMenuRows(desktop, st());
    expect(rows.slice(0, 6).map((r) => r.id)).toEqual(["attach", "connectors", "models", "skills", "browse", "memory"]);
    for (const r of rows) expect(r.icon).toMatch(/^<svg/);
    expect(rows[0]).toMatchObject({ label: ATTACH_LABEL, shortcut: ATTACH_SHORTCUT, kind: "action" });
    expect(rows.filter((r) => r.kind === "submenu")).toEqual([]);
    for (const id of ["connectors", "models", "skills"]) expect(rows.find((r) => r.id === id)?.kind).toBe("action");
    expect(rows.find((r) => r.id === "browse")).toMatchObject({ label: "Browse all powers…", kind: "action" });
    expect(rows.find((r) => r.id === "memory")).toMatchObject({ kind: "check", checked: true });
  });
  it("desktop: Add folder… only — the session's own folder is the folder chip's (2026-10-09)", () => {
    const rows = plusMenuRows(desktop, st());
    expect(rows.map((r) => r.id)).toEqual(["attach", "connectors", "models", "skills", "browse", "memory", "add-folder"]);
    expect(rows.filter((r) => r.desktopOnly).every((r) => r.codeOnly)).toBe(true);
  });
  it("the web never lists a native row — no attach picker, no folder rows, even in Code", () => {
    const rows = plusMenuRows(web, st({ surface: "web" }));
    expect(rows.map((r) => r.id)).toEqual(["connectors", "skills", "browse", "memory"]);
    expect(rows.some((r) => r.desktopOnly)).toBe(false);
    expect(rows[0].sepBefore).toBe(false);
  });
  it("a desktop host read with the web's doors shows the same rows as the web (capability, not surface)", () => {
    expect(plusMenuRows(web, st()).map((r) => r.id)).toEqual(plusMenuRows(web, st({ surface: "web" })).map((r) => r.id));
  });
  it("Memory off reads unchecked", () => {
    expect(plusMenuRows(desktop, st({ memoryOn: false })).find((r) => r.id === "memory")).toMatchObject({ checked: false });
  });
  it("every icon is the house stroke glyph", () => {
    for (const svg of Object.values(PLUS_ICONS)) expect(svg).toContain('stroke="currentColor"');
  });
});

describe("where Manage goes", () => {
  it("Memory is a settings page on both surfaces; every power opens in the powers modal instead (2026-10-09)", () => {
    for (const surface of ["desktop", "web"] as const) {
      expect(manageTargetOf(surface, "memory")).toEqual({ kind: "settings", sub: "memory" });
    }
  });
});

describe("Connectors › — the Connections page's two reads, one switch", () => {
  const api: PlusApi = {
    connectionsList: vi.fn(async () => ({ ok: true, connections: [
      { id: "c1", appSlug: "gmail", appName: "Gmail", connected: true },
      { id: "c2", appSlug: "slack", appName: "Slack", label: "Acme Slack", connected: false, org: true },
      { id: "c3", appSlug: "linear-mcp", appName: "Linear (shadowed)" },
    ] })),
    mcpConnectionsList: vi.fn(async () => ({ ok: true, connections: [
      { slug: "linear-mcp", name: "Linear", enabled: true },
      { slug: "org-tools", name: "Org tools", enabled: true, kind: "org" },
    ] })),
    mcpConnectionsUpdate: vi.fn(async () => ({ ok: true })),
  };
  it("accounts + custom servers, by name; a server shadows an account of the same slug", async () => {
    const rows = await readConnectorRows(api);
    expect(rows.map((r) => [r.name, r.kind, r.on])).toEqual([
      ["Acme Slack", "account", false], ["Gmail", "account", true], ["Linear", "mcp", true], ["Org tools", "mcp", true],
    ]);
  });
  it("a host with neither read lists nothing", async () => {
    expect(await readConnectorRows({})).toEqual([]);
  });
});

describe("Memory ✓ — the member's preference (there is no per-session flag)", () => {
  const prefs = (over: Record<string, unknown>): { api: PlusApi; set: ReturnType<typeof vi.fn> } => {
    const store: Record<string, unknown> = { [MEMORY_PREFS.accepted]: "2026-10-01", ...over };
    const set = vi.fn((k: string, v: unknown) => { store[k] = v; });
    return { api: { getPreference: async (k, d) => (k in store ? store[k] : d), setPreference: set }, set };
  };
  it("on = accepted and memoryInject not false", async () => {
    expect(await readMemoryState(prefs({}).api)).toEqual({ accepted: true, on: true });
    expect(await readMemoryState(prefs({ [MEMORY_PREFS.inject]: false }).api)).toEqual({ accepted: true, on: false });
    expect(await readMemoryState(prefs({ [MEMORY_PREFS.accepted]: "" }).api)).toEqual({ accepted: false, on: false });
  });
  it("off writes both switches the Settings page has; on writes them back", () => {
    const { api, set } = prefs({});
    expect(toggleMemory(api, { accepted: true, on: true })).toBe("off");
    expect(set.mock.calls).toEqual([[MEMORY_PREFS.inject, false], [MEMORY_PREFS.capture, false]]);
    expect(toggleMemory(api, { accepted: true, on: false })).toBe("on");
    expect(set.mock.calls.slice(2)).toEqual([[MEMORY_PREFS.inject, true], [MEMORY_PREFS.capture, true]]);
  });
  it("before the policy is accepted nothing is written — the page is the door", () => {
    const { api, set } = prefs({ [MEMORY_PREFS.accepted]: "" });
    expect(toggleMemory(api, { accepted: false, on: false })).toBe("needs-policy");
    expect(set).not.toHaveBeenCalled();
  });
});


describe("connector rows wear the Connections page's logos (his order, 2026-10-06)", () => {
  it("an account row builds its icon from the connection (logo once cached, else the initial); a custom server from its iconUrl", async () => {
    vi.stubGlobal("window", {});   // the icon helper reads the API base off window; none here
    const { readConnectorRows } = await import("../../src/renderer/help/composer-plus");
    const api = {
      connectionsList: async () => ({ ok: true, connections: [{ id: "c1", appSlug: "gmail", appName: "Gmail", connected: true, accountId: "apn_1" }] }),
      mcpConnectionsList: async () => ({ ok: true, connections: [{ slug: "miro", name: "Miro Developer App", enabled: true, iconUrl: "https://cdn/miro.png" }] }),
    };
    const rows = await readConnectorRows(api as never);
    const gmail = rows.find((r) => r.key === "pd:c1")!;
    const miro = rows.find((r) => r.key === "mcp:miro")!;
    expect(gmail.prime).toEqual({ accountId: "apn_1", pipedreamSlug: "gmail" });
    expect(gmail.icon).toMatch(/drop-icon-initial|<img/);
    expect(miro.icon).toContain("<img");
    expect(miro.icon).toContain("cdn/miro.png");
    vi.unstubAllGlobals();
  });
});
