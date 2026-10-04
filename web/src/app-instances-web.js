/**
 * app-instances-web.js — the web's door to APP INSTANCES: apps installed in
 * the cloud (his decision, 2026-10-04). The desktop's counterpart is
 * src/main/app-instances.ts; the shapes are shared (src/shared/app-instances.ts).
 *
 *   list     GET /api/app-instances — the ones this member may open
 *   open     a panel loads `/app-host/<key>/ui/index.html` ON THIS ORIGIN:
 *            web/app-host-proxy.mjs forwards it to the API with the session
 *            cookie turned into the bearer (an iframe cannot carry a header)
 *   cards    Settings → Apps lists each instance as a card; its detail is the
 *            manifest; Open writes the `tab` record; Remove deletes the instance
 *
 * Pure over an injected client + document, so it tests with no browser.
 */
import {
  instanceCardOf, instanceDetailOf, instanceKeyOfCardId, instanceKeyOfRow, instanceTabRow, isInstanceCardId, panelPathOf, resolveInstance,
} from '../../src/shared/app-instances';
import { tabRecordOf } from '../../src/shared/member-library';

export const PANEL_COOKIE = 'glyphh_session';

/** The cookie line a panel open writes: scoped to the proxy path, never sent
 *  with the app's own pages, Secure on https. */
export const panelCookieOf = (token, secure) =>
  `${PANEL_COOKIE}=${encodeURIComponent(String(token))}; path=/app-host; SameSite=Strict${secure ? '; Secure' : ''}`;

/**
 * @param {object} client  the SDK client (client.http, client.token, client.memberLibrary)
 * @param {object} deps    { document, secure, now, userId }
 */
export function buildAppInstancesWeb(client, deps = {}) {
  const doc = deps.document ?? (typeof document !== 'undefined' ? document : null);
  const secure = deps.secure ?? (typeof location !== 'undefined' && location.protocol === 'https:');
  // THE CLOCK: strictly increasing across this page's writes (the member
  // library's rule — a put and a remove in one millisecond must not collide).
  const wall = deps.now ?? (() => Date.now());
  let lastClock = 0;
  const now = () => { lastClock = Math.max(wall(), lastClock + 1); return lastClock; };
  let cached = null;

  const listInstances = async () => {
    try {
      const rows = await client.http.get('/api/app-instances');
      cached = Array.isArray(rows) ? rows : [];
    } catch { cached = []; }
    return cached;
  };
  const userId = async () => {
    if (deps.userId) return deps.userId;
    try { const me = await client.me(); return String(me?.userId || me?.id || ''); } catch { return ''; }
  };
  const token = async () => { try { return (await client.token()) || null; } catch { return null; } };

  /** The session cookie the proxy honors, set for the panel path only. */
  const grantPanelSession = async () => {
    const t = await token();
    if (!t || !doc) return false;
    doc.cookie = panelCookieOf(t, secure);
    return true;
  };

  /** THE PANEL: the instance a tab (or a bare slug) names, with the cookie set
   *  so the iframe can load it. The same answer shape as the desktop's
   *  glyphh-app:preview-open. */
  const previewOpen = async (slug, rows = []) => {
    const key = String(slug || '').toLowerCase().trim();
    const row = rows.find((r) => String(r.slug || r.id || '').toLowerCase() === key);
    let instanceKey = row ? instanceKeyOfRow(row) : null;
    if (!instanceKey) {
      const inst = resolveInstance(await listInstances(), key, await userId());
      instanceKey = inst ? inst.key : null;
    }
    if (!instanceKey) return { ok: false, error: `${row?.name || slug} is not installed in the cloud. Install it, or move it from the desktop it lives on.` };
    if (!(await grantPanelSession())) return { ok: false, error: 'sign in to open this app' };
    return { ok: true, fileUrl: panelPathOf(instanceKey), hosted: true };
  };

  const cards = async (haveFolders = new Set()) => {
    const at = new Date(now()).toISOString();
    return (await listInstances()).filter((i) => !haveFolders.has(i.slug)).map((i) => instanceCardOf(i, at));
  };
  const find = async (id) => {
    const key = instanceKeyOfCardId(String(id));
    const inst = (await listInstances()).find((i) => i.key === key);
    if (!inst) throw new Error(`no cloud app ${key}`);
    return inst;
  };
  const detail = async (id) => instanceDetailOf(await find(id), new Date(now()).toISOString());
  /** Open = the tab record (the wall and the rail read it on every surface). */
  const tab = async (id) => {
    const inst = await find(id);
    const lib = client.memberLibrary;
    let existing = null;
    try { const item = await lib.get('tab', inst.slug); existing = item?.data ?? null; } catch { existing = null; }
    const at = now();
    const row = instanceTabRow(inst, null, existing, new Date(at).toISOString());
    await lib.put('tab', inst.slug, { data: tabRecordOf(row), updatedAt: at });
    return { slug: row.slug, name: row.name };
  };
  const remove = async (id) => {
    const inst = await find(id);
    await client.http.del(`/api/app-instances/${encodeURIComponent(inst.key)}`);
    cached = null;
    try { await client.memberLibrary.remove('tab', inst.slug, { updatedAt: now() }); } catch { /* no tab, or already gone */ }
    return true;
  };

  return { listInstances, previewOpen, grantPanelSession, cards, detail, tab, remove, isInstanceCardId };
}
