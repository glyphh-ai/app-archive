/**
 * member-library-web.test.js — the web's member library (member-library-web.js):
 * reads the server first, writes the server at this client's clock, and moves a
 * skill's files through the presigned URLs. Pure over the fake SDK + a fake fetch.
 */
import { describe, it, expect, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { buildMemberLibrary, NEEDS_DESKTOP } from '../src/member-library-web.js';
import { fakeLibrary, seededLibrary } from './helpers/member-library.js';

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;

const SKILL_MD = '---\nname: notes\ndescription: Keep notes\nauthor: me\n---\n\n# notes\n\nWrite things down.\n';
const skillSeed = () => fakeLibrary({
  skill: [{ id: 'notes', updatedAt: 5_000, data: { name: 'notes', description: 'Keep notes', frontmatter: { name: 'notes', description: 'Keep notes', author: 'me' }, body: '# notes\n', enabled: true, type: 'skill' },
    files: [{ path: 'SKILL.md', size: SKILL_MD.length, mtime: 5_000, sha256: 'abc' }, { path: 'scripts/run.sh', size: 3, mtime: 5_000, sha256: 'def' }] }],
  task: [{ id: 'digest', updatedAt: 6_000, data: { name: 'digest', description: 'Daily digest', frontmatter: {}, body: '', enabled: false, type: 'task', manifest: { name: 'digest', program: 'run.js', slots: { main: { label: 'Main', agent: null } }, schedule: '0 9 * * *', dependencies: { connections: [{ app: 'gmail', as: 'me' }] } } },
    files: [{ path: 'SKILL.md', size: 10, mtime: 6_000, sha256: 'x' }, { path: 'task.json', size: 10, mtime: 6_000, sha256: 'y' }, { path: 'run.js', size: 10, mtime: 6_000, sha256: 'z' }] }],
});

/** A fake R2: PUTs land in `stored`, GETs serve it (or the seed text). */
function fakeR2(seedText = {}) {
  const stored = new Map(Object.entries(seedText));
  const fetchImpl = vi.fn(async (url, init = {}) => {
    const m = /^https:\/\/r2\/(put|get)\/[^/]+\/[^/]+\/(.+)$/.exec(url);
    if (!m) return { ok: false, status: 400, arrayBuffer: async () => new ArrayBuffer(0) };
    if (m[1] === 'put') { stored.set(m[2], new TextDecoder().decode(init.body)); return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }; }
    const text = stored.get(m[2]);
    if (text === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
  });
  return { stored, fetchImpl };
}

describe('skills and tasks on web — list and view from the server', () => {
  it('skillsList answers the Skills page rows for the kinds the server holds, none for the machine kinds', async () => {
    const lib = buildMemberLibrary({ memberLibrary: skillSeed() });
    const r = await lib.skillsList(['skill', 'app', 'task', 'plugin']);
    expect(r.ok).toBe(true);
    expect(r.data.map((x) => x.id)).toEqual(['task:digest', 'glyphh:notes']); // newest first
    expect(r.data[1]).toMatchObject({ source: 'glyphh', type: 'skill', name: 'notes', description: 'Keep notes', author: 'me', enabled: true, updatedAt: new Date(5_000).toISOString() });
    expect(r.data[0]).toMatchObject({ source: 'task', type: 'task', enabled: false });
    expect((await lib.skillsList('app')).data).toEqual([]);
  });

  it('skillGet is the detail (frontmatter, body, the file manifest) without a download', async () => {
    const api = skillSeed();
    const lib = buildMemberLibrary({ memberLibrary: api });
    const r = await lib.skillGet('glyphh:notes');
    expect(r).toMatchObject({ ok: true, data: { id: 'glyphh:notes', frontmatter: { author: 'me' }, body: '# notes\n', files: [{ path: 'SKILL.md' }, { path: 'scripts/run.sh' }], fileCount: 2 } });
    expect(await lib.skillGet('claude:other')).toMatchObject({ ok: false, error: /not a library skill/ });
    expect(api.files).not.toHaveBeenCalled();
  });

  it('tasksSpecs / taskSpec project the task.json the record carries', async () => {
    const lib = buildMemberLibrary({ memberLibrary: skillSeed() });
    const r = await lib.tasksSpecs();
    expect(r.data).toEqual([{ slug: 'digest', name: 'digest', description: 'Daily digest', program: 'run.js', icon: null, slots: [{ name: 'main', label: 'Main', agent: null }], connections: ['gmail'], schedule: '0 9 * * *', enabled: false, dir: '' }]);
    expect((await lib.taskSpec('digest')).data.slug).toBe('digest');
    expect(await lib.taskSpec('nope')).toMatchObject({ ok: false });
  });
});

describe('skills on web — files through the presigned URLs, the record re-put', () => {
  it('skillFileRead downloads the one file from its GET url', async () => {
    const { fetchImpl } = fakeR2({ 'scripts/run.sh': '#!/bin/sh\necho hi\n' });
    const lib = buildMemberLibrary({ memberLibrary: skillSeed() }, { fetchImpl });
    expect(await lib.skillFileRead('glyphh:notes', 'scripts/run.sh')).toEqual({ ok: true, data: { text: '#!/bin/sh\necho hi\n', binary: false, size: 18 } });
    expect(fetchImpl).toHaveBeenCalledWith('https://r2/get/skill/notes/scripts/run.sh');
    expect(await lib.skillFileRead('glyphh:notes', 'missing.txt')).toMatchObject({ ok: false, error: /no file/ });
  });

  it('skillFileWrite uploads to the PUT url and re-puts the record with the new manifest (SKILL.md re-derives the data)', async () => {
    const api = skillSeed();
    const { stored, fetchImpl } = fakeR2();
    const lib = buildMemberLibrary({ memberLibrary: api }, { fetchImpl, now: () => 9_000 });
    const md = '---\nname: notes\ndescription: Keep BETTER notes\n---\n\nBody.\n';
    expect(await lib.skillFileWrite('glyphh:notes', 'SKILL.md', md)).toEqual({ ok: true, data: true });
    expect(stored.get('SKILL.md')).toBe(md);
    const put = api.put.mock.calls.at(-1);
    expect(put[0]).toBe('skill'); expect(put[1]).toBe('notes'); expect(put[2].updatedAt).toBe(9_000);
    expect(put[2].data).toMatchObject({ description: 'Keep BETTER notes', body: '\nBody.\n', enabled: true, type: 'skill' }); // the body keeps its leading blank line, as skills-fs reads it
    const entry = put[2].files.find((f) => f.path === 'SKILL.md');
    expect(entry).toMatchObject({ size: new TextEncoder().encode(md).length, mtime: 9_000 });
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(put[2].files.find((f) => f.path === 'scripts/run.sh')).toMatchObject({ sha256: 'def' }); // untouched files keep their manifest entry
    // The put happened BEFORE the upload: a stale clock never uploads bytes nobody indexed.
    const putAt = api.put.mock.invocationCallOrder.at(-1);
    const uploadAt = fetchImpl.mock.invocationCallOrder.find((_, i) => fetchImpl.mock.calls[i][1]?.method === 'PUT');
    expect(putAt).toBeLessThan(uploadAt);
  });

  it('a stale clock is said, not silently lost', async () => {
    const api = skillSeed();
    const lib = buildMemberLibrary({ memberLibrary: api }, { fetchImpl: fakeR2().fetchImpl, now: () => 1 });
    expect(await lib.skillFileWrite('glyphh:notes', 'SKILL.md', 'x')).toMatchObject({ ok: false, error: /newer copy/ });
  });

  it('skillCreate makes the standard folder (a task gets its task.json, run.js and package.json) and uploads every file', async () => {
    const api = fakeLibrary();
    const { stored, fetchImpl } = fakeR2();
    const lib = buildMemberLibrary({ memberLibrary: api }, { fetchImpl });
    const r = await lib.skillCreate('My Task!', 'task');
    expect(r).toMatchObject({ ok: true, data: { id: 'task:my-task', type: 'task', fileCount: 4 } });
    expect([...stored.keys()].sort()).toEqual(['SKILL.md', 'package.json', 'run.js', 'task.json']);
    expect(JSON.parse(stored.get('task.json'))).toMatchObject({ name: 'my-task', program: 'run.js' });
    expect(api.rows.get('task:my-task').data).toMatchObject({ type: 'task', enabled: true, manifest: { name: 'my-task' } });
    expect(await lib.skillCreate('My Task!', 'task')).toMatchObject({ ok: false, error: /already exists/ });
    expect(await lib.skillCreate('x', 'plugin')).toEqual({ ok: false, error: NEEDS_DESKTOP });
  });

  it('skillSetEnabled and skillDelete write the server; the machine actions answer so', async () => {
    const api = skillSeed();
    const lib = buildMemberLibrary({ memberLibrary: api }, { now: () => 10_000 });
    expect(await lib.skillSetEnabled('task:digest', true)).toMatchObject({ ok: true, data: { enabled: true } });
    expect(api.rows.get('task:digest').data.enabled).toBe(true);
    expect(await lib.skillDelete('glyphh:notes')).toEqual({ ok: true, data: true });
    expect(api.rows.get('skill:notes').deletedAt).toBeTruthy();
    expect(await lib.skillDelete('glyphh:notes')).toEqual({ ok: true, data: true }); // already gone = done
    for (const name of ['skillReveal', 'skillImport', 'skillReplace', 'skillDownload', 'skillAdopt', 'skillTab']) {
      expect(await lib[name]('glyphh:x')).toEqual({ ok: false, error: NEEDS_DESKTOP });
    }
    expect(await lib.skillAgents('glyphh:x')).toEqual({ ok: true, data: [] });
  });

  it('taskSlotSet rewrites task.json through the same file lane', async () => {
    const api = skillSeed();
    const { stored } = fakeR2();
    const lib = buildMemberLibrary({ memberLibrary: api }, { fetchImpl: fakeR2().fetchImpl, now: () => 11_000 });
    const r = await lib.taskSlotSet('digest', 'main', 'ada');
    expect(r).toMatchObject({ ok: true, data: { slots: [{ name: 'main', agent: 'ada' }] } });
    expect(api.rows.get('task:digest').data.manifest.slots.main.agent).toBe('ada');
    void stored;
  });
});

describe('agents on web — the member library record', () => {
  it('create builds the desktop\'s row shape and puts it; update keeps what the patch does not name; delete tombstones', async () => {
    const api = seededLibrary();
    const lib = buildMemberLibrary({ memberLibrary: api }, { now: () => 2_000 });
    const made = await lib.libraryAgentCreate({ name: 'Scout', prompt: 'Look around', skills: ['notes'] });
    expect(made).toMatchObject({ ok: true, data: { id: 'scout', slug: 'scout', name: 'Scout', prompt: 'Look around', skills: ['notes'], apps: [], live: true, guardrails: null, updatedAt: new Date(2_000).toISOString() } });
    expect(api.rows.get('agent:scout').updatedAt).toBe(2_000);
    expect(await lib.libraryAgentUpdate('scout', { live: false })).toMatchObject({ ok: true, data: { name: 'Scout', prompt: 'Look around', live: false } });
    expect(await lib.libraryAgentGet('scout')).toMatchObject({ ok: true, data: { live: false } });
    expect((await lib.libraryAgentsList()).data.map((a) => a.slug)).toEqual(['a', 'scout']);
    expect(await lib.libraryAgentDelete('scout')).toEqual({ ok: true, data: true });
    expect((await lib.libraryAgentsList()).data.map((a) => a.slug)).toEqual(['a']);
    expect(await lib.libraryAgentGet('scout')).toMatchObject({ ok: false });
    expect(await lib.libraryAgentCreate({})).toMatchObject({ ok: false, error: /needs a name/ });
  });
});

describe('drips on web — the member library record (2026-10-04: a preset is a db row with cloud storage)', () => {
  it('dripsList reads the server; dripsSave puts `{ name, recipe }` under the lowercased name; dripsDelete tombstones', async () => {
    const api = fakeLibrary({ drip: [{ id: 'party', updatedAt: 1_000, data: { name: 'party', recipe: '3 confetti fireworks' } }, { id: 'junk', updatedAt: 1_000, data: 'not a drip' }] });
    const lib = buildMemberLibrary({ memberLibrary: api }, { now: () => 5_000 });
    expect(await lib.dripsList()).toEqual([{ name: 'party', recipe: '3 confetti fireworks' }]);
    expect(await lib.dripsSave('  Aurora ', '-1  0.5 aurora')).toBe('saved drip "aurora" → -1 0.5 aurora');
    expect(api.put).toHaveBeenCalledWith('drip', 'aurora', { data: { name: 'aurora', recipe: '-1 0.5 aurora' }, updatedAt: 5_000 });
    expect((await lib.dripsList()).map((d) => d.name).sort()).toEqual(['aurora', 'party']);
    expect(await lib.dripsSave('', 'x')).toMatch(/needs a name/);
    expect(await lib.dripsSave('empty', '   ')).toMatch(/at least one effect/);
    expect(await lib.dripsDelete('Party')).toBe('deleted drip "party"');
    expect(api.remove).toHaveBeenCalledWith('drip', 'party', { updatedAt: 5_001 });
    expect(await lib.dripsList()).toEqual([{ name: 'aurora', recipe: '-1 0.5 aurora' }]);
    expect(await lib.dripsDelete('party')).toBe('no custom drip "party"');
  });

  it('a stale save is said in the status string, as the desktop manager would', async () => {
    const api = fakeLibrary({ drip: [{ id: 'party', updatedAt: 9_000, data: { name: 'party', recipe: 'confetti' } }] });
    const lib = buildMemberLibrary({ memberLibrary: api }, { now: () => 5_000 });
    expect(await lib.dripsSave('party', 'hearts')).toMatch(/^failed to save drip "party": .*newer copy/);
  });
});

describe('schedules on web — the record, with the runs left to the desktop clock', () => {
  const seed = () => fakeLibrary({
    schedule: [{ id: 's1', updatedAt: 1_000, data: { name: 'Digest', cron: '0 9 * * 1-5', kind: 'task', target: 'digest', agentId: null, ownerAgentId: null, args: { n: 1 }, enabled: true } },
      { id: 's2', updatedAt: 2_000, data: { name: 'Brief', cron: '30 8 * * *', kind: 'skill', target: 'brief', agentId: 'a', ownerAgentId: null, args: {}, enabled: false } }],
    agent: [{ id: 'a', updatedAt: 1_000, data: { id: 'a', slug: 'a', name: 'Ada', description: '', prompt: '', provider: '', model: '', skills: [], apps: [], live: true, guardrails: null, createdAt: '', updatedAt: '2026-10-01T00:00:00.000Z' } }],
  });

  it('schedulesList is the Schedules page shape: the agent named off the agent records, the run columns null', async () => {
    const lib = buildMemberLibrary({ memberLibrary: seed() });
    const r = await lib.schedulesList();
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([
      { id: 's2', name: 'Brief', kind: 'skill', target: 'brief', cron: '30 8 * * *', enabled: false, agentId: 'a', agentName: 'Ada', ownerAgentId: null, args: '{}', createdAt: new Date(2_000).toISOString(), updatedAt: 2_000, lastRunAt: null, lastStatus: null, lastError: null },
      { id: 's1', name: 'Digest', kind: 'task', target: 'digest', cron: '0 9 * * 1-5', enabled: true, agentId: null, agentName: null, ownerAgentId: null, args: '{"n":1}', createdAt: new Date(1_000).toISOString(), updatedAt: 1_000, lastRunAt: null, lastStatus: null, lastError: null },
    ]);
    expect(await lib.scheduleRuns('s1')).toEqual({ ok: true, data: [] });
    expect(await lib.scheduleRecentRuns()).toEqual({ ok: true, data: [] });
    expect(await lib.scheduleRunNow('s1')).toEqual({ ok: false, error: NEEDS_DESKTOP });
  });

  it('scheduleSave puts a new record (its own id) or rewrites one; a bad cron, a missing target or a skill without an agent is refused before any put', async () => {
    const api = seed();
    const lib = buildMemberLibrary({ memberLibrary: api }, { now: () => 7_000 });
    const made = await lib.scheduleSave({ name: 'Nightly', kind: 'task', target: 'backup', cron: '0 2 * * *', args: { deep: true } });
    expect(made).toMatchObject({ ok: true, data: { id: expect.any(String) } });
    const put = api.put.mock.calls.at(-1);
    expect(put[0]).toBe('schedule');
    expect(put[2]).toEqual({ data: { name: 'Nightly', cron: '0 2 * * *', kind: 'task', target: 'backup', agentId: null, ownerAgentId: null, args: { deep: true }, enabled: true }, updatedAt: 7_000 });
    // An edit keeps what the patch does not name (the args, the owner).
    expect(await lib.scheduleSave({ id: 's1', kind: 'task', target: 'digest', cron: '15 9 * * 1-5', enabled: false })).toEqual({ ok: true, data: { id: 's1' } });
    expect(api.put.mock.calls.at(-1)[2]).toEqual({ data: { name: 'Digest', cron: '15 9 * * 1-5', kind: 'task', target: 'digest', agentId: null, ownerAgentId: null, args: { n: 1 }, enabled: false }, updatedAt: 7_001 });
    const puts = api.put.mock.calls.length;
    expect(await lib.scheduleSave({ kind: 'task', target: 'x', cron: 'every tuesday' })).toMatchObject({ ok: false, error: /cron/ });
    expect(await lib.scheduleSave({ kind: 'task', target: '', cron: '0 9 * * *' })).toMatchObject({ ok: false, error: /something to run/ });
    expect(await lib.scheduleSave({ kind: 'skill', target: 'brief', cron: '0 9 * * *' })).toMatchObject({ ok: false, error: /agent/ });
    expect(await lib.scheduleSave({ id: 'nope', kind: 'task', target: 'x', cron: '0 9 * * *' })).toMatchObject({ ok: false, error: /not found/ });
    expect(api.put.mock.calls.length).toBe(puts);
  });

  it('scheduleSetEnabled re-puts the record with the flag; scheduleDelete tombstones at this clock; a stale write is said', async () => {
    const api = seed();
    const lib = buildMemberLibrary({ memberLibrary: api }, { now: () => 7_000 });
    expect(await lib.scheduleSetEnabled('s2', true)).toEqual({ ok: true, data: { updated: true } });
    expect(api.put.mock.calls.at(-1)[2]).toMatchObject({ data: { name: 'Brief', enabled: true, agentId: 'a' }, updatedAt: 7_000 });
    expect(await lib.scheduleSetEnabled('ghost', true)).toEqual({ ok: true, data: { updated: false } });
    expect(await lib.scheduleDelete('s1')).toEqual({ ok: true, data: { deleted: true } });
    expect(api.remove).toHaveBeenCalledWith('schedule', 's1', { updatedAt: 7_001 });
    expect((await lib.schedulesList()).data.map((s) => s.id)).toEqual(['s2']);
    expect(await lib.scheduleDelete('s1')).toEqual({ ok: true, data: { deleted: true } });   // already gone: fine
    const stale = buildMemberLibrary({ memberLibrary: seed() }, { now: () => 500 });
    expect(await stale.scheduleSetEnabled('s2', true)).toMatchObject({ ok: false, error: /newer copy/ });
  });
});
