/**
 * house-relay-web.js — THE HOUSE PANELS' DATA ON THE WEB, off the attached
 * desktop over the relay (his order, 2026-10-05: "selecting Apps → Design
 * should open the web panel in the web but pull through the relay").
 *
 * The web renderer hosts Design / Slides / Images / Video / Audio / Drive
 * itself (code-workbench.ts) and reads them through window.glyphh's design*,
 * gpoint*, media* and gdrive* shims. Those used to call the SERVER's media /
 * designs / officeSlides / officeDrive APIs — the wrong source now that the
 * desktop is the home of apps: the member's files live in the desktop's
 * app-data. So every shim here is ONE relay call, `app.call { app, tool,
 * args }` (desktop: main/house-doors.ts; server: attach.py HOUSE_APPS), to
 * the first attached desktop — the machine the agent menu's opens land on.
 *
 *   · no desktop attached → `{ ok:false, notAttached:true, error }` with the
 *     connect line; the panel paints it bare as its empty state
 *     (help/house-relay.ts connectDesktopLine), never an error box.
 *   · a WRITE (new / save / delete / upload / mkdir / move) answers the one
 *     honest line — the door is read-only; changes are made on the desktop.
 *   · bytes ride as data URLs (the socket is JSON): the desktop caps a read
 *     at 8 MB and says so; the panel shows "unavailable" for that one file.
 *
 * Pure over the SDK client: web/test/house-relay-web.test.js runs it bare.
 */

import { connectDesktopLine, HOUSE_READ_ONLY_LINE, HOUSE_VIEW_OF_APP } from '../../src/renderer/help/house-relay.ts';

/** The house app that owns a media kind (media-local.ts APP_OF). */
const APP_OF_KIND = Object.freeze({ image: 'images', video: 'video', audio: 'audio' });

const msg = (e) => (e instanceof Error ? e.message : String(e));
/** How long one attach.status answer stands in for the next (wb-relay.js's own pace). */
export const HOUSE_ATTACH_TTL_MS = 30_000;

export function createHouseRelay({ client, now = () => Date.now() }) {
  // The machine the panels read: the FIRST attached desktop, cached briefly so
  // a panel's paint (several reads) asks the server once, not per card.
  let machineUntil = 0;
  let machine = null;
  const attachedMachine = async () => {
    if (now() < machineUntil) return machine;
    try {
      const st = await client?.attach?.status?.();
      const list = Array.isArray(st?.machines) ? st.machines : [];
      machine = list.length ? { id: String(list[0].id || ''), name: String(list[0].name || list[0].app || '') } : null;
    } catch { machine = null; }
    machineUntil = now() + HOUSE_ATTACH_TTL_MS;
    return machine;
  };

  /** One house read; `empty` is the list field a failed answer still carries. */
  // TWO WORLDS (his order, 2026-10-06: "how can the cloud apps be pulling
  // content from the local machine?"): a house panel on the web shows the
  // cloud's files only. There is no cloud store for the house apps yet, so
  // every read answers the honest empty line — never the desktop's files.
  const call = (view, _app, _tool, _args, empty) => async () => ({ ok: false, notAttached: true, error: connectDesktopLine(view), ...empty });
  void attachedMachine; void msg;
  const readOnly = async () => ({ ok: false, error: HOUSE_READ_ONLY_LINE });

  /** A data URL's bytes, for the video first-frame capture (wb-media.ts videoThumb). */
  const bytesOf = (url) => {
    const at = url.indexOf('base64,');
    if (at < 0) return null;
    const bin = atob(url.slice(at + 7));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const mediaRead = (app, id) => call(appView(app), app, 'read', { id }, {})();
  const mediaAppOf = (id) => APP_OF_KIND[String(id || '').split('/')[0]] || null;

  return {
    // ── Design (wb-design.ts) ─────────────────────────────────────────────
    designList: () => call('gdesign', 'design', 'list', {}, { designs: [] })(),
    designRead: (file) => call('gdesign', 'design', 'read', { name: file }, {})(),
    designAssetUrl: (file, assetId) => call('gdesign', 'design', 'asset', { name: file, id: assetId }, {})(),
    designWrite: readOnly,
    designDelete: readOnly,
    designAssetUpload: readOnly,
    designAssetDelete: readOnly,
    // ── Slides (wb-gpoint.ts) ─────────────────────────────────────────────
    gpointList: () => call('gpoint', 'slides', 'list', {}, { decks: [] })(),
    gpointRead: (file) => call('gpoint', 'slides', 'read', { name: file }, {})(),
    gpointWrite: readOnly,
    gpointDelete: readOnly,
    gpointNew: readOnly,
    // ── Images / Video / Audio (wb-media.ts) ──────────────────────────────
    // The panel asks per kind; a kind the house has no app for (the panels'
    // legacy sub-kinds "avatar", "recording", "voice") answers empty, as the
    // desktop's own media-list does.
    mediaList: async (kind, q) => {
      const app = APP_OF_KIND[String(kind || '')] || null;
      if (!app) return { ok: true, assets: [] };
      return call(appView(app), app, 'list', q ? { q } : {}, { assets: [] })();
    },
    mediaUrl: async (id) => {
      const app = mediaAppOf(id);
      if (!app) return { ok: false, error: `"${id}" is not in a house library` };
      const r = await mediaRead(app, id);
      return r.ok && r.url ? { ok: true, url: r.url } : { ok: false, error: r.error || 'no file' };
    },
    mediaThumbBytes: async (id) => {
      const app = mediaAppOf(id);
      if (!app) return { ok: false, error: `"${id}" is not in a house library` };
      const r = await mediaRead(app, id);
      const bytes = r.ok && r.url ? bytesOf(r.url) : null;
      return bytes ? { ok: true, bytes, mime: r.mime || '' } : { ok: false, error: r.error || 'no file' };
    },
    mediaDelete: readOnly,
    // GLYPHH MAKES NO MODEL CALLS (media-panel.ts says the same on the desktop):
    // the agent generates and files the result with the app's own save tool.
    mediaGenerate: async () => ({ ok: false, error: 'Ask the agent to make it — it generates and saves into this app\'s library. Glyphh itself makes no model calls.' }),
    mediaJob: async () => ({ ok: false, error: 'Generation runs in the agent, not on a server, so there is no job to poll.' }),
    mediaUploadPick: readOnly,
    mediaUploadBytes: readOnly,
    // Download: the file's bytes off the desktop, saved by the browser.
    mediaSave: async (id) => {
      const app = mediaAppOf(id);
      if (!app) return { ok: false, error: `"${id}" is not in a house library` };
      const r = await mediaRead(app, id);
      if (!r.ok || !r.url) return { ok: false, error: r.error || 'no file' };
      try {
        const a = document.createElement('a');
        a.href = r.url;
        a.download = String(id).split('/').slice(1).join('/') || 'media';
        a.click();
        return { ok: true };
      } catch (err) { return { ok: false, error: msg(err) }; }
    },
    // ── Drive (wb-drive.ts) ───────────────────────────────────────────────
    gdriveList: (q) => call('gdrive', 'drive', 'list', q ? { q } : {}, { folders: [], files: [] })(),
    gdriveMkdir: readOnly,
    gdriveMove: readOnly,
    gdriveFolderRename: readOnly,
    gdriveFolderDelete: readOnly,
  };
}

/** The view a house app's reads belong to (for the connect line). */
const appView = (app) => HOUSE_VIEW_OF_APP[app] || 'gdrive';
