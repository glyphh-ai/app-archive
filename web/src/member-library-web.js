/**
 * member-library-web.js — THE MEMBER LIBRARY ON THE WEB (his rule, 2026-10-04:
 * database-as-truth; both surfaces write to the server; each syncs its own
 * file system from it). The browser has no file system, so here the server IS
 * the store: every list reads `client.memberLibrary` FIRST (merged with the
 * rows an attached desktop still holds, the server winning a tie), and every
 * write is a `put`/`remove` at this client's clock — the desktop pulls it on
 * its next sync.
 *
 *   workspaces  layoutsList / layoutsSaveGrid / layoutsDelete
 *   app tabs    panelAppsList / panelAppsCreate / panelAppsUpdate / panelAppsDelete
 *   skills+tasks skillsList / skillGet / skillFileRead / skillFileWrite / skillCreate /
 *               skillDelete / skillSetEnabled  (files through the presigned R2 URLs)
 *   agents      libraryAgentsList / libraryAgentGet / libraryAgentCreate / libraryAgentUpdate / libraryAgentDelete
 *   tasks       tasksSpecs / taskSpec / taskSlotSet
 *
 * What still needs the machine answers so, per action (NEEDS_DESKTOP): running
 * a task now, an agent's schedules, revealing/importing/exporting a folder,
 * opening an app bundle as a tab. Pure over the injected client + fetch — the
 * tests drive it with fakes.
 */
import {
  bundleDataOf, bundleOfPageId, bundlePageId, bundleRowOf, buildAgentRow, buildTabRow, isAgentRow, isGridLayout, isTabRow,
  layoutRowOf, mergeServerFirst, parseSkillMd, tabRecordOf, tabRowOf, workspaceId,
} from '../../src/shared/member-library';

/** The one line a machine-only action answers on web. */
export const NEEDS_DESKTOP = 'This runs on your desktop. Open the Glyphh desktop app for it — the record itself is here, synced from the server.';

const ok = (data) => ({ ok: true, data });
const fail = (err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) });
const isNotFound = (err) => err && (err.httpStatus === 404 || err.code === 'not_found' || /not found/i.test(String(err.message)));

/** sha256 as hex — the browser's SubtleCrypto (node's webcrypto under test). */
async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('no crypto.subtle — cannot hash the file');
  const buf = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const encode = (text) => new TextEncoder().encode(text);

/**
 * @param {object} client the SDK client (client.memberLibrary)
 * @param {object} deps  { desktopRead(method, field) → rows[] from the attached desktops; fetchImpl }
 */
export function buildMemberLibrary(client, deps = {}) {
  const lib = () => client.memberLibrary;
  const desktopRead = deps.desktopRead ?? (async () => []);
  const fetchImpl = deps.fetchImpl ?? ((u, i) => fetch(u, i));
  // THE CLOCK: this client's `Date.now()`, strictly increasing across the
  // writes of this page — a save and a delete in the same millisecond must
  // not collide on the server's strictly-newer rule.
  const wall = deps.now ?? (() => Date.now());
  let lastClock = 0;
  const now = () => { lastClock = Math.max(wall(), lastClock + 1); return lastClock; };
  const STALE = 'the server holds a newer copy — reload and try again';

  const listRows = async (kind) => {
    try { return await lib().list(kind); } catch { return []; }
  };

  // ── Workspaces ────────────────────────────────────────────────────────────
  const layoutsList = async () => {
    const [srv, desk] = await Promise.all([listRows('workspace'), desktopRead('layouts.list', 'layouts')]);
    const server = srv.filter((r) => isGridLayout(r.data)).map((r) => layoutRowOf({ ...r.data, updatedAt: r.updatedAt }));
    return mergeServerFirst(server, desk ?? [], (l) => l.name);
  };
  const layoutsSaveGrid = async (grid) => {
    try {
      const name = String(grid?.name ?? '').trim();
      if (!name) return { error: 'A name is required.' };
      const { loop, modelSelections, sessionMode, folder, space, ...rest } = grid;
      const at = now();
      const data = {
        ...rest, name, version: 2,
        folderMode: grid.folderMode ?? 'single',
        target: grid.target ?? 'glyphh',
        ...(loop ? { loop } : {}),
        ...(modelSelections && Object.keys(modelSelections).length ? { modelSelections } : {}),
        ...(sessionMode && sessionMode !== 'keep' ? { sessionMode } : {}),
        ...(folder ? { folder } : {}),
        ...(space === 'chat' || space === 'cowork' || space === 'code' ? { space } : {}),
        updatedAt: at,
      };
      const res = await lib().put('workspace', workspaceId(name), { data, updatedAt: at });
      return res.applied ? true : { error: STALE };
    } catch (err) { return { error: err?.message ?? String(err) }; }
  };
  const layoutsDelete = async (name) => {
    try { await lib().remove('workspace', workspaceId(name), { updatedAt: now() }); return true; }
    catch (err) { return isNotFound(err) ? true : { error: err?.message ?? String(err) }; }
  };

  // ── App tabs ──────────────────────────────────────────────────────────────
  const panelAppsList = async () => {
    const [srv, desk] = await Promise.all([listRows('tab'), desktopRead('panelApps.list', 'apps')]);
    const server = srv.filter((r) => isTabRow(r.data)).map((r) => tabRowOf({ ...r.data, slug: r.id, updatedAt: new Date(r.updatedAt).toISOString() }));
    return mergeServerFirst(server, desk ?? [], (a) => a.slug || a.id);
  };
  const tabInputOf = (o) => ({
    ...(o.name !== undefined ? { name: String(o.name) } : {}),
    ...(o.url !== undefined && o.url !== null ? { url: String(o.url) } : {}),
    ...(o.execPath !== undefined && o.execPath !== null ? { nativeRef: String(o.execPath) } : {}),
    ...(o.description !== undefined ? { description: String(o.description) } : {}),
    ...(o.launchConfig !== undefined ? { config: o.launchConfig ?? {} } : {}),
    ...(o.access !== undefined ? { access: o.access } : {}),
  });
  const tabKindOf = (o) => (String(o.appArchetype ?? '') === 'glyphh-app' ? 'glyphh' : (o.isBrowser === false || o.execPath ? 'native' : 'web'));
  const readTab = async (slug) => {
    try { const item = await lib().get('tab', slug); return isTabRow(item.data) ? { ...item.data, slug, updatedAt: new Date(item.updatedAt).toISOString() } : null; }
    catch (err) { if (isNotFound(err)) return null; throw err; }
  };
  const panelAppsCreate = async (input) => {
    try {
      const slug = String(input?.slug || input?.name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!slug) return { ok: false, error: 'A name is required.' };
      if (await readTab(slug)) return { ok: false, error: `an app named "${slug}" already exists` };
      const at = now();
      const row = buildTabRow({ kind: tabKindOf(input), slug, name: String(input.name || slug), ...tabInputOf(input) }, null, new Date(at).toISOString());
      const res = await lib().put('tab', slug, { data: tabRecordOf(row), updatedAt: at });
      return res.applied ? { ok: true, app: tabRowOf(row) } : { ok: false, error: STALE };
    } catch (err) { return fail(err); }
  };
  const panelAppsUpdate = async (id, patch) => {
    try {
      const existing = await readTab(String(id).toLowerCase().trim());
      if (!existing) return { ok: false, error: `app "${id}" not found` };
      const kind = patch?.isBrowser !== undefined ? tabKindOf(patch) : undefined;
      const at = now();
      const row = buildTabRow({ ...tabInputOf(patch ?? {}), ...(kind === 'web' || kind === 'native' ? { kind } : {}) }, existing, new Date(at).toISOString());
      const res = await lib().put('tab', existing.slug, { data: tabRecordOf(row), updatedAt: at });
      return res.applied ? { ok: true, app: tabRowOf(row) } : { ok: false, error: STALE };
    } catch (err) { return fail(err); }
  };
  const panelAppsDelete = async (id) => {
    try { await lib().remove('tab', String(id).toLowerCase().trim(), { updatedAt: now() }); return { ok: true }; }
    catch (err) { return isNotFound(err) ? { ok: true } : fail(err); }
  };

  // ── Skills and tasks ──────────────────────────────────────────────────────
  const BUNDLE_KINDS = { skill: 'skill', task: 'task' };
  const skillsList = async (kind) => {
    const kinds = [...new Set((Array.isArray(kind) ? kind : [kind ?? 'skill']).map((k) => BUNDLE_KINDS[k]).filter(Boolean))];
    const rows = [];
    for (const k of kinds) {
      for (const r of await listRows(k)) {
        if (!r.data || typeof r.data !== 'object') continue;
        rows.push(bundleRowOf(k, r.id, r.data, r.updatedAt, Array.isArray(r.data.files) ? r.data.files.length : (r.fileCount ?? 0)));
      }
    }
    return ok(rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  };
  const bundleItem = async (pageId) => {
    const ref = bundleOfPageId(String(pageId));
    if (!ref) throw new Error(`${pageId}: not a library skill or task`);
    const item = await lib().get(ref.kind, ref.id);
    return { ref, item };
  };
  const skillGet = async (pageId) => {
    try {
      const { ref, item } = await bundleItem(pageId);
      const data = item.data ?? {};
      const files = (item.files ?? []).map((f) => ({ path: f.path, size: f.size }));
      return ok({
        ...bundleRowOf(ref.kind, ref.id, data, item.updatedAt, files.length),
        frontmatter: data.frontmatter ?? {}, body: data.body ?? '', files,
      });
    } catch (err) { return fail(err); }
  };
  const skillFileRead = async (pageId, rel) => {
    try {
      const { ref, item } = await bundleItem(pageId);
      const f = (item.files ?? []).find((x) => x.path === rel);
      if (!f) return { ok: false, error: `no file ${rel}` };
      const urls = await lib().files(ref.kind, ref.id, [rel]);
      const res = await fetchImpl(urls.get[rel]);
      if (!res.ok) return { ok: false, error: `read ${rel}: HTTP ${res.status}` };
      const buf = new Uint8Array(await res.arrayBuffer());
      const binary = buf.subarray(0, 4096).includes(0);
      return ok({ text: binary ? '' : new TextDecoder().decode(buf), binary, size: buf.length });
    } catch (err) { return fail(err); }
  };
  /** Write one file: upload the bytes, then re-put the record with the new
   *  manifest (and, for SKILL.md / task.json, the data it derives). */
  const putBundleFiles = async (kind, id, item, writes, enabledOverride) => {
    const at = now();
    const manifest = new Map((item?.files ?? []).map((f) => [f.path, { path: f.path, size: f.size, mtime: f.mtime, sha256: f.sha256 }]));
    for (const [rel, text] of Object.entries(writes)) {
      const bytes = encode(text);
      manifest.set(rel, { path: rel, size: bytes.length, mtime: at, sha256: await sha256Hex(bytes) });
    }
    const files = [...manifest.values()];
    const data = { ...(item?.data ?? {}) };
    const skillMd = writes['SKILL.md'] ?? null;
    if (skillMd !== null || !item) {
      const text = skillMd ?? '';
      Object.assign(data, bundleDataOf(kind, id, text, enabledOverride ?? data.enabled !== false, kind === 'task' ? data.manifest ?? null : null));
    }
    if (kind === 'task' && writes['task.json'] !== undefined) { try { data.manifest = JSON.parse(writes['task.json']); } catch { /* not json — the manifest field waits */ } }
    if (enabledOverride !== undefined) data.enabled = enabledOverride;
    data.type = kind;
    const res = await lib().put(kind, id, { data, files, updatedAt: at });
    if (!res.applied) throw new Error(STALE);
    const paths = Object.keys(writes);
    if (paths.length) {
      const urls = await lib().files(kind, id, paths);
      for (const rel of paths) {
        const r = await fetchImpl(urls.put[rel], { method: 'PUT', body: encode(writes[rel]) });
        if (!r.ok) throw new Error(`upload ${rel}: HTTP ${r.status}`);
      }
    }
    return res.item;
  };
  const skillFileWrite = async (pageId, rel, text) => {
    try {
      const { ref, item } = await bundleItem(pageId);
      await putBundleFiles(ref.kind, ref.id, item, { [String(rel)]: String(text) });
      return ok(true);
    } catch (err) { return fail(err); }
  };
  const skillCreate = async (rawName, kind = 'skill') => {
    try {
      const k = BUNDLE_KINDS[kind];
      if (!k) return { ok: false, error: NEEDS_DESKTOP };
      const name = String(rawName ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
      if (!name) return { ok: false, error: 'a skill needs a name' };
      try { await lib().get(k, name); return { ok: false, error: `a ${k} named "${name}" already exists` }; }
      catch (err) { if (!isNotFound(err)) throw err; }
      const md = `---\nname: ${name}\ndescription: What this ${k} is for, in one line — the agent reads this to decide when to use it.\n---\n\n# ${name}\n\nInstructions the agent follows when this ${k} applies.\n`;
      const writes = { 'SKILL.md': md };
      if (k === 'task') {
        writes['task.json'] = JSON.stringify({ name, program: 'run.js', slots: { main: { label: 'Main', description: 'The agent this task runs through.', agent: null } }, schedule: null, dependencies: { connections: [] } }, null, 2) + '\n';
        writes['run.js'] = `// A Glyphh task: the desktop runs this program itself. Agents only where it slots them.\nmodule.exports = async function run(ctx, input) {\n  const turn = await ctx.checkpoint("turn", () => ctx.agents.main.run("Say what this task should do."));\n  return { output: turn.text };\n};\n`;
        writes['package.json'] = JSON.stringify({ type: 'commonjs', private: true }, null, 2) + '\n';
      }
      const item = await putBundleFiles(k, name, null, writes, true);
      return ok(bundleRowOf(k, name, item.data ?? {}, item.updatedAt, item.files?.length ?? Object.keys(writes).length));
    } catch (err) { return fail(err); }
  };
  const skillDelete = async (pageId) => {
    try {
      const ref = bundleOfPageId(String(pageId));
      if (!ref) return { ok: false, error: NEEDS_DESKTOP };
      await lib().remove(ref.kind, ref.id, { updatedAt: now() });
      return ok(true);
    } catch (err) { return isNotFound(err) ? ok(true) : fail(err); }
  };
  const skillSetEnabled = async (pageId, on) => {
    try {
      const { ref, item } = await bundleItem(pageId);
      const at = now();
      const data = { ...(item.data ?? {}), enabled: !!on };
      const res = await lib().put(ref.kind, ref.id, { data, files: item.files ?? [], updatedAt: at });
      if (!res.applied) return { ok: false, error: STALE };
      return ok(bundleRowOf(ref.kind, ref.id, data, at, item.files?.length ?? 0));
    } catch (err) { return fail(err); }
  };

  // ── Agents ────────────────────────────────────────────────────────────────
  const agentRow = (r) => (isAgentRow(r.data) ? { ...r.data, updatedAt: new Date(r.updatedAt).toISOString() } : null);
  const libraryAgentsList = async () => {
    try { return ok((await lib().list('agent')).map(agentRow).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name))); }
    catch (err) { return fail(err); }
  };
  const readAgent = async (ref) => {
    try { const row = agentRow(await lib().get('agent', String(ref))); return row; }
    catch (err) { if (isNotFound(err)) return null; throw err; }
  };
  const libraryAgentGet = async (ref) => {
    try { const row = await readAgent(ref); return row ? ok(row) : { ok: false, error: `agent "${ref}" not found` }; }
    catch (err) { return fail(err); }
  };
  const saveAgent = async (input, slug) => {
    const existing = slug ? await readAgent(slug) : null;
    const at = now();
    const row = buildAgentRow({ ...(input ?? {}), ...(slug ? { slug } : {}) }, existing, new Date(at).toISOString());
    const res = await lib().put('agent', row.slug, { data: row, updatedAt: at });
    if (!res.applied) throw new Error(STALE);
    return row;
  };
  const libraryAgentCreate = async (input) => { try { return ok(await saveAgent(input, null)); } catch (err) { return fail(err); } };
  const libraryAgentUpdate = async (ref, patch) => { try { return ok(await saveAgent(patch, String(ref))); } catch (err) { return fail(err); } };
  const libraryAgentDelete = async (ref) => {
    try { await lib().remove('agent', String(ref), { updatedAt: now() }); return ok(true); }
    catch (err) { return isNotFound(err) ? ok(true) : fail(err); }
  };

  // ── Tasks (the Tasks page + the schedules picker) ─────────────────────────
  const taskSpecOf = (r) => {
    const d = r.data ?? {};
    const m = d.manifest ?? {};
    return {
      slug: r.id, name: m.name || d.name || r.id, description: d.description || '', program: m.program || 'run.js', icon: null,
      slots: Object.entries(m.slots ?? {}).map(([name, s]) => ({ name, ...(s?.label ? { label: s.label } : {}), ...(s?.description ? { description: s.description } : {}), agent: s?.agent ?? null, ...(s?.model ? { model: s.model } : {}) })),
      connections: (m.dependencies?.connections ?? []).map((c) => (typeof c === 'string' ? c : c?.app)).filter(Boolean),
      schedule: m.schedule ?? null, enabled: d.enabled !== false, dir: '',
    };
  };
  const tasksSpecs = async () => {
    try { return ok((await lib().list('task')).map(taskSpecOf).sort((a, b) => a.name.localeCompare(b.name))); }
    catch (err) { return fail(err); }
  };
  const taskSpec = async (slug) => {
    try { return ok(taskSpecOf(await lib().get('task', String(slug)))); }
    catch (err) { return fail(err); }
  };
  const taskSlotSet = async (slug, slot, agentId) => {
    try {
      const item = await lib().get('task', String(slug));
      const manifest = { ...(item.data?.manifest ?? {}) };
      manifest.slots = { ...(manifest.slots ?? {}), [slot]: { ...(manifest.slots?.[slot] ?? {}), agent: agentId ? String(agentId) : null } };
      await putBundleFiles('task', String(slug), item, { 'task.json': JSON.stringify(manifest, null, 2) + '\n' });
      return ok(taskSpecOf({ id: String(slug), data: { ...(item.data ?? {}), manifest } }));
    } catch (err) { return fail(err); }
  };

  const needsDesktop = async () => ({ ok: false, error: NEEDS_DESKTOP });
  const emptyList = async () => ok([]);

  return {
    layoutsList, layoutsSaveGrid, layoutsDelete,
    panelAppsList, panelAppsCreate, panelAppsUpdate, panelAppsDelete,
    skillsList, skillGet, skillFileRead, skillFileWrite, skillCreate, skillDelete, skillSetEnabled,
    // A bundle's own agents (agents/*.md) are read off the folder on the desktop; the record carries none.
    skillAgents: emptyList,
    skillAgentSet: needsDesktop,
    // What touches the machine: its folders, its dialogs, its tabs.
    skillReveal: needsDesktop, skillImport: needsDesktop, skillReplace: needsDesktop, skillDownload: needsDesktop,
    skillAdopt: needsDesktop, skillTab: needsDesktop, skillImage: needsDesktop,
    skillsHome: async () => ({ ok: false, error: NEEDS_DESKTOP }),
    libraryAgentsList, libraryAgentGet, libraryAgentCreate, libraryAgentUpdate, libraryAgentDelete,
    // An agent's schedules are rows on the desktop's clock.
    libraryAgentTasks: emptyList, libraryAgentTaskAdd: needsDesktop, libraryAgentTaskUpdate: needsDesktop,
    libraryAgentTaskRunNow: needsDesktop, libraryAgentTaskRuns: emptyList, libraryAgentTaskRunning: async () => ok(false),
    tasksSpecs, taskSpec, taskSlotSet,
    // Runs happen on the desktop: nothing to list here, nothing to start.
    taskRun: needsDesktop, taskRuns: emptyList, taskRunGet: needsDesktop, taskRunCancel: needsDesktop,
    // The hub (discover, install, update), sharing and publishing are the
    // desktop's hub-ipc lane; the Skills page reads them from its detail and
    // its Discover tab, so each answers honestly here — nothing to list, or
    // "runs on your desktop" for the action.
    skillsDiscover: emptyList, skillUpdates: emptyList, skillShares: emptyList, skillStandings: emptyList, skillVersions: emptyList,
    hubCategories: emptyList,
    skillInstall: needsDesktop, skillUpdate: needsDesktop, skillHubFiles: needsDesktop, skillCategoriesSet: needsDesktop,
    skillPublish: needsDesktop, skillWithdraw: needsDesktop, skillVersionFiles: needsDesktop,
    // Schedules are rows on the desktop's clock (schedules.ts paints its own card).
    schedulesList: emptyList, scheduleRecentRuns: emptyList, scheduleRuns: emptyList,
    scheduleSave: needsDesktop, scheduleDelete: needsDesktop, scheduleSetEnabled: needsDesktop,
    scheduleRunNow: async () => ({ ok: false, error: NEEDS_DESKTOP }),
  };
}
