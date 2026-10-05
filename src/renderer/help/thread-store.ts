/**
 * thread-store.ts — ONE session store over the SERVER THREADS SURFACE, on both
 * surfaces (the harness thread routes on web, main's IPC on desktop).
 *
 * The server is the source of truth; the surface's existing local persistence
 * is the OFFLINE CACHE (write-through):
 *   • web      — CLOUD threads live in the server's harness thread store
 *                (`/api/harness/threads[/:id]`, help/harness-api.ts); a thread
 *                bound to an attached DESKTOP lives on that machine and is
 *                read/written over the relay (`sessions.*`, as the mobile app
 *                does — web/src/desktop-sessions.ts). The cache is
 *                web-contract.js's per-user localStorage entry.
 *   • desktop  — server calls go through four thin IPC methods (threadsList/
 *                Get/Push/Delete → the MAIN-process SDK client, per the
 *                architecture law); the cache is main's sessions.json file.
 *
 * Sync is Last-Write-Wins on `updatedAt` (epoch ms, stamped `Date.now()` when
 * content changes): a push applies only when strictly newer than the server's
 * copy; equal stamps are replay no-ops, so the one-time cache→server migration
 * on first boot never repeats. Deletes tombstone (server-side + a local
 * `deleted` map so an offline delete still lands). Boot hydration pulls the
 * thread LIST and reconciles both directions; the same reconcile then re-runs
 * every 60s and on window focus/visible, so another surface's deletes/renames
 * reach this rail without a reboot. Message BODIES fetch lazily on open
 * (ensureMessages). Server unreachable → cache-only mode with ONE quiet
 * console.warn; queued pushes retry on the next reconcile pass.
 *
 * The renderer cannot import from @glyphh/sdk (preload boundary), so the SDK
 * handle's thread shapes are mirrored structurally below (remote-run.ts's
 * discipline).
 */

import { harnessRequest, HarnessHttpError } from "./harness-api.js";
import { threadLocus, healSource } from "./thread-locus.js";
import { boundMessages, adoptServerMessages } from "./bound-messages.js";

// ── Shapes ────────────────────────────────────────────────────────────────

/** The store's structural view of a chat — code.ts's CodeChat satisfies it.
 *  `updatedAt` is the LWW clock; `messageCount` marks a lazily-adopted thread
 *  whose bodies haven't been fetched yet. Local-only fields (workdir, pinned,
 *  runtime) stay on the caller's richer type: cached verbatim, never pushed. */
export interface ThreadChat {
  id: string;
  title: string;
  createdAt: number;
  messages: unknown[];
  mode?: "work" | "code" | /** legacy stamps (help/code.ts modeOf folds them to Work) */ "chat" | "cowork";
  source?: unknown;
  updatedAt?: number;
  messageCount?: number;
}

interface ThreadMeta {
  id: string; title: string; mode: string; source: unknown;
  createdAt: number; updatedAt: number; messageCount: number;
}
interface ThreadFull extends ThreadMeta { messages: unknown[] }
interface PushBody { title?: string; mode?: string; source?: unknown; messages?: unknown[]; updatedAt: number }
interface PushResult { applied: boolean; thread: ThreadMeta }

interface Transport {
  list(): Promise<ThreadMeta[]>;
  get(id: string): Promise<ThreadFull>;
  push(id: string, body: PushBody): Promise<PushResult>;
  del(id: string): Promise<void>;
}

// ── Transport (per surface) ───────────────────────────────────────────────

interface DesktopThreadsIpc {
  threadsList?: () => Promise<ThreadMeta[]>;
  threadsGet?: (id: string) => Promise<ThreadFull>;
  threadsPush?: (id: string, body: PushBody) => Promise<PushResult>;
  threadsDelete?: (id: string) => Promise<void>;
}

/** The SDK attach surface (window.glyphhSdk.attach) — the member's machines
 *  with remote control on, each answering `sessions.*` over the relay. Mirrors
 *  web/src/desktop-sessions.ts (the mobile app's copy of the same lane). */
interface AttachMachine { id: string; name?: string; app?: string; folders?: string[] }
interface AttachSurface {
  status(): Promise<{ allowed?: boolean; attached?: boolean; machines?: AttachMachine[] }>;
  dispatch<T>(method: string, params?: Record<string, unknown>, opts?: { machineId?: string }): Promise<T>;
}
const attachSurface = (): AttachSurface | null =>
  (window as unknown as { glyphhSdk?: { attach?: AttachSurface } }).glyphhSdk?.attach ?? null;

/** The attached desktops as the last list() saw them — id, name and the
 *  folders each GRANTED for remote control. The rail reads this to tell a
 *  desktop session it may open from one whose folder needs a grant (his
 *  order, 2026-10-04: list EVERY local session, lock the ungranted ones). */
let attachedSnapshot: Array<{ id: string; name: string; folders: string[] }> = [];
export function attachedMachines(): ReadonlyArray<{ id: string; name: string; folders: string[] }> { return attachedSnapshot; }

/** Which MACHINE each desktop-relay thread lives on (from the last list()). A
 *  machine's id changes on every reconnect, so this is refreshed per list. */
const desktopHome = new Map<string, string>();
const isDesktopThread = (id: string): boolean => {
  if (desktopHome.has(id)) return true;
  const c = chatsRef.find((x) => x.id === id);
  const src = c?.source as { kind?: string; machineId?: string } | undefined;
  return !!src && src.kind === "local" && !!src.machineId;
};
const desktopOpts = (id: string): { machineId?: string } => {
  const m = desktopHome.get(id);
  if (m) return { machineId: m };
  const src = chatsRef.find((x) => x.id === id)?.source as { machineId?: string } | undefined;
  return src?.machineId ? { machineId: src.machineId } : {};
};

/**
 * WEB: the server's harness thread store for CLOUD threads
 * (`/api/harness/threads[/:id]`, LWW on updatedAt — help/harness-api.ts lists
 * the routes), plus the member's attached DESKTOPS for machine-bound threads
 * (`sessions.list/get/put/delete` over the relay — the machine owns those
 * threads and writes a relayed turn's messages itself). One Transport, routed
 * per thread by where it lives.
 */
function webTransport(): Transport {
  const desktopList = async (): Promise<ThreadMeta[]> => {
    const a = attachSurface();
    if (!a) return [];
    const st = await a.status().catch(() => null);
    const machines = st?.attached ? (st.machines ?? []) : [];
    attachedSnapshot = machines.map((m) => ({ id: m.id, name: m.name || m.app || "", folders: Array.isArray(m.folders) ? m.folders.filter((f): f is string => typeof f === "string") : [] }));
    // EVERY session the desktop holds lists here (his order, 2026-10-04) —
    // `sessions.list` is not folder-guarded (remote-control.ts passes it
    // through); the grant applies when a session is OPENED or RUN, which the
    // rail enforces with the snapshot above and the relay's own guard.
    const lists = await Promise.all(machines.map(async (m) => {
      const r = await a.dispatch<{ sessions?: ThreadMeta[] }>("sessions.list", {}, { machineId: m.id }).catch(() => null);
      return (r?.sessions ?? []).map((t) => ({
        ...t,
        source: { ...((t.source as object | null) ?? {}), kind: "local", machineId: m.id, machineName: m.name || m.app || "" },
      }));
    }));
    const all = lists.flat();
    desktopHome.clear();
    for (const t of all) {
      const mid = (t.source as { machineId?: string }).machineId;
      if (mid) desktopHome.set(t.id, mid);
    }
    return all;
  };
  return {
    list: async () => {
      // The harness answer is the one that can be OFFLINE (reconcile's
      // cache-only mode); a machine that is off simply lists nothing.
      const cloud = await harnessRequest<ThreadMeta[]>("GET", "/threads");
      const desktop = await desktopList();
      return [...(Array.isArray(cloud) ? cloud : []), ...desktop];
    },
    get: async (id) => {
      if (isDesktopThread(id)) {
        const a = attachSurface();
        if (!a) throw new HarnessHttpError(503, "no attached desktop");
        const r = await a.dispatch<{ session?: ThreadFull }>("sessions.get", { id }, desktopOpts(id));
        if (!r?.session) throw new HarnessHttpError(404, "thread not on the desktop");
        return { ...r.session, messages: r.session.messages ?? [] };
      }
      return harnessRequest<ThreadFull>("GET", `/threads/${encodeURIComponent(id)}`);
    },
    push: async (id, body) => {
      if (isDesktopThread(id)) {
        const a = attachSurface();
        if (!a) throw new HarnessHttpError(503, "no attached desktop");
        // Title / type only: the machine's own store holds the messages.
        await a.dispatch("sessions.put", {
          id,
          ...(body.title ? { title: body.title } : {}),
          ...(body.mode ? { mode: body.mode } : {}),
        }, desktopOpts(id));
        const c = chatsRef.find((x) => x.id === id);
        return {
          applied: true,
          thread: { id, title: body.title ?? c?.title ?? "", mode: body.mode ?? "", source: body.source ?? null, createdAt: c?.createdAt ?? body.updatedAt, updatedAt: body.updatedAt, messageCount: body.messages?.length ?? c?.messages.length ?? 0 },
        };
      }
      try {
        return await harnessRequest<PushResult>("PUT", `/threads/${encodeURIComponent(id)}`, body);
      } catch (err) {
        // 409 `stale`: the stored copy is NEWER — another surface won. Not an
        // outage: answer "not applied" with the server's meta so pushOne marks
        // a reconcile (which adopts it) instead of re-queueing forever.
        if (err instanceof HarnessHttpError && err.httpStatus === 409) {
          const theirs = await harnessRequest<ThreadMeta>("GET", `/threads/${encodeURIComponent(id)}`);
          return { applied: false, thread: theirs };
        }
        throw err;
      }
    },
    del: async (id) => {
      if (isDesktopThread(id)) {
        const a = attachSurface();
        if (!a) throw new HarnessHttpError(503, "no attached desktop");
        await a.dispatch("sessions.delete", { id }, desktopOpts(id));
        desktopHome.delete(id);
        // THE SERVER'S COPY GOES TOO (his report, 2026-10-05: deleting over the
        // relay "is not working" — the session came back). The desktop had
        // published the thread to the index, and its own tombstone lands later
        // and best-effort, so the next list adopted the copy right back. A 404
        // means it was never there, or is already gone.
        await harnessRequest<void>("DELETE", `/threads/${encodeURIComponent(id)}`).catch((err) => {
          if ((err as { httpStatus?: number })?.httpStatus === 404) return;
          throw err;
        });
        return;
      }
      await harnessRequest<void>("DELETE", `/threads/${encodeURIComponent(id)}`);
    },
  };
}

/** Web target → the harness + desktop-relay transport; desktop → the
 *  main-process client over IPC. Order matters: on web `window.glyphh` is a
 *  Proxy that fabricates a function for ANY name, so the surface marker is
 *  checked first. */
/** On the DESKTOP a LOCAL thread belongs to main: its file is the truth and
 *  main's publisher mirrors it to the server (thread-publish.ts). This store
 *  neither pushes such a thread nor pulls the server's copy over it — doing
 *  both while main appended was the loop that doubled every thread on every
 *  pass (his report, 2026-10-04). Cloud threads and the web keep the LWW rule. */
const ownedByMain = (c: ThreadChat): boolean =>
  !(window as unknown as { __GLYPHH_WEB__?: boolean }).__GLYPHH_WEB__ && threadLocus(c) === "local";

function transport(): Transport | null {
  if ((window as unknown as { __GLYPHH_WEB__?: boolean }).__GLYPHH_WEB__) return webTransport();
  const g = window.glyphh as unknown as DesktopThreadsIpc;
  if (typeof g?.threadsList === "function") {
    return {
      list: () => g.threadsList!(),
      get: (id) => g.threadsGet!(id),
      push: (id, body) => g.threadsPush!(id, body),
      del: (id) => g.threadsDelete!(id),
    };
  }
  return null;
}

// ── Cache layer (the surface's existing persistence, write-through) ───────

async function cacheLoad(): Promise<{ chats: ThreadChat[]; currentId: string }> {
  try {
    const s = await window.glyphh.glyphhSessionsLoad?.();
    // A chat this window deleted stays deleted, whatever the file says.
    return { chats: ((s?.chats as ThreadChat[]) || []).filter((c) => deleted[c.id] === undefined), currentId: String(s?.currentId || "") };
  } catch { return { chats: [], currentId: "" }; }
}
async function cacheSave(): Promise<void> {
  // TOMBSTONES RIDE ALONG (his report, 2026-09-21: a deleted chat came back
  // after a restart): the shared file merges by id and keeps chats this
  // window does not carry, so a delete has to be said, not implied.
  try { await window.glyphh.glyphhSessionsSave?.(chatsRef, currentIdRef, Object.keys(deleted)); }
  catch { /* cache write failure never breaks the UI — the server copy stands */ }
}

// ── Sync bookkeeping (tombstones + push queue, survives reloads) ──────────

const META_KEY = "glyphhThreadSync";
interface SyncMeta { deleted: Record<string, number>; pending: string[]; serverSeen?: string[] }
function loadMeta(): void {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) || "{}") as Partial<SyncMeta>;
    deleted = m.deleted && typeof m.deleted === "object" ? m.deleted : {};
    pending = new Set(Array.isArray(m.pending) ? m.pending : []);
    serverSeen = new Set(Array.isArray(m.serverSeen) ? m.serverSeen : []);
  } catch { deleted = {}; pending = new Set(); serverSeen = new Set(); }
}
function saveMeta(): void {
  try { localStorage.setItem(META_KEY, JSON.stringify({ deleted, pending: [...pending], serverSeen: [...serverSeen] })); }
  catch { /* meta is best-effort — reconcile rebuilds it from stamps */ }
}

// ── State ─────────────────────────────────────────────────────────────────

let chatsRef: ThreadChat[] = [];
let currentIdRef = "";
/** id → last-synced content projection; a differing projection = a real edit
 *  (stamp + queue). Seeded on reconcile so boot never re-pushes unchanged. */
const snapshot = new Map<string, string>();
const pushTimers = new Map<string, number>();
let pending = new Set<string>();
let deleted: Record<string, number> = {};
/** Ids the SERVER has actually returned at least once (server-origin). Lets reconcile
 *  tell a REMOTELY-DELETED thread (was here, now gone) from a never-synced local one:
 *  the former must be dropped locally, the latter pushed. Persisted so it survives reloads. */
let serverSeen = new Set<string>();
let offlineWarned = false;
let needsReconcile = false;
let hydrated: Promise<{ chats: ThreadChat[]; currentId: string }> | null = null;
let onChangeCb: (() => void) | null = null;
/** Bodies being fetched / recently failed (30s backoff) — repaint-safe. */
const bodyInflight = new Set<string>();
const bodyFailedAt = new Map<string, number>();

const PUSH_DEBOUNCE_MS = 1500;
const RETRY_MS = 60_000;
const BODY_RETRY_MS = 30_000;

/** A THREAD'S TYPE, as this build knows them (his order, 2026-09-29: two types,
 *  Work and Code). `work` was missing from this guard, so a thread the server
 *  handed back arrived stamped `code` and a Work session moved tabs behind the
 *  user's back. The legacy `chat`/`cowork` stamps still ride through; help/code
 *  folds them to Work. */
const isMode = (m: unknown): m is NonNullable<ThreadChat["mode"]> =>
  m === "work" || m === "code" || m === "chat" || m === "cowork";
const stampOf = (c: ThreadChat): number => c.updatedAt ?? c.createdAt;
const modeOf = (c: ThreadChat): string => c.mode ?? ((c as { chat?: boolean }).chat ? "chat" : "code");
/** The content that syncs — title/mode/source/messages (local-only fields excluded). */
const projection = (c: ThreadChat): string =>
  JSON.stringify({ t: c.title, m: modeOf(c), s: c.source ?? null, msgs: c.messages });

function warnOffline(err: unknown): void {
  if (offlineWarned) return;
  offlineWarned = true;
  console.warn("[thread-store] server unreachable — sessions running from the local cache:",
    err instanceof Error ? err.message : String(err));
}

/** Repaint hook — fired when a reconcile/lazy fetch changed the shared array. */
export function onRemoteChange(cb: () => void): void { onChangeCb = cb; }

// ── Hydrate (boot) ────────────────────────────────────────────────────────

/** Load the cache, reconcile against the server thread list (LWW, both
 *  directions), and return the live { chats, currentId } — code.ts keeps
 *  mutating that same array; persist() writes it back through. */
export function hydrate(): Promise<{ chats: ThreadChat[]; currentId: string }> {
  if (!hydrated) {
    hydrated = (async () => {
      loadMeta();
      const cached = await cacheLoad();
      chatsRef = cached.chats;
      currentIdRef = cached.currentId;
      await reconcile();
      wireLifecycle();
      return { chats: chatsRef, currentId: currentIdRef };
    })();
  }
  return hydrated;
}

/** Full two-way LWW reconcile. Offline-tolerant: any failure leaves the cache
 *  standing, marks needsReconcile, and the 60s timer retries. */
async function reconcile(): Promise<void> {
  const t = transport();
  if (!t) { needsReconcile = true; return; }
  let serverList: ThreadMeta[];
  try {
    serverList = await t.list();
    offlineWarned = false;
  } catch (err) {
    warnOffline(err);
    needsReconcile = true;
    return;
  }
  needsReconcile = false;
  let changed = false;

  // Tombstoned-here deletes land first — a delete made offline still wins.
  for (const id of Object.keys(deleted)) {
    try { await t.del(id); delete deleted[id]; }
    catch (err) {
      if ((err as { httpStatus?: number })?.httpStatus === 404) { delete deleted[id]; continue; }
      needsReconcile = true;
    }
  }

  // A flipped record already in the cache heals too (his report, 2026-10-05).
  for (const c of chatsRef) {
    const healed = healSource(c.source);
    if (healed === c.source) continue;
    c.source = healed;
    const w = c as { workdir?: unknown };
    if (typeof w.workdir === "string" && w.workdir.startsWith("/data/glyphh-harness/")) delete w.workdir;
  }
  const serverById = new Map(serverList.map((m) => [m.id, m]));
  for (const m of serverList) {
    serverSeen.add(m.id); // server-origin — lets us detect a later REMOTE deletion
    if (deleted[m.id] !== undefined) continue;
    const local = chatsRef.find((c) => c.id === m.id);
    if (!local) {
      // Unknown thread from another surface — adopt metadata, bodies lazy.
      const adopted: ThreadChat = {
        id: m.id, title: m.title, createdAt: m.createdAt, updatedAt: m.updatedAt,
        mode: isMode(m.mode) ? m.mode : "code",
        messages: [], messageCount: m.messageCount,
      };
      if (m.source != null) adopted.source = healSource(m.source);
      chatsRef.push(adopted);
      snapshot.set(m.id, projection(adopted)); // stub is "synced" — an empty-body save must never push over the server's messages
      changed = true;
    } else if (ownedByMain(local)) {
      // Main's file is the truth and main publishes it: never adopt, never push.
      pending.delete(m.id);
      snapshot.set(m.id, projection(local));
    } else {
      const localStamp = stampOf(local);
      if (m.updatedAt > localStamp) {
        // Server strictly newer → adopt (meta now, bodies eagerly — this
        // thread has local history on screen paths; keep local on a miss).
        local.title = m.title;
        if (isMode(m.mode)) local.mode = m.mode;
        // THE LOCUS IS FIXED AT BIRTH (his rule, 2026-10-04): a server copy
        // may refresh a born session's source only if it keeps the locus — a
        // cloud session never becomes a desktop one by adoption, whatever
        // another surface pushed (his report, 2026-10-05).
        if (m.source != null && (local.messages.length === 0 || threadLocus({ source: m.source }) === threadLocus(local))) local.source = healSource(m.source);
        local.updatedAt = m.updatedAt;
        local.messageCount = m.messageCount;
        try {
          const full = await t.get(m.id);
          local.messages = adoptServerMessages(local.messages, full.messages);
          local.messageCount = local.messages.length;
        } catch (err) { warnOffline(err); needsReconcile = true; }
        pending.delete(m.id);
        snapshot.set(m.id, projection(local));
        changed = true;
      } else if (localStamp > m.updatedAt) {
        pending.add(m.id);            // cache newer → push (drained below)
        snapshot.set(m.id, projection(local));
      } else {
        pending.delete(m.id);         // in sync — replay no-op territory
        snapshot.set(m.id, projection(local));
      }
    }
  }
  // A cached thread the server no longer returns is EITHER a REMOTE deletion (it was
  // server-known → drop it locally, never resurrect) OR a never-synced local thread
  // (the desktop's pre-cutover history → migration-push it once). Without this split, a
  // web-side delete was mistaken for a local thread and pushed back — resurrecting it.
  // AN EMPTY ANSWER IS NOT A DELETION (his report, 2026-09-29: a recent listed
  // in the rail did nothing when clicked — the row was painted from main's
  // shared file while this document's array no longer had the thread). The
  // desktop's thread channels are dead-ended in main today, so `list()` returns
  // `[]`; every previously-synced thread then looked remotely deleted and was
  // spliced out of the live array. A server that returns nothing has told us
  // nothing, so nothing is dropped on it.
  const remoteGone: string[] = [];
  for (const c of chatsRef) {
    if (serverById.has(c.id) || deleted[c.id] !== undefined) continue;
    if (serverList.length && serverSeen.has(c.id)) remoteGone.push(c.id); // deleted elsewhere → drop
    else if (ownedByMain(c)) snapshot.set(c.id, projection(c));           // main publishes it
    else { pending.add(c.id); snapshot.set(c.id, projection(c)); } // never synced → push
  }
  for (const id of remoteGone) {
    const idx = chatsRef.findIndex((c) => c.id === id);
    if (idx >= 0) { chatsRef.splice(idx, 1); changed = true; }
    snapshot.delete(id);
    serverSeen.delete(id);
    pending.delete(id);
    if (currentIdRef === id) currentIdRef = chatsRef[0]?.id ?? "";
  }
  saveMeta();
  if (changed) { await cacheSave(); onChangeCb?.(); }
  if (pending.size) await drainPending();
}

// ── Push path (LWW, debounced per thread) ─────────────────────────────────

async function pushOne(id: string): Promise<boolean> {
  const t = transport();
  if (!t) return false;
  const c = chatsRef.find((x) => x.id === id);
  if (!c || deleted[id] !== undefined || ownedByMain(c)) { pending.delete(id); saveMeta(); return true; }
  const body: PushBody = {
    title: c.title,
    mode: modeOf(c),
    source: c.source ?? null,
    messages: c.messages,
    updatedAt: stampOf(c),
  };
  try {
    const r = await t.push(id, body);
    offlineWarned = false;
    pending.delete(id);
    saveMeta();
    // Not applied + the server strictly newer → another surface won; adopt on
    // the next reconcile pass rather than mid-flight (no UI surprises).
    if (!r.applied && r.thread && r.thread.updatedAt > stampOf(c)) needsReconcile = true;
    return true;
  } catch (err) {
    warnOffline(err);
    pending.add(id);
    saveMeta();
    return false;
  }
}

async function drainPending(): Promise<void> {
  for (const id of [...pending]) {
    if (!(await pushOne(id))) return; // offline — the 60s timer retries the rest
  }
}

function schedulePush(id: string): void {
  const prior = pushTimers.get(id);
  if (prior !== undefined) clearTimeout(prior);
  pushTimers.set(id, window.setTimeout(() => {
    pushTimers.delete(id);
    void pushOne(id).then((ok) => { if (ok && pending.size) void drainPending(); });
  }, PUSH_DEBOUNCE_MS));
}

/** Push everything queued NOW (session switch, tab hide/close). */
export function flushNow(): Promise<void> {
  for (const timer of pushTimers.values()) clearTimeout(timer);
  pushTimers.clear();
  return drainPending();
}

// ── The write-through save (code.ts's saveStore internals) ────────────────

/** Persist chats+currentId: write-through to the cache, stamp+queue any thread
 *  whose synced content actually changed (debounced LWW push). */
export function persist(chats: ThreadChat[], currentId: string): Promise<void> {
  chatsRef = chats;
  const switched = currentId !== currentIdRef;
  currentIdRef = currentId;
  for (const c of chats) {
    const proj = projection(c);
    if (snapshot.get(c.id) !== proj) {
      c.updatedAt = Date.now();
      snapshot.set(c.id, proj);
      pending.add(c.id);
      delete deleted[c.id]; // a re-created id un-tombstones
      schedulePush(c.id);
    }
  }
  saveMeta();
  if (switched) void flushNow(); // the session being left lands before it blurs
  return cacheSave();
}

// ── Delete (tombstone) ────────────────────────────────────────────────────

/** Tombstone a thread: local meta at once, server delete best-effort (an
 *  offline delete stays tombstoned and lands on the next reconcile). The
 *  caller removes it from `chats` and persists as usual. */
export function remove(id: string): void {
  const timer = pushTimers.get(id);
  if (timer !== undefined) { clearTimeout(timer); pushTimers.delete(id); }
  pending.delete(id);
  snapshot.delete(id);
  deleted[id] = Date.now();
  saveMeta();
  const t = transport();
  if (!t) return;
  t.del(id)
    .then(() => { delete deleted[id]; saveMeta(); })
    .catch((err) => {
      // 404 = never reached the server (local-only) or already tombstoned:
      // the goal state holds, so retire the tombstone instead of retrying it
      // on every reconcile forever.
      if ((err as { httpStatus?: number })?.httpStatus === 404) { delete deleted[id]; saveMeta(); return; }
      warnOffline(err); needsReconcile = true;
    });
}

// ── Lazy message bodies ───────────────────────────────────────────────────

/** Fetch a lazily-adopted thread's messages (messageCount > 0, none loaded).
 *  Resolves true when messages arrived (caller repaints). Repaint-safe:
 *  in-flight de-dupe + 30s failure backoff. */
export async function ensureMessages(id: string): Promise<boolean> {
  const c = chatsRef.find((x) => x.id === id);
  if (!c || c.messages.length > 0 || !(typeof c.messageCount === "number" && c.messageCount > 0)) return false;
  // A desktop-local thread's transcript is main's file; empty here means
  // empty. The server's copy is a mirror and is never read back into it.
  if (ownedByMain(c)) return false;
  if (bodyInflight.has(id)) return false;
  const failed = bodyFailedAt.get(id);
  if (failed !== undefined && Date.now() - failed < BODY_RETRY_MS) return false;
  const t = transport();
  if (!t) return false;
  bodyInflight.add(id);
  try {
    const full = await t.get(id);
    c.messages = boundMessages(full.messages);
    c.title = full.title;
    c.updatedAt = full.updatedAt;
    c.messageCount = full.messages.length;
    snapshot.set(id, projection(c)); // fetched = synced; don't re-push it
    bodyFailedAt.delete(id);
    void cacheSave();
    return true;
  } catch (err) {
    warnOffline(err);
    bodyFailedAt.set(id, Date.now());
    return false;
  } finally {
    bodyInflight.delete(id);
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

let lifecycleWired = false;
let reconciling = false;
let lastReconcileAt = 0;
/** Re-entrancy-safe reconcile — the timer, focus wake, and retry paths can
 *  all fire while one is in flight; only one runs. */
async function safeReconcile(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try { await reconcile(); }
  finally { reconciling = false; lastReconcileAt = Date.now(); }
}

function wireLifecycle(): void {
  if (lifecycleWired) return;
  lifecycleWired = true;
  // The 60s timer reconciles UNCONDITIONALLY (metadata list only — cheap), not
  // just when this surface owes something: a session deleted or renamed on the
  // OTHER surface arrives through the same pass, so the rail stays live
  // without a reboot. onChangeCb repaints only when something actually moved.
  window.setInterval(() => { void safeReconcile(); }, RETRY_MS);
  // Focus/visible = the user's "refresh" gesture — coming back to the window
  // pulls the other surface's changes at once (10s floor so alt-tabbing
  // doesn't hammer the list endpoint).
  const wake = (): void => {
    if (Date.now() - lastReconcileAt > 10_000) void safeReconcile();
  };
  window.addEventListener("focus", wake);
  // Best-effort flush on close/hide — the cache already holds everything, so
  // a lost push simply re-queues from the stamps on the next boot's reconcile.
  const kick = (): void => { void flushNow(); };
  window.addEventListener("pagehide", kick);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) kick();
    else wake();
  });
}
