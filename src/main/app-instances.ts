/**
 * app-instances.ts — the desktop's door to APP INSTANCES: apps installed in
 * the cloud (his decision, 2026-10-04). The server owns the instance
 * (server glyphh/docs/app-instances.md); this module is the client of its
 * routes and the writer of the `tab` library row that names the instance on
 * every surface.
 *
 *   install   POST /api/app-instances → PUT the zip to R2 → POST …/ready
 *   list      GET  /api/app-instances (the ones this member may open)
 *   tools     the manifest's tools; a call is POST …/{key}/invoke
 *   bridge    a panel's `glyphh.call` is POST /app-host/{key}/call, as the member
 *   delete    DELETE /api/app-instances/{key}
 *
 * The LOCAL app host (glyphh-app-host.ts: unzip into ~/.glyphh, a worker, a
 * SQLite per app) is no longer started; `GLYPHH_LOCAL_APPS=1` brings it back
 * for a rollback (documented in docs/GLYPHH-APP-SPEC.md). Nothing here
 * touches Electron, so the pure parts are tested under test/main.
 */

import * as appsStore from "./apps-store.js";
import { getActiveUserId } from "./app-paths.js";
import { appCache, getClient, SERVER_URL } from "./glyphh-client.js";
import {
  instanceCardOf, instanceDetailOf, instanceRequestOf, instanceTabRow, instanceToolRows, isInstanceCardId, instanceKeyOfCardId,
  panelUrlOf, callPathOf, resolveInstance, tabConfigOf,
  type AppInstanceSummary, type BundleManifestLike, type InstanceCard, type InstanceKind,
} from "../shared/app-instances.js";

export type { AppInstanceSummary, InstanceCard, InstanceKind } from "../shared/app-instances.js";
export { isInstanceCardId, instanceKeyOfCardId, instanceKeyOfRow, panelUrlOf } from "../shared/app-instances.js";

/** The rollback switch: the local app host (unzip + worker + db) runs again. */
export const localAppsEnabled = (): boolean => process.env.GLYPHH_LOCAL_APPS === "1";

const CACHE_KEY = "app-instances";

/** The instances this member may open — org (everyone / on the list) and
 *  their own personal ones. Short-TTL cached (the wall, the loop's catalog
 *  and the Apps page all read it); empty when signed out or offline. */
export function listInstances(): Promise<AppInstanceSummary[]> {
  return appCache.cached(CACHE_KEY, async () => {
    try {
      const rows = await getClient().http.get<AppInstanceSummary[]>("/api/app-instances");
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  });
}

export function invalidateInstances(): void {
  appCache.invalidate(CACHE_KEY);
}

/** The instance a ref names (key, slug, or the member's personal one). */
export async function findInstance(ref: string): Promise<AppInstanceSummary | undefined> {
  return resolveInstance(await listInstances(), ref, getActiveUserId() || "");
}

interface CreateAnswer { instance: AppInstanceSummary; upload: { url: string; key: string } }

const isForbidden = (err: unknown): boolean => {
  const e = err as { code?: unknown; status?: unknown } | null;
  return e?.code === "E_FORBIDDEN" || e?.status === 403;
};

/** INSTALL = an org instance. The bundle's bytes go to the server's R2
 *  through the presigned PUT the create answers, then `ready` starts (or
 *  rolls) the instance's machine. An org admin installs an org instance;
 *  anyone else a personal one — with no `kind` given, org is tried first
 *  and a refusal falls back to personal, so one call works for every role.
 *  Re-installing a slug updates the instance in place (the server's rule). */
export async function installBundleAsInstance(bytes: Buffer, manifest: BundleManifestLike, opts: { kind?: InstanceKind; fetchImpl?: typeof fetch } = {}): Promise<AppInstanceSummary> {
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const client = getClient();
  const create = async (kind: InstanceKind): Promise<CreateAnswer> =>
    client.http.post<CreateAnswer>("/api/app-instances", instanceRequestOf(manifest, { sha256, sizeBytes: bytes.length }, kind));
  let made: CreateAnswer;
  if (opts.kind) made = await create(opts.kind);
  else {
    try { made = await create("org"); }
    catch (err) { if (!isForbidden(err)) throw err; made = await create("personal"); }
  }
  const put = await (opts.fetchImpl ?? fetch)(made.upload.url, { method: "PUT", body: new Uint8Array(bytes), headers: { "content-type": "application/zip" } });
  if (!put.ok) throw new Error(`the bundle upload was refused (HTTP ${put.status})`);
  const live = await client.http.post<AppInstanceSummary>(`/api/app-instances/${encodeURIComponent(made.instance.key)}/ready`, {});
  invalidateInstances();
  return live;
}

/** The `tab` row for an instance: written through apps-store so it is
 *  announced to the member library and reaches every surface. A legacy local
 *  row of the same slug is retargeted (its folder stays; nothing points at it). */
export async function ensureInstanceTab(inst: AppInstanceSummary, manifest: BundleManifestLike | null): Promise<appsStore.LocalAppRow> {
  const existing = appsStore.readRow(inst.slug);
  const row = instanceTabRow(inst, manifest, existing, new Date().toISOString());
  if (existing) {
    return appsStore.updateEntry(inst.slug, { name: row.name, kind: "glyphh", nativeRef: null, url: null, description: row.description, config: row.config ?? undefined });
  }
  return appsStore.createEntry({ kind: "glyphh", slug: inst.slug, name: row.name, description: row.description, config: row.config ?? tabConfigOf(inst, manifest) });
}

/** Every instance's declared tools, for app_list_tools and the loop's catalog. */
export async function listInstanceTools(): Promise<ReturnType<typeof instanceToolRows>> {
  return instanceToolRows(await listInstances());
}

/** app_call_tool's path: the instance's machine runs the tool as this member. */
export async function callInstanceTool(ref: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const inst = await findInstance(ref);
  if (!inst) throw new Error(`unknown app: ${ref} — not installed in the cloud (app_list_tools names what is)`);
  const answer = await getClient().http.post<unknown>(`/api/app-instances/${encodeURIComponent(inst.key)}/invoke`, { tool, args: args || {} }, { raw: true });
  const body = answer as { result?: unknown; error?: unknown; detail?: unknown } | null;
  if (body && typeof body === "object" && "error" in body && body.error) throw new Error(String(body.detail || body.error));
  return body && typeof body === "object" && "result" in body ? body.result : body;
}

/** A panel's `glyphh.call(method, args)` on the desktop: the preload hands it
 *  to main, main POSTs the instance's /call as the member (the bearer, never
 *  a cookie) and answers the pod's own `{ok, result} | {ok:false, error}`. */
export async function callInstanceBridge(key: string, method: string, args: unknown, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  let token = "";
  try { token = await getClient().token(); } catch { token = ""; }
  if (!token) return { ok: false, error: "signed out" };
  try {
    const res = await fetchImpl(`${SERVER_URL}${callPathOf(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ method, args: args ?? {} }),
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (body && typeof body === "object" && "ok" in body) return body as { ok: true; result: unknown } | { ok: false; error: string };
    if (!res.ok) {
      const detail = body && typeof body === "object" ? (body as { detail?: unknown; error?: unknown }).detail ?? (body as { error?: unknown }).error : null;
      return { ok: false, error: String(detail || `the app answered ${res.status}`) };
    }
    return { ok: true, result: body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The URL a panel loads for an instance: the server's proxy, the bundle's entry. */
export const instancePanelUrl = (key: string): string => panelUrlOf(SERVER_URL, key);

/** The session bearer, for the cookie a panel's webview needs to load `ui/*`. */
export async function sessionBearer(): Promise<string | null> {
  try { return (await getClient().token()) || null; } catch { return null; }
}

export async function deleteInstance(key: string): Promise<void> {
  await getClient().http.del(`/api/app-instances/${encodeURIComponent(key)}`);
  invalidateInstances();
  // The tab that named it goes with it (a legacy local folder is never touched).
  const slug = key.split("~", 1)[0];
  const row = appsStore.readRow(slug);
  if (row && row.kind === "glyphh" && !row.nativeRef) await appsStore.removeEntry(slug).catch(() => undefined);
}

// ── Settings → Apps cards ───────────────────────────────────────────────────

/** The cards of the instances that have no folder on this machine (an
 *  instance whose slug is a bundle folder in the apps home is that card). */
export async function instanceCards(haveFolders: Set<string>): Promise<InstanceCard[]> {
  const now = new Date().toISOString();
  return (await listInstances()).filter((i) => !haveFolders.has(i.slug)).map((i) => instanceCardOf(i, now));
}

export async function instanceDetail(id: string): Promise<ReturnType<typeof instanceDetailOf>> {
  const key = instanceKeyOfCardId(id);
  const inst = (await listInstances()).find((i) => i.key === key);
  if (!inst) throw new Error(`no cloud app ${key}`);
  return instanceDetailOf(inst, new Date().toISOString());
}

/** Open = the tab (created on first open, so the wall and the rail know it). */
export async function instanceTab(id: string): Promise<{ slug: string; name: string }> {
  const key = instanceKeyOfCardId(id);
  const inst = (await listInstances()).find((i) => i.key === key);
  if (!inst) throw new Error(`no cloud app ${key}`);
  const row = await ensureInstanceTab(inst, null);
  return { slug: row.slug, name: row.name };
}
