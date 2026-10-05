/**
 * house-relay-web.test.js — the house panels' data on the web, off the
 * attached desktop (web/src/house-relay-web.js; his order, 2026-10-05: Apps →
 * Design opens the web panel, pulled through the relay). Pure over a fake SDK
 * client: one `app.call` per read to the FIRST attached machine, the connect
 * line with no desktop, the read-only line for every write, bytes as data URLs.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHouseRelay, HOUSE_ATTACH_TTL_MS } from '../src/house-relay-web.js';
import { buildContract } from '../src/web-contract.js';
import { HOUSE_READ_ONLY_LINE } from '../../src/renderer/help/house-relay.ts';

const MAC = { id: 'm1', name: "Chris's MacBook" };
const PNG = Buffer.from('PNG!').toString('base64');

function client({ machines = [MAC], answer = async () => ({}) } = {}) {
  const dispatch = vi.fn(async (method, params, opts) => answer(method, params, opts));
  const status = vi.fn(async () => ({ attached: machines.length > 0, machines }));
  return { attach: { status, dispatch }, http: { get: async () => ({}) } };
}

describe('createHouseRelay — reads ride app.call to the first attached desktop', () => {
  it('designList / designRead / designAssetUrl', async () => {
    const c = client({ answer: async (_m, p) => (p.tool === 'list' ? { designs: [{ file: 'brand.json', title: 'Brand', size: 1, mtime: 2 }] } : p.tool === 'read' ? { title: 'Brand', document: { name: 'Brand' } } : { url: 'data:image/svg+xml;base64,PHN2Zy8+' }) });
    const h = createHouseRelay({ client: c });
    expect(await h.designList()).toEqual({ ok: true, designs: [{ file: 'brand.json', title: 'Brand', size: 1, mtime: 2 }] });
    expect(await h.designRead('brand.json')).toEqual({ ok: true, title: 'Brand', document: { name: 'Brand' } });
    expect(await h.designAssetUrl('brand.json', 'logo')).toEqual({ ok: true, url: 'data:image/svg+xml;base64,PHN2Zy8+' });
    expect(c.attach.dispatch.mock.calls).toEqual([
      ['app.call', { app: 'design', tool: 'list', args: {} }, { machineId: 'm1' }],
      ['app.call', { app: 'design', tool: 'read', args: { name: 'brand.json' } }, { machineId: 'm1' }],
      ['app.call', { app: 'design', tool: 'asset', args: { name: 'brand.json', id: 'logo' } }, { machineId: 'm1' }],
    ]);
    // One attach.status for the three reads — the machine is cached.
    expect(c.attach.status).toHaveBeenCalledTimes(1);
  });

  it('mediaList asks the app that owns the kind; a legacy sub-kind answers empty without a call', async () => {
    const c = client({ answer: async () => ({ assets: [{ id: 'image/sunset.png', kind: 'image', status: 'ready' }] }) });
    const h = createHouseRelay({ client: c });
    expect(await h.mediaList('image', 'sun')).toEqual({ ok: true, assets: [{ id: 'image/sunset.png', kind: 'image', status: 'ready' }] });
    expect(await h.mediaList('avatar')).toEqual({ ok: true, assets: [] });
    expect(await h.mediaList('video')).toEqual({ ok: true, assets: [{ id: 'image/sunset.png', kind: 'image', status: 'ready' }] });
    expect(c.attach.dispatch.mock.calls.map(([, p]) => [p.app, p.args])).toEqual([['images', { q: 'sun' }], ['video', {}]]);
  });

  it('mediaUrl / mediaThumbBytes read the file as a data URL off the owning app; a foreign id never dispatches', async () => {
    const c = client({ answer: async () => ({ url: `data:image/png;base64,${PNG}`, mime: 'image/png', sizeBytes: 4 }) });
    const h = createHouseRelay({ client: c });
    expect(await h.mediaUrl('image/sunset.png')).toEqual({ ok: true, url: `data:image/png;base64,${PNG}` });
    const t = await h.mediaThumbBytes('image/sunset.png');
    expect(t.ok).toBe(true);
    expect(Array.from(t.bytes)).toEqual([80, 78, 71, 33]);
    expect(t.mime).toBe('image/png');
    expect(await h.mediaUrl('nope/x.png')).toMatchObject({ ok: false });
    expect(c.attach.dispatch.mock.calls.map(([, p]) => [p.app, p.tool, p.args.id])).toEqual([['images', 'read', 'image/sunset.png'], ['images', 'read', 'image/sunset.png']]);
  });

  it('a desktop that refuses (the 8 MB cap) answers its line, not a throw', async () => {
    const c = client({ answer: async () => { throw new Error('too large to show on the web (over 8 MB) — open it on your desktop'); } });
    const h = createHouseRelay({ client: c });
    expect(await h.mediaUrl('video/big.mp4')).toEqual({ ok: false, error: 'too large to show on the web (over 8 MB) — open it on your desktop' });
    expect(await h.designList()).toEqual({ ok: false, error: 'too large to show on the web (over 8 MB) — open it on your desktop', designs: [] });
  });

  it('gdriveList / gpointList / gpointRead', async () => {
    const c = client({ answer: async (_m, p) => (p.app === 'drive' ? { folders: [{ id: 'f' }], files: [] } : p.tool === 'list' ? { decks: [{ file: 'q3.html' }] } : { content: '<html/>' }) });
    const h = createHouseRelay({ client: c });
    expect(await h.gdriveList('q')).toEqual({ ok: true, folders: [{ id: 'f' }], files: [] });
    expect(await h.gpointList()).toEqual({ ok: true, decks: [{ file: 'q3.html' }] });
    expect(await h.gpointRead('q3')).toEqual({ ok: true, content: '<html/>' });
    expect(c.attach.dispatch.mock.calls.map(([, p]) => [p.app, p.tool, p.args])).toEqual([['drive', 'list', { q: 'q' }], ['slides', 'list', {}], ['slides', 'read', { name: 'q3' }]]);
  });

  it('NO DESKTOP ATTACHED: the connect line, flagged, with the empty list — nothing dispatched', async () => {
    const c = client({ machines: [] });
    const h = createHouseRelay({ client: c });
    expect(await h.designList()).toEqual({ ok: false, notAttached: true, error: 'Connect your desktop to see your designs', designs: [] });
    expect(await h.mediaList('image')).toEqual({ ok: false, notAttached: true, error: 'Connect your desktop to see your images', assets: [] });
    expect(await h.gdriveList()).toEqual({ ok: false, notAttached: true, error: 'Connect your desktop to see your Drive', folders: [], files: [] });
    expect(await h.gpointList()).toEqual({ ok: false, notAttached: true, error: 'Connect your desktop to see your decks', decks: [] });
    expect(c.attach.dispatch).not.toHaveBeenCalled();
  });

  it('a status that throws (logged out, offline) reads as not attached', async () => {
    const c = client();
    c.attach.status = vi.fn(async () => { throw new Error('401'); });
    expect(await createHouseRelay({ client: c }).designList()).toMatchObject({ ok: false, notAttached: true });
  });

  it('the attached machine is re-read after the TTL', async () => {
    let t = 0;
    const c = client();
    const h = createHouseRelay({ client: c, now: () => t });
    await h.designList(); await h.designList();
    expect(c.attach.status).toHaveBeenCalledTimes(1);
    t = HOUSE_ATTACH_TTL_MS + 1;
    await h.designList();
    expect(c.attach.status).toHaveBeenCalledTimes(2);
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
  it('designList, mediaList and gdriveList on the contract ride app.call', async () => {
    const c = client({ answer: async (_m, p) => (p.app === 'design' ? { designs: [] } : p.app === 'drive' ? { folders: [], files: [] } : { assets: [] }) });
    const k = buildContract(c, { apiUrl: 'https://api.test', isAuthenticated: () => true, signOut: () => {} });
    for (const name of ['designList', 'designRead', 'designAssetUrl', 'gpointList', 'gpointRead', 'mediaList', 'mediaUrl', 'mediaThumbBytes', 'mediaSave', 'gdriveList']) expect(typeof k[name]).toBe('function');
    expect(await k.designList()).toEqual({ ok: true, designs: [] });
    expect(await k.mediaList('image')).toEqual({ ok: true, assets: [] });
    expect(await k.gdriveList()).toEqual({ ok: true, folders: [], files: [] });
    expect(c.attach.dispatch.mock.calls.map(([m]) => m)).toEqual(['app.call', 'app.call', 'app.call']);
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
