/**
 * house-relay-web.test.js — the house panels' data on the web, off the
 * attached desktop (web/src/house-relay-web.js; his order, 2026-10-05: Apps →
 * Design opens the web panel, pulled through the relay). Pure over a fake SDK
 * client: one `app.call` per read to the FIRST attached machine, the connect
 * line with no desktop, the read-only line for every write, bytes as data URLs.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHouseRelay } from '../src/house-relay-web.js';
import { buildContract } from '../src/web-contract.js';
import { HOUSE_READ_ONLY_LINE } from '../../src/renderer/help/house-relay.ts';

const MAC = { id: 'm1', name: "Chris's MacBook" };
const PNG = Buffer.from('PNG!').toString('base64');

function client({ machines = [MAC], answer = async () => ({}) } = {}) {
  const dispatch = vi.fn(async (method, params, opts) => answer(method, params, opts));
  const status = vi.fn(async () => ({ attached: machines.length > 0, machines }));
  return { attach: { status, dispatch }, http: { get: async () => ({}) } };
}

describe('createHouseRelay — TWO WORLDS (his order, 2026-10-06): a house panel on the web shows the cloud\'s files only; nothing is ever read off the desktop', () => {
  it('every read answers the honest empty line, flagged, with the empty list — with a desktop attached or not, nothing is dispatched', async () => {
    for (const machines of [[MAC], []]) {
      const c = client({ machines, answer: async () => ({ designs: [{ file: 'brand.json' }] }) });
      const h = createHouseRelay({ client: c });
      expect(await h.designList()).toEqual({ ok: false, notAttached: true, error: 'No designs in the cloud yet', designs: [] });
      expect(await h.designRead('brand.json')).toMatchObject({ ok: false, notAttached: true, error: 'No designs in the cloud yet' });
      expect(await h.mediaList('image')).toEqual({ ok: false, notAttached: true, error: 'No images in the cloud yet', assets: [] });
      expect(await h.gdriveList()).toEqual({ ok: false, notAttached: true, error: 'No Drive in the cloud yet', folders: [], files: [] });
      expect(await h.gpointList()).toEqual({ ok: false, notAttached: true, error: 'No decks in the cloud yet', decks: [] });
      expect(c.attach.dispatch).not.toHaveBeenCalled();
    }
  });
  it('every write answers the read-only line — the door is reads only', async () => {
    const c = client();
    const h = createHouseRelay({ client: c });
    for (const w of [h.designWrite, h.designDelete, h.designAssetUpload, h.designAssetDelete, h.gpointWrite, h.gpointDelete, h.gpointNew, h.mediaDelete, h.mediaUploadPick, h.mediaUploadBytes, h.gdriveMkdir, h.gdriveMove, h.gdriveFolderRename, h.gdriveFolderDelete]) {
      expect(await w('x', 'y')).toEqual({ ok: false, error: HOUSE_READ_ONLY_LINE });
    }
    expect(c.attach.dispatch).not.toHaveBeenCalled();
  });
});

describe('buildContract carries the house shims — the server media / designs / office APIs are no longer the source', () => {
  it('designList, mediaList and gdriveList on the contract answer the cloud\'s empty line and never dispatch to a desktop', async () => {
    const c = client({ answer: async (_m, p) => (p.app === 'design' ? { designs: [] } : p.app === 'drive' ? { folders: [], files: [] } : { assets: [] }) });
    const k = buildContract(c, { apiUrl: 'https://api.test', isAuthenticated: () => true, signOut: () => {} });
    for (const name of ['designList', 'designRead', 'designAssetUrl', 'gpointList', 'gpointRead', 'mediaList', 'mediaUrl', 'mediaThumbBytes', 'mediaSave', 'gdriveList']) expect(typeof k[name]).toBe('function');
    expect(await k.designList()).toEqual({ ok: false, notAttached: true, error: 'No designs in the cloud yet', designs: [] });
    expect(await k.mediaList('image')).toEqual({ ok: false, notAttached: true, error: 'No images in the cloud yet', assets: [] });
    expect(await k.gdriveList()).toEqual({ ok: false, notAttached: true, error: 'No Drive in the cloud yet', folders: [], files: [] });
    expect(c.attach.dispatch).not.toHaveBeenCalled();
  });

  it('desktopAppsList carries a house row\'s tool so the menu opens the web panel', async () => {
    const rows = [
      { id: 'design', slug: 'design', name: 'Design', system: false, url: null, execPath: '/x/app.json', appArchetype: 'glyphh-app', isBrowser: false, launchConfig: { tool: 'gdesign' } },
      { id: 'crm', slug: 'crm', name: 'CRM', system: false, url: null, execPath: '/y/app.json', appArchetype: 'glyphh-app', isBrowser: false, launchConfig: {} },
    ];
    const c = client({ answer: async (m) => (m === 'panelApps.list' ? { apps: rows } : {}) });
    const k = buildContract(c, { apiUrl: 'https://api.test', isAuthenticated: () => true, signOut: () => {} });
    const r = await k.desktopAppsList();
    expect(r.ok).toBe(true);
    expect(r.apps.map((a) => [a.slug, a.tool])).toEqual([['design', 'gdesign'], ['crm', undefined]]);
  });
});
