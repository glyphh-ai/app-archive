/**
 * house-store-web.test.js — the house panels' data on the web
 * (web/src/house-store-web.js; his order, 2026-10-06: cloud is the one
 * home). Over the fake member library and a fake server byte lane: the
 * shims are the shared store's doors, a write lands on the server for the
 * desktop to read, bytes ride the server lane with the bearer, and the
 * browser's own parts — the picker and the download — do their bit.
 */
import { webcrypto } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { createHouseStoreWeb } from '../src/house-store-web.js';
import { fakeLibrary } from './helpers/member-library.js';

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

/** The server's byte lane: PUTs land in `stored`, GETs serve them; a bearer or 401. */
function fakeLane() {
  const stored = new Map();
  const fetchImpl = vi.fn(async (url, init = {}) => {
    const m = /^https:\/\/api\/api\/library\/v2\/([^/]+)\/([^/]+)\/files\/(.+)$/.exec(url);
    if (!m) return { ok: false, status: 400, arrayBuffer: async () => new ArrayBuffer(0) };
    if (!/^Bearer tok$/.test(init.headers?.authorization || '')) return { ok: false, status: 401, arrayBuffer: async () => new ArrayBuffer(0) };
    const key = `${m[1]}/${decodeURIComponent(m[2])}/${decodeURIComponent(m[3])}`;
    if (init.method === 'PUT') { stored.set(key, { bytes: init.body, mime: init.headers['content-type'] }); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }; }
    const hit = stored.get(key);
    if (!hit) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => hit.bytes.buffer.slice(hit.bytes.byteOffset, hit.bytes.byteOffset + hit.bytes.byteLength) };
  });
  return { stored, fetchImpl };
}

function rig({ seed = {}, file = null } = {}) {
  const memberLibrary = fakeLibrary(seed);
  const lane = fakeLane();
  const clicks = [];
  const doc = {
    createElement: (tag) => {
      const el = { tag, listeners: {}, addEventListener(ev, fn) { this.listeners[ev] = fn; }, click() { clicks.push(this); if (tag === 'input') { this.files = file ? [file] : []; this.listeners[file ? 'change' : 'cancel'](); } } };
      return el;
    },
  };
  let t = 10_000;
  const client = { memberLibrary, token: async () => 'tok' };
  const house = createHouseStoreWeb({ client, apiUrl: 'https://api', fetchImpl: lane.fetchImpl, now: () => ++t, document: doc });
  return { house, memberLibrary, lane, clicks };
}

describe('createHouseStoreWeb — the member library is the store, reads and writes alike', () => {

  it('upload is the browser picker into the library; the url a card plays is the presigned GET; download is a Blob the browser saves', async () => {
    const png = new Uint8Array([1, 2, 3]);
    const file = { name: 'Sunset beach.png', type: 'image/png', arrayBuffer: async () => png.buffer };
    const { house, lane, clicks } = rig({ file });
    expect(await house.mediaUploadPick('image')).toEqual({ ok: true, id: 'image/Sunset-beach.png', kind: 'image', title: 'Sunset-beach' });
    expect(lane.stored.get('image/Sunset-beach.png/Sunset-beach.png')).toEqual({ bytes: png, mime: 'image/png' });
    const l = await house.mediaList('image');
    expect(l.assets.map((a) => [a.id, a.mime, a.sizeBytes])).toEqual([['image/Sunset-beach.png', 'image/png', 3]]);
    expect(await house.mediaUrl('image/Sunset-beach.png')).toEqual({ ok: true, url: 'https://r2/get/image/Sunset-beach.png/Sunset-beach.png' });
    expect(await house.mediaThumbBytes('image/Sunset-beach.png')).toEqual({ ok: true, bytes: png, mime: 'image/png' });
    const urls = [];
    globalThis.URL.createObjectURL = (b) => { urls.push(b); return 'blob:x'; };
    globalThis.URL.revokeObjectURL = () => {};
    globalThis.Blob = class { constructor(parts, opts) { this.parts = parts; this.type = opts.type; } };
    expect(await house.mediaSave('image/Sunset-beach.png')).toEqual({ ok: true, path: 'Sunset-beach.png' });
    expect(urls[0].type).toBe('image/png');
    expect(clicks.at(-1)).toMatchObject({ tag: 'a', href: 'blob:x', download: 'Sunset-beach.png' });
    expect(await house.mediaDelete('image/Sunset-beach.png')).toEqual({ ok: true });
    expect((await house.mediaList('image')).assets).toEqual([]);
  });

  it('a cancelled pick says so; the legacy sub-kinds answer empty; generation stays the agent\'s', async () => {
    const { house } = rig();
    expect(await house.mediaUploadPick('image')).toEqual({ ok: false, error: 'cancelled' });
    expect(await house.mediaList('avatar')).toEqual({ ok: true, assets: [] });
    expect((await house.mediaGenerate({})).ok).toBe(false);
    expect((await house.mediaJob('j')).ok).toBe(false);
  });
});
