/**
 * artifacts-ipc.ts — THE ARTIFACTS PANEL's desktop transport (his order,
 * 2026-10-05: "on the web and desktop i want there to also be an artifacts
 * web panel… We should allow the comment and share feature"). The renderer
 * has no SDK handle, so these thin IPC methods call the main-process client
 * (getClient().http) against the server's artifact routes:
 *
 *   GET    /api/artifacts?scope=all|mine|shared     the list
 *   GET    /api/artifacts/{id}                      one row
 *   GET    /api/artifacts/{id}/content              the bytes (bearer)
 *   PUT    /api/artifacts/{id}                      { name?, access? }
 *   DELETE /api/artifacts/{id}
 *   POST   /api/artifacts/{id}/share                { access } → { access, shareUrl|null }
 *   GET    /api/artifacts/{id}/comments             the threads
 *   POST   /api/artifacts/{id}/comments             { text, region?, parentId? }
 *   PATCH  /api/artifacts/{id}/comments/{cid}       { resolved }
 *   DELETE /api/artifacts/{id}/comments/{cid}
 *
 * Every answer is an `{ ok, data | error }` envelope (never a throw across
 * the bridge); the server's `{ data }` wrapper is unwrapped here. The web's
 * counterpart is web/src/web-contract.js's artifacts* shims — same names,
 * same envelopes — so help/artifacts-panel.ts paints one way.
 */

import { ipcMain } from "electron";
import { getClient } from "./glyphh-client";

type Env<T> = { ok: true; data: T } | { ok: false; error: string };

const fail = (err: unknown): { ok: false; error: string } => ({ ok: false, error: err instanceof Error ? err.message : String(err) });
/** The server envelopes as `{ data }`; the SDK's http may already unwrap — take either. */
const unwrap = <T>(r: unknown): T => (r && typeof r === "object" && "data" in (r as Record<string, unknown>) ? (r as { data: T }).data : (r as T));
const pathOf = (id: string, tail = ""): string => `/api/artifacts/${encodeURIComponent(String(id || ""))}${tail}`;
const SCOPES = new Set(["all", "mine", "shared"]);

async function run<T>(work: () => Promise<unknown>): Promise<Env<T>> {
  try { return { ok: true, data: unwrap<T>(await work()) }; }
  catch (err) { return fail(err); }
}

function toBase64(buf: ArrayBuffer): string {
  return Buffer.from(buf).toString("base64");
}

export function registerArtifactsIpc(): void {
  ipcMain.handle("artifacts-list", (_e, scope: string) => {
    const s = SCOPES.has(String(scope)) ? String(scope) : "all";
    return run(() => getClient().http.get(`/api/artifacts?scope=${s}`));
  });
  ipcMain.handle("artifacts-get", (_e, id: string) => run(() => getClient().http.get(pathOf(id))));
  // The bytes: main fetches them with the bearer and hands them over base64
  // with their mime; the renderer frames a blob URL in a sandboxed iframe.
  ipcMain.handle("artifacts-content", async (_e, id: string) => {
    try {
      const meta = unwrap<{ mime?: string }>(await getClient().http.get(pathOf(id)));
      const bytes = await getClient().http.getBytes(pathOf(id, "/content"));
      return { ok: true as const, data: { base64: toBase64(bytes), mime: String(meta?.mime || "application/octet-stream") } };
    } catch (err) { return fail(err); }
  });
  ipcMain.handle("artifacts-update", (_e, id: string, patch: { name?: string; access?: string }) => {
    const body: Record<string, string> = {};
    if (typeof patch?.name === "string") body.name = patch.name;
    if (typeof patch?.access === "string") body.access = patch.access;
    return run(() => getClient().http.put(pathOf(id), body));
  });
  ipcMain.handle("artifacts-delete", (_e, id: string) => run(() => getClient().http.del(pathOf(id))));
  ipcMain.handle("artifacts-share", (_e, id: string, access: string) => run(() => getClient().http.post(pathOf(id, "/share"), { access: String(access || "private") })));
  ipcMain.handle("artifacts-comments", (_e, id: string) => run(() => getClient().http.get(pathOf(id, "/comments"))));
  ipcMain.handle("artifacts-comment-add", (_e, id: string, input: { text: string; region?: unknown; parentId?: string; agent?: boolean }) => {
    const body: Record<string, unknown> = { text: String(input?.text || "") };
    if (input?.region) body.region = input.region;
    if (input?.parentId) body.parentId = String(input.parentId);
    if (input?.agent === true) body.agent = true;
    return run(() => getClient().http.post(pathOf(id, "/comments"), body));
  });
  ipcMain.handle("artifacts-comment-patch", (_e, id: string, cid: string, patch: { resolved: boolean }) =>
    run(() => getClient().http.patch(pathOf(id, `/comments/${encodeURIComponent(String(cid || ""))}`), { resolved: !!patch?.resolved })));
  ipcMain.handle("artifacts-comment-delete", (_e, id: string, cid: string) =>
    run(() => getClient().http.del(pathOf(id, `/comments/${encodeURIComponent(String(cid || ""))}`))));
}
