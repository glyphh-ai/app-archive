import { describe, it, expect } from 'vitest';
import {
  cloudSource, cloudSendBlock, picksOf, isCloudKind, cloudLabel, envChipLabel, repoChipLabel, folderChipLabel,
  toggleRepo, setBranch, groupRepos, splitRepo, mergeThreads, sessionSubline, sessionMark, toStoredMessages, defaultLocus,
} from '../src/mobile-cloud.ts';

// The phone's cloud lane (his direction, 2026-10-05): the web's labels and
// the web's locus rule, a GitHub repo as the hard limit on a cloud session.
const ada = { id: '1', fullName: 'glyphh-ai/ada', private: true, defaultBranch: 'main' };
const server = { id: '2', fullName: 'glyphh-ai/server', private: true, defaultBranch: 'glyphh-main' };
const other = { id: '3', fullName: 'acme/widgets', private: false, defaultBranch: 'master' };

describe('the cloud source', () => {
  it('is born from the picks — the FIRST pick is the repo the worker checks out, the rest ride along', () => {
    const picks = [{ repo: 'glyphh-ai/ada', branch: 'main' }, { repo: 'glyphh-ai/server', branch: 'glyphh-main' }];
    expect(cloudSource(picks)).toEqual({ kind: 'cloud-repo', repo: 'glyphh-ai/ada', branch: 'main', repos: picks });
  });
  it('is never born without a repo (GitHub is the hard limit)', () => {
    expect(cloudSource([])).toBeNull();
    expect(cloudSendBlock(false, [])).toBe('Connect GitHub to start a cloud session');
    expect(cloudSendBlock(true, [])).toBe('Choose a repository');
    expect(cloudSendBlock(true, [{ repo: 'glyphh-ai/ada', branch: 'main' }])).toBe('');
  });
  it('reads its picks back from the record, old shape included', () => {
    expect(picksOf({ kind: 'cloud-repo', repo: 'glyphh-ai/ada', branch: 'main', repos: [{ repo: 'glyphh-ai/ada', branch: 'main' }] })).toEqual([{ repo: 'glyphh-ai/ada', branch: 'main' }]);
    expect(picksOf({ kind: 'cloud-repo', repo: 'glyphh-ai/ada' })).toEqual([{ repo: 'glyphh-ai/ada', branch: '' }]);
    expect(picksOf(null)).toEqual([]);
    expect(picksOf({ kind: 'local', path: '/x' })).toEqual([]);
  });
  it('knows every cloud kind the web mints', () => {
    expect(isCloudKind('cloud-repo')).toBe(true);
    expect(isCloudKind('cloud-new')).toBe(true);
    expect(isCloudKind('cloud-space')).toBe(true);
    expect(isCloudKind('local')).toBe(false);
    expect(isCloudKind(undefined)).toBe(false);
  });
});

describe('labels', () => {
  it("wears the web's `Cloud · <repo>` (the last segment, code-source-chip.ts sourceLabel)", () => {
    expect(cloudLabel({ kind: 'cloud-repo', repo: 'glyphh-ai/ada' })).toBe('Cloud · ada');
    expect(cloudLabel({ kind: 'cloud-space', label: 'space 1' })).toBe('Cloud · space 1');
    expect(cloudLabel({ kind: 'cloud-new' })).toBe('Cloud');
    expect(cloudLabel(null)).toBe('Cloud');
  });
  it('names the environment chip Default in the cloud, the machine on a desktop', () => {
    expect(envChipLabel('cloud')).toBe('Default');
    expect(envChipLabel('local', 'Christophers-Mac-Studio')).toBe('Christophers-Mac-Studio');
    expect(envChipLabel('local')).toBe('Desktop');
  });
  it('counts repos and branches on the repo chip; Connect GitHub until linked', () => {
    expect(repoChipLabel([], false)).toBe('Connect GitHub');
    expect(repoChipLabel([], true)).toBe('Choose repositories');
    expect(repoChipLabel([{ repo: 'a/b', branch: 'main' }], true)).toBe('1 repo · 1 branch');
    expect(repoChipLabel([{ repo: 'a/b', branch: 'main' }, { repo: 'a/c', branch: 'dev' }], true)).toBe('2 repos · 2 branches');
    expect(folderChipLabel('/Users/x/development/yo')).toBe('yo');
    expect(folderChipLabel('')).toBe('Choose folder');
  });
});

describe('the repositories sheet', () => {
  it('toggles a pick, taking the default branch; order of picking is kept', () => {
    let picks = toggleRepo([], server);
    picks = toggleRepo(picks, ada);
    expect(picks).toEqual([{ repo: 'glyphh-ai/server', branch: 'glyphh-main' }, { repo: 'glyphh-ai/ada', branch: 'main' }]);
    expect(toggleRepo(picks, server)).toEqual([{ repo: 'glyphh-ai/ada', branch: 'main' }]);
    expect(setBranch(picks, 'glyphh-ai/ada', 'feat/x')[1]).toEqual({ repo: 'glyphh-ai/ada', branch: 'feat/x' });
  });
  it('groups by owner, alphabetical, with a substring search', () => {
    const g = groupRepos([server, other, ada]);
    expect(g.map((x) => x.owner)).toEqual(['acme', 'glyphh-ai']);
    expect(g[1].repos.map((r) => r.fullName)).toEqual(['glyphh-ai/ada', 'glyphh-ai/server']);
    expect(groupRepos([server, other, ada], 'SERV')).toEqual([{ owner: 'glyphh-ai', repos: [server] }]);
    expect(splitRepo('glyphh-ai/ada')).toEqual({ owner: 'glyphh-ai', name: 'ada' });
  });
});

describe('the sessions list', () => {
  const desk = (id, extra = {}) => ({ id, title: id, source: { kind: 'local', path: '/Users/x/yo', machineName: 'Mac' }, createdAt: 1, updatedAt: 2, messageCount: 1, ...extra });
  const cloud = (id) => ({ id, title: id, source: { kind: 'cloud-repo', repo: 'glyphh-ai/ada' }, createdAt: 1, updatedAt: 2, messageCount: 1 });
  it('takes only the server CLOUD threads beside the desktop ones, never twice', () => {
    const merged = mergeThreads([desk('a'), desk('b')], [desk('a', { source: { kind: 'local' } }), cloud('c'), cloud('b')]);
    expect(merged.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(merged[1].source.kind).toBe('local');
  });
  it("sublines the folder's last segment on a desktop (else the age), Cloud · repo in the cloud", () => {
    expect(sessionSubline({ locus: 'local', path: '/Users/x/development/yo', age: '2d' })).toBe('yo');
    expect(sessionSubline({ locus: 'local', path: '', age: '2d' })).toBe('2d');
    expect(sessionSubline({ locus: 'cloud', source: { kind: 'cloud-repo', repo: 'glyphh-ai/ada' }, age: '2d' })).toBe('Cloud · ada');
  });
  it('marks a row idle / running / waiting', () => {
    expect(sessionMark(undefined)).toBe('idle');
    expect(sessionMark('working')).toBe('running');
    expect(sessionMark('waiting')).toBe('waiting');
  });
  it("defaults a new session to the attached desktop, else the cloud — the web's rule", () => {
    expect(defaultLocus('web', true)).toBe('local');
    expect(defaultLocus('web', false)).toBe('cloud');
  });
  it('stores the transcript as user/assistant text', () => {
    const out = toStoredMessages([{ role: 'user', text: 'hi' }, { role: 'glyphh', text: 'hello' }]);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(out.every((m) => typeof m.at === 'number')).toBe(true);
  });
});
