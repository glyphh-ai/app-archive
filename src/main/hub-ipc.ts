/**
 * hub-ipc — the hub lanes for SKILLS (his order, 2026-09-16: skills are the
 * Agent Skills standard, folders on disk; the hub stores a folder as files).
 *
 *   skills-discover   what the member may install: the org's approved skills
 *                     and the Glyphh catalog items the org allowed
 *   skill-install     a hub skill → a folder in Glyphh's skills directory,
 *                     mirrored into every CLI's skills directory on the box
 *   skill-publish     a local folder → the org's hub (an org admin's goes live,
 *                     a member's waits on the review desk)
 *
 * Payload on the wire: { files: { "SKILL.md": "...", "scripts/x.py": "..." },
 * prompt: <SKILL.md body> } — `prompt` keeps the proxy's skills mirror fed.
 */

import { ipcMain } from "electron";
import { getClient, PLATFORM_URL } from "./glyphh-client.js";
import { getActiveUserId } from "./app-paths.js";
import { getSkill, installSkill, filesFromHubPayload, readSkillFile, parseSkillMd, listSkills, setInstallForgetter, removeSkillFiles } from "./skills-fs.js";
import { getPreference, setPreference, preferencesByPrefix } from "./stores/preferences-db.js";
import { ensureInstanceTab, installFromHub, listInstances, findInstance } from "./app-instances.js";
import { instanceCardId, isInstanceCardId, instanceKeyOfCardId } from "../shared/app-instances.js";
import { houseViewOfApp } from "../shared/house-store.js";

interface OrgItem { id: string; slug: string; name: string; description: string; author?: string; installed: boolean; installs?: number; headVersion: number | null; updatedAt: string; createdAt?: string; visibility?: string; categories?: string[]; icon?: string | null }
interface PublicItem { id: string; slug: string; name: string; description: string; sourceOrg: string; installed: boolean; installs?: number; version: number; updatedAt: string; createdAt?: string; kind: string; categories?: string[]; icon?: string | null }
export interface DiscoverRow {
  ref: string;
  from: "org" | "glyphh";
  id: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  version: number | null;
  installed: boolean;
  installs: number;
  updatedAt: string;
  createdAt: string;
  categories: string[];
  /** App and task items: the manifest's icon.svg, from the catalog row. */
  icon?: string | null;
  /** A house app's own panel (gimage, gdrive, …): the card wears that mark (his report, 2026-10-07). */
  tool?: string | null;
  /** What kind of skill this is — the hub kind it was listed under. */
  type: Kind;
}

const env = async <T>(fn: () => Promise<T>): Promise<{ ok: boolean; data?: T; error?: string }> => {
  try { return { ok: true, data: await fn() }; }
  catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
};

/** The CONSOLE, signed in: a console session minted on this login handed to
 *  the console's own login page, which sets the cookie and lands on `next`. */
export async function platformUrl(next = "/ui/"): Promise<string> {
  const { token } = await getClient().http.post<{ token: string }>("/api/gateway/ui-session", {});
  if (!token) throw new Error("the console session couldn't be minted");
  return `${PLATFORM_URL}/ui/login?handoff=${encodeURIComponent(token)}&next=${encodeURIComponent(next)}`;
}

type Kind = "skill" | "app" | "plugin" | "task";
const kindOf = (k: unknown): Kind => (k === "app" ? "app" : k === "plugin" ? "plugin" : k === "task" ? "task" : "skill");
const kindsOf = (k: unknown): Kind[] => (Array.isArray(k) ? [...new Set(k.map(kindOf))] : [kindOf(k)]);
/** The hub kind behind a local bundle: what the folder IS (its manifest), and
 *  only if it can't be read, the home its id names. */
const kindOfId = (id: string): Kind => {
  try { return getSkill(id).type; } catch { /* unreadable or gone — fall back */ }
  return id.startsWith("app:") ? "app" : id.startsWith("plugin:") ? "plugin" : id.startsWith("task:") ? "task" : "skill";
};

async function discover(kinds: Kind[]): Promise<DiscoverRow[]> {
  const client = getClient();
  // The org list is per kind; the public catalog is one list for all of them.
  const [orgLists, pub] = await Promise.all([
    Promise.all(kinds.map(async (k) => [k, await client.http.get<OrgItem[]>(`/api/library/${k}`).catch(() => [] as OrgItem[])] as const)),
    client.http.get<PublicItem[]>("/api/hub/public").catch(() => [] as PublicItem[]),
  ]);
  // ALREADY YOURS IS NOT THE SAME AS ADDABLE (his report, 2026-09-18: a skill
  // the user wrote and published was offered back to them with an Add button).
  // The hub's `installed` only knows about installs, and an author never
  // installed their own work, so the folder on disk is the honest answer. The
  // row STAYS and says it is already here.
  // APPS ARE NOT IN THIS SET: an app is installed when the member has an
  // INSTANCE of it, nothing else (his report, 2026-10-07). The app folders
  // the desktop carries on disk — the house apps among them — are not
  // installs, and counting them ticked Drive, Audio, Video, Images and Slides
  // on Discover while Your apps stood at zero (his report, 2026-10-07).
  const mine = new Set(listSkills(["skill", "task", "plugin"])
    .map((sk) => `${kindOfId(sk.id)}:${sk.id.slice(sk.id.indexOf(":") + 1).toLowerCase()}`));
  if (kinds.includes("app")) for (const i of await listInstances().catch(() => [])) mine.add(`app:${i.slug.toLowerCase()}`);
  const have = (kind: Kind, slug: string): boolean => mine.has(`${kind}:${(slug || "").toLowerCase()}`);
  const rows: DiscoverRow[] = [];
  for (const [kind, org] of orgLists) {
    for (const it of Array.isArray(org) ? org : []) {
      if (!it.headVersion) continue;
      rows.push({ ref: `org:${it.id}`, from: "org", id: it.id, slug: it.slug, name: it.name, description: it.description, author: it.author || "", version: it.headVersion, installed: it.installed || have(kind, it.slug), installs: it.installs ?? 0, updatedAt: it.updatedAt, createdAt: it.createdAt || it.updatedAt, categories: it.categories ?? [], icon: it.icon ?? null, tool: kind === "app" ? houseViewOfApp(it.slug) : null, type: kind });
    }
  }
  for (const p of (Array.isArray(pub) ? pub : []).filter((x) => kinds.includes(x.kind as Kind))) {
    rows.push({ ref: `glyphh:${p.id}`, from: "glyphh", id: p.id, slug: p.slug, name: p.name, description: p.description, author: p.sourceOrg, version: p.version, installed: p.installed || have(p.kind as Kind, p.slug), installs: p.installs ?? 0, updatedAt: p.updatedAt, createdAt: p.createdAt || p.updatedAt, categories: p.categories ?? [], icon: p.icon ?? null, tool: p.kind === "app" ? houseViewOfApp(p.slug) : null, type: p.kind as Kind });
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** WHERE AN INSTALLED BUNDLE CAME FROM (2026-09-17). Without this an installed
 *  folder is an orphan: the hub can't be told when it goes, and nothing knows
 *  a newer version exists. Kept in the user's prefs (no local store), keyed by
 *  the folder's own id, and cleared when the folder goes. */
export interface InstallOrigin {
  from: "org" | "glyphh";
  itemId: string;
  kind: Kind;
  slug: string;
  /** The catalog version this copy was written from. */
  version: number;
  /** What the payload wrote, so an update can take away what it removed. */
  files: string[];
  installedAt: string;
  /** Who published it: the catalog's author, so the list never says "by you". */
  author?: string;
}
const ORIGIN_KEY = (skillId: string): string => `bundleSource:${skillId}`;
const originOf = (skillId: string): InstallOrigin | null => {
  const v = getPreference<InstallOrigin | null>(ORIGIN_KEY(skillId), null);
  return v && typeof v === "object" && v.itemId ? v : null;
};
const baseFor = (o: { from: "org" | "glyphh"; kind: Kind; itemId: string }): string =>
  (o.from === "org" ? `/api/library/${o.kind}/${encodeURIComponent(o.itemId)}` : `/api/hub/public/${encodeURIComponent(o.itemId)}`);

/** The folder is gone: tell the hub this member no longer has it, and forget
 *  where it came from. Best effort — the folder is the truth either way. */
async function forget(skillId: string): Promise<void> {
  const o = originOf(skillId);
  setPreference(ORIGIN_KEY(skillId), null);
  if (!o) return;
  await getClient().http.del(`${baseFor(o)}/install`).catch(() => undefined);
}

/** The hub install — the desktop's Install button (skill-install) and the
 *  relay's `apps.install` (attach-handlers.ts) both land here. */
export async function installHubItem(ref: string, kind: Kind): Promise<{ id: string }> {
  const client = getClient();
  const [from, id] = ref.split(":", 2) as ["org" | "glyphh", string];
  if (from !== "org" && from !== "glyphh") throw new Error(`not a hub item: ${ref}`);
  const base = from === "org" ? `/api/library/${kind}/${encodeURIComponent(id)}` : `/api/hub/public/${encodeURIComponent(id)}`;
  const rows = from === "org" ? await client.http.get<OrgItem[]>(`/api/library/${kind}`) : await client.http.get<PublicItem[]>("/api/hub/public");
  const meta = (rows as Array<{ id: string; slug: string; name: string; description: string; headVersion?: number | null; version?: number | null; author?: string; sourceOrg?: string }>).find((r) => r.id === id);
  if (!meta) throw new Error(`that ${kind} is no longer available to you`);
  const author = from === "glyphh" ? "Glyphh" : (meta.author || "your organization");
  const origin = (skillId: string, files: string[]): void => {
    setPreference(ORIGIN_KEY(skillId), { from, itemId: id, kind, slug: meta.slug, version: versionOf(meta), files, installedAt: new Date().toISOString(), author } satisfies InstallOrigin);
  };

  // AN APP IS A CLOUD INSTANCE (his order, 2026-10-06): a hub app becomes
  // this member's personal instance, made server-side, and its tab names it.
  // Nothing of it lands on this machine.
  if (kind === "app") {
    const inst = await installFromHub(id);
    await ensureInstanceTab(inst, null);
    return { id: instanceCardId(inst.key) };
  }
  const payload = await client.http.get<Record<string, unknown>>(`${base}/payload`);
  const files = filesFromHubPayload(meta.slug, meta.description, payload && typeof payload === "object" ? payload : {});
  const installed = installSkill(meta.slug, files, kind);
  origin(installed.id, Object.keys(files));
  await client.http.post(`${base}/install`, {}).catch(() => undefined); // the hub's install count; the folder is the truth
  return { id: installed.id };
}
const install = installHubItem;

/** A catalog row's LIVE version, or 0 when nothing of it is approved yet. It
 *  used to default to 1, so an item whose only version was sitting on the
 *  review desk read as v1 available and every list row grew an Update button
 *  for a version nobody could install (his report, 2026-09-17). */
const versionOf = (r: { headVersion?: number | null; version?: number | null }): number => Number(r.headVersion ?? r.version ?? 0);

/** Every catalog row this member can see, by kind, org rows first. */
type CatalogRow = { id: string; slug: string; name: string; description: string; headVersion?: number | null; version?: number | null };
async function catalogRows(kinds: Kind[]): Promise<Array<{ from: "org" | "glyphh"; kind: Kind; row: CatalogRow }>> {
  const client = getClient();
  const [orgLists, pub] = await Promise.all([
    Promise.all(kinds.map(async (k) => [k, await client.http.get<OrgItem[]>(`/api/library/${k}`).catch(() => [] as OrgItem[])] as const)),
    client.http.get<PublicItem[]>("/api/hub/public").catch(() => [] as PublicItem[]),
  ]);
  const out: Array<{ from: "org" | "glyphh"; kind: Kind; row: CatalogRow }> = [];
  for (const [kind, rows] of orgLists) for (const row of Array.isArray(rows) ? rows : []) out.push({ from: "org", kind, row: row as CatalogRow });
  for (const row of Array.isArray(pub) ? pub : []) {
    const kind = (row as { kind?: string }).kind as Kind | undefined;
    if (kind && kinds.includes(kind)) out.push({ from: "glyphh", kind, row: row as CatalogRow });
  }
  return out;
}

/**
 * WHERE A BUNDLE CAME FROM, recorded or not (his report, 2026-09-17: "why am I
 * not able to apply the update myself?").
 *
 * An Update needed a `bundleSource:` preference, so a folder installed before
 * that bookkeeping — or seeded any other way — could never be updated and
 * never showed a newer version. The catalog is matched by slug and kind when
 * no origin is on file, which is the same identity the hub publishes under.
 */
async function originFor(skillId: string, kind: Kind, catalog?: Array<{ from: "org" | "glyphh"; kind: Kind; row: CatalogRow }>): Promise<InstallOrigin | null> {
  const recorded = originOf(skillId);
  if (recorded) return recorded;
  const slug = skillId.slice(skillId.indexOf(":") + 1).toLowerCase();
  const rows = (catalog ?? await catalogRows([kind])).filter((c) => versionOf(c.row) > 0);
  const hit = rows.find((c) => c.kind === kind && c.row.slug?.toLowerCase() === slug)
    ?? rows.find((c) => c.kind === kind && c.row.name?.toLowerCase() === slug);
  if (!hit) return null;
  // Version 0: nothing is recorded, so whatever the catalog has is newer and
  // the user can take it. Writing the origin is left to the update itself.
  return { from: hit.from, itemId: hit.row.id, kind, slug: hit.row.slug, version: 0, files: [], installedAt: "" };
}

/**
 * WHERE EVERY INSTALLED BUNDLE STANDS (his report, 2026-09-17: "there is no
 * update mechanism"). One read, used by the badge AND by the detail page, so
 * a bundle from the catalog can always say where it came from, which version
 * it is on, and what the catalog has — even when the two match.
 */
export interface BundleStanding { from: "org" | "glyphh"; sourceName: string; name: string; have: number; latest: number }
async function standings(): Promise<Record<string, BundleStanding>> {
  const out: Record<string, BundleStanding> = {};
  const mine = listSkills(["skill", "task", "plugin"]);
  if (!mine.length) return out;
  const kinds = [...new Set(mine.map((s) => kindOfId(s.id)))];
  const catalog = await catalogRows(kinds);
  if (!catalog.length) return out;
  for (const sk of mine) {
    const kind = kindOfId(sk.id);
    const o = await originFor(sk.id, kind, catalog);
    if (!o) continue;
    const hit = catalog.find((c) => c.from === o.from && c.kind === kind && c.row.id === o.itemId);
    if (!hit) continue;
    out[sk.id] = {
      from: o.from,
      sourceName: o.from === "org" ? "your organization's hub" : "the Glyphh catalog",
      name: hit.row.name,
      have: Number(o.version || 0),
      latest: versionOf(hit.row),
    };
  }
  return out;
}

/**
 * WHERE EVERY SHARE STANDS, on the LIST (his report, 2026-09-17: "you didn't
 * add anything to the app indicating that an item is shared and pending or
 * rejected"). The detail page asks per bundle; the list would need one call
 * each, so this is the same answer for all of them in one read per kind.
 */
export interface ShareState { head: number | null; pending: number | null; rejected: number | null }
async function shareStates(): Promise<Record<string, ShareState>> {
  const out: Record<string, ShareState> = {};
  const mine = listSkills(["skill", "task", "plugin"]);
  const kinds = [...new Set(mine.map((s) => kindOfId(s.id)))];
  const client = getClient();
  const lists = await Promise.all(kinds.map(async (k) =>
    [k, await client.http.get<OrgItem[]>(`/api/library/${k}`).catch(() => [] as OrgItem[])] as const));
  const byKind = new Map(lists.map(([k, rows]) => [k, Array.isArray(rows) ? rows : []]));
  for (const sk of mine) {
    const kind = kindOfId(sk.id);
    const slug = sk.id.slice(sk.id.indexOf(":") + 1).toLowerCase();
    const hit = (byKind.get(kind) ?? []).find((it) => it.slug?.toLowerCase() === slug || it.name === sk.name);
    if (!hit) continue;
    const raw = hit as OrgItem & { pendingVersion?: number | null; rejectedVersion?: number | null };
    const state: ShareState = { head: raw.headVersion ?? null, pending: raw.pendingVersion ?? null, rejected: raw.rejectedVersion ?? null };
    if (state.head || state.pending || state.rejected) out[sk.id] = state;
  }
  // An app INSTANCE's share stands on its slug's org item (2026-10-07).
  const apps = byKind.get("app") ?? (await client.http.get<OrgItem[]>("/api/library/app").catch(() => [] as OrgItem[]));
  for (const inst of await listInstances()) {
    const hit = (Array.isArray(apps) ? apps : []).find((it) => it.slug?.toLowerCase() === inst.slug.toLowerCase()) as (OrgItem & { pendingVersion?: number | null; rejectedVersion?: number | null }) | undefined;
    if (!hit) continue;
    const state: ShareState = { head: hit.headVersion ?? null, pending: hit.pendingVersion ?? null, rejected: hit.rejectedVersion ?? null };
    if (state.head || state.pending || state.rejected) out[instanceCardId(inst.key)] = state;
  }
  return out;
}

/**
 * TAKE A SUBMISSION BACK (his report, 2026-09-17: "the user has no way to
 * revoke their submission"). A share that is still waiting is the author's to
 * withdraw; an approved one is the org's and stays.
 */
async function withdrawShare(skillId: string): Promise<{ withdrawn: number }> {
  const { kind, slug: rawSlug, name } = await hubIdentity(skillId);
  const slug = rawSlug.toLowerCase();
  const items = await getClient().http.get<OrgItem[]>(`/api/library/${kind}`).catch(() => [] as OrgItem[]);
  const item = (Array.isArray(items) ? items : []).find((it) => it.slug?.toLowerCase() === slug || it.name === name);
  if (!item) throw new Error("this one isn't on your organization's hub");
  const r = await getClient().http.del<{ withdrawn: number }>(`/api/library/${kind}/${encodeURIComponent(item.id)}/submission`);
  return { withdrawn: Number(r?.withdrawn ?? 0) };
}

/** Installed bundles the catalog has moved past, by folder id. */
async function updatesAvailable(): Promise<Record<string, { have: number; latest: number; name: string }>> {
  const out: Record<string, { have: number; latest: number; name: string }> = {};
  for (const [id, st] of Object.entries(await standings())) {
    if (st.latest > 0 && st.latest > st.have) out[id] = { have: st.have, latest: st.latest, name: st.name };
  }
  return out;
}

/** Take the catalog's current version over this copy: write what the payload
 *  has, take away what it dropped, and keep anything the user added. */
async function update(skillId: string): Promise<{ version: number }> {
  // Same path whether the catalog moved or not: "Reinstall from the hub" is
  // this with nothing newer to fetch, which is how a local edit is undone.
  const o = await originFor(skillId, kindOfId(skillId));
  if (!o) throw new Error("no catalog item matches this one by slug, so there is nothing to update from");
  const client = getClient();
  const rows = o.from === "org"
    ? await client.http.get<OrgItem[]>(`/api/library/${o.kind}`)
    : await client.http.get<PublicItem[]>("/api/hub/public");
  const meta = (rows as Array<{ id: string; slug: string; name: string; description: string; headVersion?: number | null; version?: number | null }>).find((r) => r.id === o.itemId);
  if (!meta) throw new Error(`that ${o.kind} is no longer available to you`);
  const payload = await client.http.get<Record<string, unknown>>(`${baseFor(o)}/payload`);
  const files = filesFromHubPayload(meta.slug, meta.description, payload && typeof payload === "object" ? payload : {});
  const name = skillId.slice(skillId.indexOf(":") + 1);
  const gone = (o.files ?? []).filter((f) => !(f in files));
  installSkill(name, files, o.kind);
  if (gone.length) removeSkillFiles(skillId, gone);
  const version = versionOf(meta);
  setPreference(ORIGIN_KEY(skillId), { ...o, version, files: Object.keys(files) } satisfies InstallOrigin);
  return { version };
}

/** What every desktop gets without asking (his order, 2026-09-16): the Glyphh
 *  skill and its plugin from the public catalog, installed once when absent.
 *  Keeping them CURRENT is the Update button's job, not this function's. */
const DEFAULT_INSTALLS: ReadonlyArray<{ kind: Kind; slug: string }> = [{ kind: "skill", slug: "glyphh" }, { kind: "plugin", slug: "glyphh" }, { kind: "skill", slug: "glyphh-memory" }];
export async function installDefaultHubItems(): Promise<void> {
  try {
    const pub = await getClient().http.get<PublicItem[]>("/api/hub/public").catch(() => [] as PublicItem[]);
    for (const want of DEFAULT_INSTALLS) {
      const hit = pub.find((p) => p.kind === want.kind && p.slug === want.slug);
      if (!hit) continue;
      const have = listSkills(want.kind).find((s) => s.name === want.slug || s.id.endsWith(`:${want.slug}`));
      if (have) continue;
      // NOTHING REWRITES A FOLDER BEHIND THE USER (his report, 2026-09-17:
      // "it showed as having an update once but it isn't showing anymore").
      // A sign-in refresh of the house skill applied the update before he
      // could, so the badge appeared and vanished. The update is VISIBLE
      // instead: the catalog moves, the badge shows, the user presses Update.
      // This only installs what is missing.
      await install(`glyphh:${hit.id}`, want.kind);
      console.info(`[hub] installed the default ${want.kind} "${want.slug}"`);
    }
  } catch (err) {
    console.warn("[hub] default installs:", err instanceof Error ? err.message : String(err));
  }
}

/** SHARE TO PUBLISH an app INSTANCE (his order, 2026-10-07): the server
 *  promotes its pinned release by R2 key — nothing is read here. */
async function publishInstance(cardId: string, notes: string): Promise<{ version: number; status: string }> {
  const key = instanceKeyOfCardId(cardId);
  return getClient().http.post<{ version: number; status: string }>(`/api/app-instances/${encodeURIComponent(key)}/share`, { notes });
}

async function publish(skillId: string, notes: string): Promise<{ version: number; status: string }> {
  if (isInstanceCardId(skillId)) return publishInstance(skillId, notes);
  const skill = getSkill(skillId);
  const files: Record<string, string> = {};
  let bytes = 0;
  for (const f of skill.files) {
    const r = readSkillFile(skillId, f.path);
    if (r.binary) throw new Error(`"${f.path}" is binary — the hub carries text files only (put assets behind a URL)`);
    bytes += Buffer.byteLength(r.text);
    if (bytes > 900_000) throw new Error("this skill's files exceed the hub's 1 MB text limit");
    files[f.path] = r.text;
  }
  const { body } = parseSkillMd(files["SKILL.md"] || "");
  const slug = skill.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "skill";
  const r = await getClient().http.post<{ version: number; status: string }>(`/api/library/${kindOfId(skillId)}/promote`, {
    slug, name: skill.name, description: skill.description, notes, payload: { files, prompt: body, manifest: skill.frontmatter },
  });
  return r;
}

/** The hub versions behind a local skill: the org item whose slug is the
 *  folder's name. "current" is the disk; these are the immutable shares. */
interface VersionRow { version: number; notes: string; createdAt: string; status: string; reviewSummary: string; decisionNote?: string }

/** The slug + name a page id stands for on the hub: a folder's, or an instance's. */
async function hubIdentity(skillId: string): Promise<{ slug: string; name: string; kind: Kind }> {
  if (isInstanceCardId(skillId)) {
    const inst = await findInstance(instanceKeyOfCardId(skillId));
    if (!inst) throw new Error(`no app instance ${instanceKeyOfCardId(skillId)}`);
    return { slug: inst.slug, name: String(inst.manifest?.name || inst.slug), kind: "app" };
  }
  const skill = getSkill(skillId);
  return { slug: skill.id.slice(skill.id.indexOf(":") + 1), name: skill.name, kind: kindOfId(skillId) };
}

/** A hub version as the Publish tab reads it: standing, notes, the reviewer's note, the manifest version it carried. */
export interface HubVersionView { version: number; notes: string; createdAt: string; status: string; reviewSummary: string; decisionNote: string; manifestVersion: string | null }

async function versionsFor(skillId: string): Promise<{ itemId: string | null; kind: Kind; versions: VersionRow[]; head: number | null; pending: number | null; declined: { version: number; summary: string } | null; changes: { version: number; note: string } | null; lifecycle: string; lifecycleNote: string; visibility: string; own: boolean; categories: string[] }> {
  const { slug, name, kind } = await hubIdentity(skillId);
  const items = await getClient().http.get<OrgItem[]>(`/api/library/${kind}`).catch(() => [] as OrgItem[]);
  const item = (Array.isArray(items) ? items : []).find((it) => it.slug === slug || it.name === name) as (OrgItem & { pendingVersion?: number | null; changesVersion?: number | null; decisionNote?: string; lifecycle?: string; lifecycleNote?: string; createdBy?: string | null }) | undefined;
  if (!item) return { itemId: null, kind, versions: [], head: null, pending: null, declined: null, changes: null, lifecycle: "live", lifecycleNote: "", visibility: "org", own: false, categories: [] };
  type Raw = { version: number; notes: string; created_at: string; status?: string; review_summary?: string | null; decision_note?: string | null };
  const rows = await getClient().http.get<Raw[]>(`/api/library/${kind}/${encodeURIComponent(item.id)}/versions`).catch(() => [] as Raw[]);
  const list: VersionRow[] = (Array.isArray(rows) ? rows : []).map((r) => ({
    version: r.version, notes: r.notes || "", createdAt: r.created_at,
    status: r.status || "approved", reviewSummary: r.review_summary || "", decisionNote: r.decision_note || "",
  }));
  // A DECLINE IS NEWS (his order, 2026-09-17): the author could see a pending
  // share but never a rejected one, so a declined skill looked like one nobody
  // had opened yet. The newest rejected version counts only while nothing
  // newer was approved or is still waiting.
  const newest = list[0];
  const declined = newest && newest.status === "rejected"
    ? { version: newest.version, summary: newest.reviewSummary }
    : null;
  const changesRow = list.find((v) => v.status === "changes");
  const me = getActiveUserId() || "";
  return {
    itemId: item.id,
    kind,
    versions: list,
    declined,
    // What the SHARE actually did: the live version on the org's hub, and the
    // one still sitting on the review desk.
    head: item.headVersion ?? null,
    pending: item.pendingVersion ?? null,
    // CHANGES REQUESTED is a standing of its own (his order, 2026-10-07).
    changes: item.changesVersion ? { version: item.changesVersion, note: changesRow?.decisionNote || item.decisionNote || "" } : null,
    lifecycle: item.lifecycle || "live",
    lifecycleNote: item.lifecycleNote || "",
    visibility: item.visibility || "org",
    own: !!me && item.createdBy === me,
    categories: Array.isArray((item as { categories?: unknown }).categories) ? ((item as { categories: string[] }).categories) : [],
  };
}

// ── THE REVIEW THREAD, THE LIFECYCLE, THE PUBLIC LANE, THE DESK (2026-10-07) ──

/** The version id a hub item's version number stands for (the thread hangs on the id). */
async function versionIdOf(kind: Kind, itemId: string, version: number): Promise<string> {
  const rows = await getClient().http.get<Array<{ id?: string; version: number }>>(`/api/library/${kind}/${encodeURIComponent(itemId)}/versions`).catch(() => []);
  const hit = (Array.isArray(rows) ? rows : []).find((r) => r.version === version && r.id);
  if (hit?.id) return hit.id;
  // The list carries no ids for the author: the head route names the one on the desk.
  const head = await getClient().http.get<{ versionId: string | null }>(`/api/library/${kind}/${encodeURIComponent(itemId)}/head`).catch(() => ({ versionId: null }));
  if (!head?.versionId) throw new Error(`no version ${version} to open a thread on`);
  return head.versionId;
}

export interface CommentThread { versionId: string; itemId: string; kind: string; version: number; status: string; decisionNote: string; priorVersionId: string | null; comments: Array<{ id: string; by: string; author: string; body: string; createdAt: string | null; verdict?: string | null }> }
async function commentsFor(ref: { versionId?: string; kind?: string; itemId?: string; version?: number }): Promise<CommentThread> {
  const vid = ref.versionId || await versionIdOf(kindOf(ref.kind), String(ref.itemId || ""), Number(ref.version || 0));
  return getClient().http.get<CommentThread>(`/api/library/versions/${encodeURIComponent(vid)}/comments`);
}
async function commentAdd(versionId: string, body: string): Promise<CommentThread["comments"][number]> {
  return getClient().http.post<CommentThread["comments"][number]>(`/api/library/versions/${encodeURIComponent(versionId)}/comments`, { body });
}
async function setLifecycle(kind: Kind, itemId: string, state: "live" | "retired" | "removed", note: string): Promise<{ lifecycle: string; lifecycleNote: string }> {
  return getClient().http.post<{ lifecycle: string; lifecycleNote: string }>(`/api/library/${kind}/${encodeURIComponent(itemId)}/lifecycle`, { state, ...(note ? { note } : {}) });
}
async function submitPublic(kind: Kind, itemId: string, notes: string): Promise<unknown> {
  return getClient().http.post(`/api/library/${kind}/${encodeURIComponent(itemId)}/public`, { notes });
}
async function withdrawPublic(kind: Kind, itemId: string): Promise<unknown> {
  return getClient().http.del(`/api/library/${kind}/${encodeURIComponent(itemId)}/public`);
}
/** The org admin's desk: every version waiting (pending or changes), raw rows as the server spells them. */
export interface QueueRow { id: string; kind: string; entity_id: string; version: number; status: string; notes: string; decision_note: string; slug: string; name: string; submitted_by: string | null; submitted_by_name?: string | null; created_at: string; review_verdict?: string | null }
async function reviewQueue(): Promise<QueueRow[]> {
  const rows = await getClient().http.get<QueueRow[]>("/api/library/queue");
  return Array.isArray(rows) ? rows : [];
}
async function decideVersion(versionId: string, verdict: "approve" | "changes" | "reject", note: string): Promise<{ id: string; status: string; version: number; note: string }> {
  return getClient().http.post<{ id: string; status: string; version: number; note: string }>(`/api/library/versions/${encodeURIComponent(versionId)}/decide`, { verdict, note });
}
async function versionPayloadFiles(versionId: string): Promise<Record<string, string>> {
  const v = await getClient().http.get<{ payload?: Record<string, unknown> }>(`/api/library/versions/${encodeURIComponent(versionId)}`);
  const p = v?.payload && typeof v.payload === "object" ? v.payload : {};
  const files = p.files && typeof p.files === "object" ? (p.files as Record<string, string>) : null;
  return files ?? { "SKILL.md": typeof p.prompt === "string" ? p.prompt : "" };
}

/** One hub version's files, for read-only viewing beside the disk copy. */
async function versionFiles(itemId: string, version: number, kind: Kind): Promise<Record<string, string>> {
  const payload = await getClient().http.get<Record<string, unknown>>(`/api/library/${kind}/${encodeURIComponent(itemId)}/payload?version=${version}`);
  const files = payload && typeof payload.files === "object" && payload.files ? (payload.files as Record<string, string>) : null;
  if (files) return files;
  return { "SKILL.md": typeof payload?.prompt === "string" ? payload.prompt : "" };
}

/** A hub item's folder as files, for the Discover detail view (read-only). */
async function hubFiles(ref: string, kind: Kind): Promise<Record<string, string>> {
  const [from, id] = ref.split(":", 2) as ["org" | "glyphh", string];
  const base = from === "org" ? `/api/library/${kind}/${encodeURIComponent(id)}` : `/api/hub/public/${encodeURIComponent(id)}`;
  const payload = await getClient().http.get<Record<string, unknown>>(`${base}/payload`);
  return filesFromHubPayload("skill", "", payload && typeof payload === "object" ? payload : {});
}

async function categories(): Promise<Array<{ id: string; label: string }>> {
  const r = await getClient().http.get<Array<{ id: string; label: string }>>("/api/hub/categories").catch(() => []);
  return Array.isArray(r) ? r : [];
}

export function registerHubIpc(): void {
  // A removed folder tells the hub it is gone (skills-fs owns the delete).
  setInstallForgetter((id) => { void forget(id); });
  ipcMain.handle("hub-categories", () => env(categories));
  ipcMain.handle("skill-hub-files", (_e, ref: string, kind?: string) => env(() => hubFiles(String(ref), kindOf(kind))));
  ipcMain.handle("skill-versions", (_e, id: string) => env(() => versionsFor(String(id))));
  ipcMain.handle("skill-version-files", (_e, itemId: string, version: number, kind?: string) => env(() => versionFiles(String(itemId), Number(version), kindOf(kind))));
  ipcMain.handle("platform-url", (_e, next?: string) => env(async () => ({ url: await platformUrl(typeof next === "string" && next.startsWith("/ui/") ? next : "/ui/") })));
  ipcMain.handle("skills-discover", (_e, kind?: string | string[]) => env(() => discover(kindsOf(kind))));
  ipcMain.handle("skill-install", (_e, ref: string, kind?: string) => env(() => install(String(ref), kindOf(kind))));
  ipcMain.handle("skill-updates", () => env(updatesAvailable));
  ipcMain.handle("skill-standings", () => env(standings));
  ipcMain.handle("skill-shares", () => env(shareStates));
  ipcMain.handle("skill-withdraw", (_e, id: string) => env(() => withdrawShare(String(id))));
  // The shelves a shared bundle sits on. Promote guesses them from the payload;
  // this is how a person corrects the guess without leaving the app.
  ipcMain.handle("skill-categories-set", (_e, itemId: string, kind: string, ids: unknown) => env(async () => {
    const categories = Array.isArray(ids) ? ids.map(String).filter(Boolean) : [];
    await getClient().http.post(`/api/library/${kindOf(kind)}/${encodeURIComponent(String(itemId))}/categories`, { categories });
    return categories;
  }));
  ipcMain.handle("skill-update", (_e, id: string) => env(() => update(String(id))));
  ipcMain.handle("skill-publish", (_e, id: string, notes?: string) => env(() => publish(String(id), String(notes ?? ""))));
  // THE REVIEW THREAD, THE LIFECYCLE, THE PUBLIC LANE, THE DESK (2026-10-07;
  // punch list 7, 16, 18). The web answers the same names (member-library-web.js).
  ipcMain.handle("skill-comments", (_e, ref: { versionId?: string; kind?: string; itemId?: string; version?: number }) => env(() => commentsFor(ref && typeof ref === "object" ? ref : {})));
  ipcMain.handle("skill-comment-add", (_e, versionId: string, body: string) => env(() => commentAdd(String(versionId), String(body ?? ""))));
  ipcMain.handle("skill-lifecycle", (_e, itemId: string, kind: string, state: string, note?: string) => env(() => setLifecycle(kindOf(kind), String(itemId), state === "retired" || state === "removed" ? state : "live", String(note ?? ""))));
  ipcMain.handle("skill-submit-public", (_e, itemId: string, kind: string, notes?: string) => env(() => submitPublic(kindOf(kind), String(itemId), String(notes ?? ""))));
  ipcMain.handle("skill-withdraw-public", (_e, itemId: string, kind: string) => env(() => withdrawPublic(kindOf(kind), String(itemId))));
  ipcMain.handle("library-queue", () => env(reviewQueue));
  ipcMain.handle("library-decide", (_e, versionId: string, verdict: string, note?: string) => env(() => decideVersion(String(versionId), verdict === "approve" || verdict === "changes" || verdict === "reject" ? verdict : "changes", String(note ?? ""))));
  ipcMain.handle("library-version-files", (_e, versionId: string) => env(() => versionPayloadFiles(String(versionId))));
}
