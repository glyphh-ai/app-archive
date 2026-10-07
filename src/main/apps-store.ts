/**
 * apps-store.ts — THE TAB ROWS, read from the server and held in memory.
 *
 * Until 2026-10-07 a tab was a folder on this machine
 * (~/.glyphh/<user>/apps/<slug>/tab.json) that the library sync kept level
 * with the server. His order that day ("why would we replicate down to the
 * local machine?"): the server is the only truth; the desktop keeps a RUNNING
 * COPY in memory for its synchronous readers (library-remote.ts primes it at
 * sign-in and refreshes it) and writes straight back. Nothing on disk.
 *
 * The API keeps the slice the desktop used (mine / readRow / createEntry /
 * updateEntry / removeEntry), so no call site moves.
 */
import { isTabRow } from "../shared/member-library.js";
import { remoteList, remotePut, remoteRemove } from "./library-remote.js";

/** The stored row — the fields org-apps' toRow() projection reads. */
export interface LocalAppRow {
  id: string;
  kind: "web" | "native" | "glyphh";
  slug: string;
  name: string;
  prodUrl: string | null;
  nativeRef: string | null;
  config: Record<string, unknown> | null;
  description: string;
  access: "public" | "members";
  owned: boolean;
  latestVersion: string | null;
  version: string;
  secretNames: string[];
  requiredConnections: { slug: string; actAs: string; connected: boolean }[];
  listing: null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEntryInput {
  kind: "web" | "native" | "glyphh";
  slug: string;
  name: string;
  url?: string;
  nativeRef?: string;
  description?: string;
  config?: Record<string, unknown>;
  access?: "public" | "members";
}

/** `url` / `nativeRef` take null to CLEAR them (a cloud instance's row keeps no local entry). */
export type UpdateEntryInput = Partial<Omit<CreateEntryInput, "slug" | "url" | "nativeRef">> & { url?: string | null; nativeRef?: string | null; secretNames?: string[] };

// ── The running copy ─────────────────────────────────────────────────────────
const rows = new Map<string, LocalAppRow>();
let primed = false;

/** Load (or reload) every tab row the server holds for this member. */
export async function primeTabs(): Promise<void> {
  const fresh = await remoteList<LocalAppRow>("tab");
  rows.clear();
  for (const r of fresh) {
    if (!isTabRow(r.data)) continue;
    const slug = r.id.toLowerCase();
    rows.set(slug, { ...r.data, slug, id: r.data.id || slug, updatedAt: new Date(r.updatedAt).toISOString() });
  }
  primed = true;
}

/** Announce a change the way main's own writes always did. */
async function announce(): Promise<void> {
  const [{ invalidateOrgApps }, { broadcast }] = await Promise.all([import("./org-apps.js"), import("./broadcast.js")]);
  invalidateOrgApps();
  broadcast("panel-apps-changed");
}

export function readRow(slug: string): LocalAppRow | null {
  return rows.get(slug.toLowerCase().trim()) ?? null;
}

/** Every tab row, from the running copy. */
export function mineSync(): LocalAppRow[] {
  return Array.from(rows.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Every tab row; the first call primes the copy from the server. */
export async function mine(): Promise<LocalAppRow[]> {
  if (!primed) { try { await primeTabs(); } catch { /* offline: the copy stands */ } }
  return mineSync();
}

export async function createEntry(input: CreateEntryInput): Promise<LocalAppRow> {
  const slug = input.slug.toLowerCase().trim();
  if (!slug) throw new Error("an app needs a slug");
  if (readRow(slug)) throw new Error(`an app named "${slug}" already exists`);
  const now = new Date().toISOString();
  const row: LocalAppRow = {
    id: slug,
    kind: input.kind,
    slug,
    name: input.name || slug,
    prodUrl: input.url ?? null,
    nativeRef: input.nativeRef ?? null,
    config: input.config ?? null,
    description: input.description ?? "",
    access: input.access === "public" ? "public" : "members",
    owned: true,
    latestVersion: null,
    version: "0.1.0",
    secretNames: [],
    requiredConnections: [],
    listing: null,
    createdAt: now,
    updatedAt: now,
  };
  await remotePut("tab", slug, row);
  rows.set(slug, row);
  void announce();
  return row;
}

export async function updateEntry(slug: string, patch: UpdateEntryInput): Promise<LocalAppRow> {
  const row = readRow(slug);
  if (!row) throw new Error(`app "${slug}" not found`);
  const next = { ...row };
  if (patch.name !== undefined) next.name = String(patch.name);
  if (patch.url !== undefined) next.prodUrl = patch.url ?? null;
  if (patch.nativeRef !== undefined) next.nativeRef = patch.nativeRef ?? null;
  if (patch.description !== undefined) next.description = String(patch.description);
  if (patch.config !== undefined) next.config = patch.config ?? null;
  if (patch.access !== undefined) next.access = patch.access === "public" ? "public" : "members";
  if (patch.kind !== undefined) next.kind = patch.kind;
  if (patch.secretNames !== undefined) next.secretNames = patch.secretNames.map(String);
  next.updatedAt = new Date().toISOString();
  await remotePut("tab", next.slug, next);
  rows.set(next.slug, next);
  void announce();
  return next;
}

/** Delete the tab row on the server; the running copy drops it. */
export async function removeEntry(slug: string): Promise<void> {
  const key = slug.toLowerCase().trim();
  await remoteRemove("tab", key);
  rows.delete(key);
  void announce();
}
