/**
 * glyphh-app-host — installable "Glyphh apps" (the marketplace unit) on the
 * desktop. A Glyphh app is a .glyphh zip:
 *
 *   manifest.json   { manifestVersion, kind:"glyphh-app", name, slug, entry,
 *                     capabilities: ["db.exec", "notify.send", …], tools?,
 *                     worker?, window?, description? }
 *   index.html (+ assets, + worker.js)   self-contained UI and headless logic
 *
 * AN APP IS A CLOUD INSTANCE (his order, 2026-10-06: "Cloud is first and every
 * surface pulls from it"). INSTALL validates the bundle here, then it goes to
 * the server as an app instance (app-instances.ts: create → R2 → ready) and a
 * `tab` library row names the instance, so it reaches every surface. Nothing
 * is unzipped on this machine, no worker starts here, no store of the app's
 * lives here. A hub app installs the same way without the round trip
 * (hub-ipc.ts installHubItem → POST /api/app-instances/from-hub).
 *
 * RUN: the panel's <webview> loads the server's proxy
 * (`/app-host/<key>/ui/`, the session cookie set on its partition)
 * and the preload's `glyphh.call(method, args)` rides main → the instance's
 * /call as the member — the pod enforces the manifest's capabilities. The
 * loop's and the local MCP's app tools ride the same instance
 * (app-instances.ts listInstanceTools / callInstanceTool).
 */

import { broadcast } from "./broadcast";
import { ipcMain, webContents } from "electron";
import AdmZip from "adm-zip";
import fs from "fs";
import os from "os";
import path from "path";
import { fetchOrgApps, invalidateOrgApps } from "./org-apps.js";
import { grantPanel, revokePanel, panelGrant } from "./glyphh-app-grants.js";
import { isRpaAppMethod, rpaCapabilityAllowed } from "./app-rpa-gate.js";
import { dispatchRelayMethod } from "./relay-client.js";
import { lintRemoteAssets } from "@glyphh/sdk";
import { SERVER_URL } from "./glyphh-client.js";
import {
  callInstanceBridge, callInstanceTool, ensureInstanceTab, findInstance, installBundleAsInstance, instanceKeyOfRow, instancePanelUrl,
  sessionBearer, type AppInstanceSummary,
} from "./app-instances.js";

// ── manifest ────────────────────────────────────────────────

/** An MCP tool an app exposes (the SDK's GLYPHH_APP_SPEC, manifest.json tools). Backed by exactly one
 *  of: a `capability` (1:1 passthrough on the instance) or a worker `handler`
 *  (the app's own logic, headless on the instance). */
export interface GlyphhAppTool {
  name: string;
  description?: string;
  capability?: string;
  handler?: string;
  inputSchema?: Record<string, unknown>;
}

export interface GlyphhAppManifest {
  manifestVersion: number;
  kind: "glyphh-app";
  name: string;
  slug: string;
  entry: string;
  /** Headless script — runs on the instance, registers handlers via glyphh.handle(). */
  worker?: string;
  capabilities: string[];
  /** Connector app slugs this app integrates; connector.* capabilities are scoped to the list. */
  connectors?: string[];
  tools?: GlyphhAppTool[];
  window?: { width?: number; height?: number };
  /** The release this bundle was cut from, so an imported app arrives with its version and notes. */
  release?: { version: string; notes?: string | null; channel?: "dev" | "live"; releasedAt?: string | null };
  description?: string;
}

/** The names a manifest may declare: THE SDK VALIDATOR'S LIST (sdk
 *  app-spec/validate.ts KNOWN_CAPABILITIES), kept in step by hand because the
 *  SDK build the desktop links is not rebuilt from here. The instance's bridge
 *  (rrotor app-server/bridge.ts) answers them; rpa.* is answered on THIS
 *  desktop (his order, 2026-10-07: apps call the rpa tooling) — see the
 *  glyphh-app:call handler. Install refuses a name on neither list, loudly. */
const KNOWN_CAPABILITIES = new Set([
  "db.exec",
  "vector.upsert", "vector.search", "vector.delete",
  "graph.cypher",
  "cron.schedule", "cron.cancel", "cron.list",
  "notify.send",
  "connector.status", "connector.tools", "connector.call",
  "secrets.get", "secrets.list",
  "app.call",
  // The member library's house kinds and image generation (2026-10-06).
  "library.list", "library.get", "library.put", "library.remove", "library.fileGet", "library.filePut",
  "images.generate",
  // RPA on a tab from the panel's UI, on the desktop it is open on.
  "rpa.commands", "rpa.run", "rpa.sequence",
]);

/** Names that used to be capabilities and refuse now, with what replaced
 *  each — the validator's RETIRED_CAPABILITIES. Install refuses them by name
 *  so the author learns the replacement instead of a bare "unknown". */
const RETIRED_CAPABILITIES = new Map<string, string>([
  ["llm.complete", "the agent writes and calls your tools with the result"],
  ["llm.embed", "vector.upsert embeds text itself"],
  ["llm.chunk", "split text in the worker"],
  ["agent.run", "the agent is the caller, never a capability"],
  ["contacts.search", "the google_contacts connector"],
  ["messages.send", "the gmail or slack connector"],
  ["web.fetch", "a connector"],
  ["web.read", "a connector"],
]);

/** Parse + validate a glyphh-app manifest ("" slug etc. rejected). */
export function readGlyphhAppManifest(json: string): GlyphhAppManifest | null {
  let m: GlyphhAppManifest;
  try { m = JSON.parse(json); } catch { return null; }
  if (m?.kind !== "glyphh-app") return null;
  if (!m.name || !m.slug || !m.entry) return null;
  m.slug = String(m.slug).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  // Leading-underscore slugs are reserved (the instance's bundle rule too).
  if (m.slug.startsWith("_")) return null;
  m.capabilities = Array.isArray(m.capabilities) ? m.capabilities.map(String) : [];
  m.connectors = Array.isArray(m.connectors)
    ? [...new Set(m.connectors.map((c) => String(c).trim().toLowerCase()).filter((c) => /^[a-z0-9_-]+$/.test(c)))]
    : [];
  m.worker = typeof m.worker === "string" && m.worker.trim() ? m.worker.trim() : undefined;
  m.tools = Array.isArray(m.tools)
    ? m.tools.filter(
        (t) =>
          t &&
          typeof t.name === "string" &&
          // exactly one backing: a capability OR a worker handler
          (typeof t.capability === "string") !== (typeof t.handler === "string")
      )
    : [];
  return m;
}

/** Peek a .glyphh zip's manifest to see if it's a glyphh-app (vs a legacy app). */
export function isGlyphhAppBundle(zipPath: string): boolean {
  try {
    const entry = new AdmZip(zipPath).getEntry("manifest.json");
    if (!entry) return false;
    return JSON.parse(entry.getData().toString("utf8"))?.kind === "glyphh-app";
  } catch {
    return false;
  }
}

// ── install ─────────────────────────────────────────────────

/** The bundle's own icon.svg, when it ships one, for the tab's icon. */
function bundleIconSvg(zip: AdmZip): string | null {
  const e = zip.getEntry("icon.svg");
  if (!e || e.header.size > 64_000) return null;
  try { return e.getData().toString("utf8"); } catch { return null; }
}

export interface InstallAnswer {
  ok: boolean;
  name?: string;
  updated?: boolean;
  error?: string;
  connectors?: string[];
  slug?: string;
  tools?: Array<{ name: string; description: string }>;
  /** The instance key the bundle became. */
  instance?: string;
}

/**
 * Install a .glyphh glyphh-app bundle: validate it here, make (or update) its
 * cloud instance, write the tab that names it. Returns { ok, name, instance }
 * or { ok:false, error }.
 */
export async function installGlyphhAppBundle(zipPath: string): Promise<InstallAnswer> {
  let zip: AdmZip;
  try { zip = new AdmZip(zipPath); } catch { return { ok: false, error: "Not a readable .glyphh bundle" }; }
  const entry = zip.getEntry("manifest.json");
  if (!entry) return { ok: false, error: "Bundle has no manifest.json" };
  const manifest = readGlyphhAppManifest(entry.getData().toString("utf8"));
  if (!manifest) return { ok: false, error: "manifest.json is not a valid glyphh-app manifest" };

  const retired = manifest.capabilities.filter((c) => RETIRED_CAPABILITIES.has(c));
  if (retired.length) {
    return { ok: false, error: `Retired capabilities: ${retired.map((c) => `${c} (use ${RETIRED_CAPABILITIES.get(c)})`).join(", ")}.` };
  }
  const unknown = manifest.capabilities.filter((c) => !KNOWN_CAPABILITIES.has(c));
  // NAME THE ALTERNATIVES (his rule, 2026-08-25): a bare refusal sent an agent
  // grepping the packaged asar for this very list. The set is small — print it.
  if (unknown.length) {
    return {
      ok: false,
      error: `Unknown capabilities: ${unknown.join(", ")}. Valid capabilities are: ${[...KNOWN_CAPABILITIES].sort().join(", ")}. ` +
        `Connector access is declared as capability "connector.call" (plus "connector.tools"/"connector.status"), with the ACCOUNTS named in the manifest's "connectors" array — never as connector.<name>.`,
    };
  }

  // Every capability-backed tool must reference a capability the app also
  // declared; every handler-backed tool needs the manifest to ship a worker.
  const badTool = (manifest.tools || []).find((t) => t.capability && !manifest.capabilities.includes(t.capability));
  if (badTool) return { ok: false, error: `Tool "${badTool.name}" needs undeclared capability "${badTool.capability}"` };
  const handlerTool = (manifest.tools || []).find((t) => t.handler);
  if (handlerTool && !manifest.worker) {
    return { ok: false, error: `Tool "${handlerTool.name}" uses a handler but the manifest declares no worker` };
  }
  // connector.* capabilities are meaningless without a connectors list (every
  // call would fail the declared-connector check) — refuse loudly instead.
  if (manifest.capabilities.some((c) => c.startsWith("connector.")) && !(manifest.connectors || []).length) {
    return { ok: false, error: "connector.* capabilities require a non-empty `connectors` list in the manifest" };
  }
  // A manifest tool backed by agent.run would let the agent call itself
  // (agent → tool → agent → …). Keep the loop non-recursive.
  const recursiveTool = (manifest.tools || []).find((t) => t.capability === "agent.run");
  if (recursiveTool) {
    return { ok: false, error: `Tool "${recursiveTool.name}" cannot expose agent.run as a tool` };
  }
  if (!zip.getEntry(manifest.entry)) return { ok: false, error: `Bundle entry not found: ${manifest.entry}` };
  if (manifest.worker && !zip.getEntry(manifest.worker)) return { ok: false, error: `Bundle worker not found: ${manifest.worker}` };

  // Defense in depth over the instance's CSP: refuse a bundle whose HTML/CSS/JS
  // references remote code (CDN, external <script>/<link>, remote import) —
  // catches hand-crafted or imported .glyphh files, not just update_app builds.
  const textEntries: Record<string, string> = {};
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !/\.(html?|css|m?js|jsx|ts|tsx)$/i.test(e.entryName)) continue;
    if (e.header.size > 2_000_000) continue;
    try { textEntries[e.entryName] = e.getData().toString("utf8"); } catch { /* skip */ }
  }
  const remote = lintRemoteAssets(textEntries);
  if (remote.length) return { ok: false, error: `Bundle references remote assets (bundle them at build time): ${remote[0]}` };

  // THE CLOUD INSTALL: the validated bundle becomes (or updates) an instance
  // and its tab row names the instance, so every surface opens it.
  let inst: AppInstanceSummary;
  const updated = !!(await findInstance(manifest.slug));
  try {
    inst = await installBundleAsInstance(fs.readFileSync(zipPath), manifest);
  } catch (err) {
    return { ok: false, error: `cloud install failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  try {
    const iconSvg = bundleIconSvg(zip);
    const iconUrl = iconSvg ? `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString("base64")}` : undefined;
    await ensureInstanceTab(inst, { ...manifest, ...(iconUrl ? { iconUrl } : {}) });
    invalidateOrgApps();
    // Tell every open window the app library changed so the Apps page and the
    // wall re-fetch — an app installed over MCP appears without a reload.
    broadcast("panel-apps-changed");
  } catch (err) {
    return { ok: false, error: `installed in the cloud, but its tab could not be written: ${err instanceof Error ? err.message : String(err)}` };
  }
  // "HERE IS WHAT I ADD TO THE TOOLBOX" (his ruling, 2026-09-18): an install
  // announces itself, so the agent that just installed an app knows what it
  // can now do without going back to discover.
  return {
    ok: true, name: manifest.name, updated: updated || undefined, connectors: manifest.connectors ?? [], slug: manifest.slug, instance: inst.key,
    tools: (manifest.tools ?? []).map((t) => ({ name: t.name, description: t.description ?? "" })),
  };
}

/** Install a .glyphh handed over as base64 (the local MCP's app_install: an agent deploying an app it built). */
export async function installGlyphhAppBundleFromBase64(bundleBase64: string): Promise<InstallAnswer> {
  const b64 = String(bundleBase64 || "").replace(/^data:[^,]*,/, "");
  if (!b64) return { ok: false, error: "bundleBase64 is required" };
  const tmp = path.join(os.tmpdir(), `glyphh-app-${process.pid}-${Buffer.from(b64).length}.glyphh`);
  try {
    fs.writeFileSync(tmp, Buffer.from(b64, "base64"));
    return await installGlyphhAppBundle(tmp);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
  }
}

// ── run ─────────────────────────────────────────────────────

/** True when a saved-app row is an installed Glyphh app — by archetype, or
 *  structurally (its executable is an .html entry, which must never be spawned
 *  as a program). The structural check keeps routing correct even if the
 *  archetype field was dropped somewhere. */
export function isGlyphhAppRow(row: { appArchetype?: string | null; execPath?: string | null }): boolean {
  if (row.appArchetype === "glyphh-app") return true;
  return !!row.execPath && /\.html?$/i.test(row.execPath);
}

interface AppRow {
  slug: string;
  name: string;
  appArchetype?: string | null;
  execPath?: string | null;
  launchConfig?: Record<string, unknown> | null;
}

async function findAppRow(slug: string): Promise<AppRow | undefined> {
  const key = String(slug || "").trim().toLowerCase();
  const apps = await fetchOrgApps().catch(() => []) as AppRow[];
  return apps.find((a) => isGlyphhAppRow(a) && a.slug.toLowerCase() === key);
}

/** The session cookie the server's /app-host proxy honors, set on the panel
 *  guest's partition for the API origin and the proxy path only — so the
 *  webview can load the instance's `ui/*`. Re-set on every open (the bearer
 *  rotates). False when signed out. */
async function grantPanelSession(ses: Electron.Session): Promise<boolean> {
  const token = await sessionBearer();
  if (!token) return false;
  try {
    await ses.cookies.set({
      url: SERVER_URL, name: "glyphh_session", value: token, path: "/app-host",
      secure: SERVER_URL.startsWith("https:"), httpOnly: true, sameSite: "strict",
    });
    return true;
  } catch (err) {
    console.warn("[glyphh-app] panel session cookie:", err instanceof Error ? err.message : err);
    return false;
  }
}

// ── IPC ─────────────────────────────────────────────────────

let registered = false;

/** Preview webContents ids that already have a teardown-revoke listener, so
 *  repeated preview-open calls on the reused preview <webview> don't stack up. */
const previewRevokeWired = new Set<number>();

/** Register the glyphh-app IPC surface (idempotent; call once at startup). */
export function registerGlyphhAppHost(): void {
  if (registered) return;
  registered = true;

  // A panel's `glyphh.call`: the instance's machine answers as the member and
  // enforces the manifest's capabilities itself. A webContents with no grant
  // is not an app panel and gets nothing.
  ipcMain.handle("glyphh-app:call", async (event, method: string, args: unknown) => {
    const grant = panelGrant(event.sender.id);
    if (!grant) return { ok: false, error: "this panel is not an installed app" };
    const m = String(method || "");
    // RPA ON A TAB (his order, 2026-10-07): the mapped commands live on this
    // desktop's tabs, so rpa.* is answered here on the relay registry, gated
    // by the instance's own manifest the way the bridge gates the rest.
    if (isRpaAppMethod(m)) {
      const inst = await findInstance(grant.instance).catch(() => undefined);
      const gate = rpaCapabilityAllowed(inst?.manifest ?? null, m);
      if (!gate.ok) return { ok: false, error: gate.error };
      try {
        const result = await dispatchRelayMethod(gate.relay, args && typeof args === "object" ? args : {});
        return { ok: true, result };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return callInstanceBridge(grant.instance, m, args ?? {});
  });

  // A Glyphh-app panel (the wall, the rail, the Apps page): the instance the
  // tab names — or, for a bare slug, the instance of that slug — loads the
  // server's proxy. The guest's partition gets the session cookie the proxy
  // honors for `ui/*`; the page's `glyphh.call` is the preload's
  // (contextBridge, read-only — the pod's injected shim cannot replace it)
  // and rides main → /call.
  ipcMain.handle("glyphh-app:preview-open", async (event, previewWcId: unknown, slug: unknown) => {
    const want = String(slug || "");
    const row = await findAppRow(want);
    const key = (row && instanceKeyOfRow(row)) || (await findInstance(want).catch(() => undefined))?.key || null;
    if (!key) {
      return { ok: false, error: `${row?.name || want} is not installed in the cloud — add it from Settings → Build → Discover, or app_install its bundle` };
    }
    // Only grant to a webContents that is genuinely a webview guest of the
    // calling window — never an arbitrary id handed in by the renderer.
    const guest = typeof previewWcId === "number" ? webContents.fromId(previewWcId) : undefined;
    if (!guest || guest.hostWebContents !== event.sender) return { ok: false, error: "invalid preview target" };
    const granted = await grantPanelSession(guest.session);
    if (!granted) return { ok: false, error: "sign in to open this app" };
    grantPanel(guest.id, row?.slug || want, row?.name || want, key);
    // The preview <webview> is reused across apps; a later grant overwrites this
    // one in place, and teardown drops it. Wire the teardown-revoke once per
    // guest so repeated switches don't pile up listeners.
    if (!previewRevokeWired.has(guest.id)) {
      previewRevokeWired.add(guest.id);
      guest.once("destroyed", () => { revokePanel(guest.id); previewRevokeWired.delete(guest.id); });
    }
    return { ok: true, fileUrl: instancePanelUrl(key), hosted: true };
  });

  // Switching the preview to a web app (or closing the detail) — drop any grant
  // left on the reused preview webContents so a web page can't inherit it.
  ipcMain.handle("glyphh-app:preview-clear", (_event, previewWcId: unknown) => {
    if (typeof previewWcId === "number") revokePanel(previewWcId);
    return { ok: true };
  });

  // Invoke an installed app's declared tool (Apps page "Test" button) — the
  // instance runs it as the member, the Tools tab's Never list applies.
  ipcMain.handle("glyphh-app:call-tool", async (_e, slug: string, tool: string, args: unknown) => {
    try {
      return { ok: true, result: await callInstanceTool(String(slug || ""), String(tool || ""), (args || {}) as Record<string, unknown>) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
