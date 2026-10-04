/**
 * harness-api.ts — the renderer's plain HTTP/WS door to the server's harness
 * front door (`/api/harness/*`) on the WEB target.
 *
 * The SDK's HarnessClient (window.glyphhSdk.harnessViaApi()) owns the RUN
 * transport (frames, answers, stops) and the workspace fs. The routes added
 * for the web command center — the thread store and the worker pty — are
 * thin JSON/WS resources the renderer can speak directly, authenticated by the
 * same session bearer the SDK holds (`client.token()`), against the same API
 * origin the bridge booted with (window.__GLYPHH_API_URL__). This module is
 * that one place: base url, bearer, error shape, WS url.
 *
 * Routes the web expects (the server side is checked against this list):
 *   GET    /api/harness/threads                → ThreadMeta[]
 *   GET    /api/harness/threads/:id            → ThreadMeta + { messages }
 *   PUT    /api/harness/threads/:id            ← { title?, mode?, source?, messages?, updatedAt }
 *                                              → { applied, thread: ThreadMeta }   (LWW on updatedAt)
 *   DELETE /api/harness/threads/:id            → 204 (404 = already gone)
 *   POST   /api/harness/pty                    ← { cwd?, cols, rows, command? }
 *                                              → { ptyId, wsPath }
 *   WS     /api/harness/pty/:ptyId?token=…     JSON frames both ways (pty-frames.ts)
 *
 * The renderer cannot import from @glyphh/sdk (preload boundary); the SDK
 * handle's `token()` is reached structurally, like remote-run.ts does.
 */

export class HarnessHttpError extends Error {
  readonly httpStatus: number;
  constructor(status: number, message: string) {
    super(message);
    this.httpStatus = status;
  }
}

/** The API origin the web target boots against (the bridge stamps it). */
export function harnessApiUrl(): string {
  const w = window as unknown as { __GLYPHH_API_URL__?: string };
  return (w.__GLYPHH_API_URL__ || "https://api.glyphh.ai").replace(/\/+$/, "");
}

/** The session bearer, from the SDK handle; null when signed out / no SDK. */
export async function harnessToken(): Promise<string | null> {
  const sdk = (window as unknown as { glyphhSdk?: { token?: () => Promise<string | null> } }).glyphhSdk;
  if (typeof sdk?.token !== "function") return null;
  try { return (await sdk.token()) || null; } catch { return null; }
}

/** `wss://…/api/harness<path>?token=…` — a browser cannot set WS headers, so
 *  the bearer rides the query, exactly as the SDK's own harness socket does. */
export function harnessWsUrl(path: string, token: string): string {
  const base = harnessApiUrl().replace(/^http/i, "ws");
  const p = path.startsWith("/") ? path : `/${path}`;
  const sep = p.includes("?") ? "&" : "?";
  return `${base}/api/harness${p}${sep}token=${encodeURIComponent(token)}`;
}

/** One JSON request against /api/harness. Throws HarnessHttpError (with the
 *  status) on a non-2xx answer; a 204 resolves undefined. Server envelopes
 *  (`{ data }`) are unwrapped. */
export async function harnessRequest<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = await harnessToken();
  if (!token) throw new HarnessHttpError(401, "signed out");
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const p = path.startsWith("/") ? path : `/${path}`;
  const res = await fetch(`${harnessApiUrl()}/api/harness${p}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) { try { parsed = JSON.parse(text); } catch { parsed = text; } }
  if (!res.ok) {
    const msg = parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string"
      ? (parsed as { error: string }).error
      : `${method} /api/harness${p} failed (${res.status})`;
    throw new HarnessHttpError(res.status, msg);
  }
  if (parsed && typeof parsed === "object" && "data" in (parsed as Record<string, unknown>) && Object.keys(parsed as object).length === 1) {
    return (parsed as { data: T }).data;
  }
  return parsed as T;
}
