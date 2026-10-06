/**
 * thread-publish.ts — THE DESKTOP'S THREADS ON THE SERVER (his rule,
 * 2026-10-04: database-as-truth for the library AND the chats).
 *
 * The local chat store (agent-ipc.ts, `agent-sessions.json`) is what every
 * desktop surface writes through. After each write this module publishes, per
 * LOCAL thread (threadLocus "local" — a cloud thread's transcript is the pod's
 * and its metadata is pushed by the renderer's thread-store over the same
 * IPC):
 *
 *   · the INDEX — `sessions.pushThread(id, { title, mode, source, updatedAt })`,
 *     the source stamped `kind: "local", locus: "local"`; sent only when the
 *     metadata moved (a signature per thread), never with messages;
 *   · the TRANSCRIPT — `sessions.appendMessages(id, { messages, updatedAt })`
 *     for the messages after a per-thread `syncedUpTo` count, so a turn is
 *     appended once and a restart never re-sends what landed. A 409 `stale`
 *     (the server's clock moved past ours) is retried once with a fresh clock,
 *     then left for the next save. A transcript that SHRANK (compaction) is
 *     re-sent whole through pushThread's `messages`, which REPLACES.
 *
 * The bookkeeping is `<user>/thread-sync.json`: `{ [id]: { syncedUpTo,
 * metaSig, publishedAt, dead? } }`. `dead` marks a thread the server refuses
 * (a tombstone there never revives); it is not retried.
 *
 * The same file registers the renderer's thread channels (preload
 * threadsList/Get/Push/Delete), which were dead ends in agent-stubs.ts: the
 * rail lists local + cloud threads from `sessions.threads()`, and a cloud
 * thread's whole transcript comes from `transcriptUrl` when the local copy has
 * none.
 */

import fs from "fs";
import path from "path";
import { ApiError, AuthError, ConnectError, type PushThreadInput, type PushThreadResult, type SessionThread, type SessionThreadMessage, type SessionThreadMeta } from "@glyphh/sdk";
import { userScopedPath } from "./app-paths.js";
import { isAuthenticated } from "./auth.js";
import { getClient } from "./glyphh-client.js";
import { listStoredChats, type RelayChat } from "./agent-ipc.js";
import { isCloudWorkspacePath, threadLocus } from "../shared/member-library.js";
import { boundMessages } from "./chat-store-repair.js";

// ── The injectable core ──────────────────────────────────────────────────────

/** The slice of `client.sessions` the publisher uses. */
export interface ThreadsApi {
  threads(): Promise<SessionThreadMeta[]>;
  thread(id: string): Promise<SessionThread>;
  pushThread(id: string, body: PushThreadInput): Promise<PushThreadResult>;
  appendMessages(id: string, body: { messages: SessionThreadMessage[]; updatedAt: number }): Promise<PushThreadResult>;
  deleteThread(id: string): Promise<void>;
}

/** `publishedAt` is the clock of this machine's LAST APPLIED write on the server
 *  for the thread: every next write goes strictly after it, so an index push
 *  and an append from one save never collide on the server's strictly-newer rule. */
export interface ThreadState { syncedUpTo: number; metaSig: string; publishedAt: number; dead?: boolean }
export type ThreadStates = Record<string, ThreadState>;

export interface PublishDeps {
  api: ThreadsApi;
  chats(): RelayChat[];
  state: { read(): ThreadStates; write(s: ThreadStates): void };
  log?: (msg: string) => void;
}

export interface PublishReport { indexed: string[]; appended: Record<string, number>; replaced: string[]; skipped: string[] }

/** Messages ride verbatim, capped at the server's 64KB per message and 500 per push. */
const MAX_TEXT = 60_000;
const MAX_BATCH = 500;

export function projectMessage(m: unknown): SessionThreadMessage | null {
  if (!m || typeof m !== "object") return null;
  const msg = m as Record<string, unknown>;
  if (typeof msg.role !== "string") return null;
  const text = typeof msg.text === "string" && msg.text.length > MAX_TEXT ? `${msg.text.slice(0, MAX_TEXT)}…` : msg.text;
  return { ...msg, role: msg.role, ...(text !== undefined ? { text } : {}) } as SessionThreadMessage;
}

/** THE PUBLISHER PUBLISHES ONLY WHAT THIS DESKTOP MADE (his report,
 *  2026-10-05: a cloud session interrupted on the web flipped to his Mac and
 *  every later turn was refused — "that folder is not one this machine
 *  granted"). A thread the desktop's rail adopted from the server (a cloud
 *  session of the web's) sits in main's file too; once its messages were
 *  fetched it no longer looked like an adopted stub, threadLocus called it
 *  local, and this publisher pushed it back stamped `kind: "local"` with the
 *  machine's folder — the web adopted that copy and the session moved. Only
 *  a thread with a LOCAL source, or no source but a folder of its own, is
 *  this machine's to publish. */
export function madeHere(c: { source?: unknown; workdir?: unknown }): boolean {
  const src = c.source as { kind?: unknown } | null | undefined;
  const kind = src && typeof src === "object" && typeof src.kind === "string" ? src.kind : "";
  if (kind === "local") return !isCloudWorkspacePath((src as { path?: unknown }).path);
  if (kind) return false;
  return typeof c.workdir === "string" && c.workdir.length > 0 && !isCloudWorkspacePath(c.workdir);
}

/** The index of a local thread as it rides: the title, the type, the source stamped local. */
export function threadIndexOf(c: RelayChat): Omit<PushThreadInput, "messages"> & { updatedAt: number } {
  const src = (c.source && typeof c.source === "object" ? c.source : {}) as Record<string, unknown>;
  const folder = c.workdir || (typeof src.path === "string" ? src.path : "");
  return {
    title: c.title?.trim() || "New session",
    mode: c.mode === "work" || c.mode === "chat" ? "work" : "code",
    source: { ...src, kind: "local", ...(folder ? { path: folder } : {}), locus: "local" },
    updatedAt: c.updatedAt ?? c.createdAt ?? Date.now(),
  };
}

export const metaSigOf = (index: Omit<PushThreadInput, "messages">): string =>
  JSON.stringify({ t: index.title, m: index.mode, s: index.source ?? null });

/** The server's verdicts, read off the error's fields (never `instanceof`: a
 *  bundled test and the app load the SDK as different module instances). */
const status = (err: unknown): number => (err instanceof ApiError ? err.httpStatus : Number((err as { httpStatus?: unknown } | null)?.httpStatus)) || 0;
const isStale = (err: unknown): boolean => status(err) === 409;
const isGone = (err: unknown): boolean => status(err) === 404 || status(err) === 410;

export function createThreadPublisher(deps: PublishDeps) {
  const log = deps.log ?? (() => undefined);

  /** Publish ONE thread (its index when moved, its new messages). Returns the
   *  last server verdict, or null when nothing was sent. Throws only on a
   *  transport failure (the caller decides whether the pass goes on). */
  async function publishOne(c: RelayChat, states: ThreadStates, report?: PublishReport, serverCount?: number): Promise<PushThreadResult | null> {
    const id = c.id!;
    const st = states[id] ?? { syncedUpTo: 0, metaSig: "", publishedAt: 0 };
    if (st.dead) { report?.skipped.push(id); return null; }
    // THE SERVER LOST WHAT THIS SIDE SENT (his report, 2026-10-06: a metadata
    // push with an empty list zeroed threads on the server): its count sits
    // below what landed, so the transcript is sent whole again, as a shrink is.
    const lost = serverCount !== undefined && st.syncedUpTo > 0 && serverCount < st.syncedUpTo;
    if (lost) log(`thread ${id}: the server holds ${serverCount} of ${st.syncedUpTo} published messages — re-sent whole`);
    const index = threadIndexOf(c);
    const sig = metaSigOf(index);
    const messages = (Array.isArray(c.messages) ? c.messages : []).map(projectMessage).filter((m): m is SessionThreadMessage => !!m);
    let last: PushThreadResult | null = null;
    /** The next write's clock: the thread's own, but strictly after the last applied write. */
    const nextClock = (): number => Math.max(index.updatedAt, st.publishedAt + 1);

    // A SHRUNK transcript (compaction, a cleared thread): replace it whole.
    const shrank = messages.length < st.syncedUpTo || lost;
    // A thread the server has never seen is CREATED with its first messages
    // in the one PUT; afterwards the index rides alone and messages append.
    const fresh = !st.publishedAt;
    if (fresh || st.metaSig !== sig || shrank) {
      const clock = nextClock();
      const batch = fresh || shrank ? messages.slice(fresh ? 0 : -MAX_BATCH, fresh ? MAX_BATCH : undefined) : null;
      try {
        last = await deps.api.pushThread(id, { ...index, updatedAt: clock, ...(batch ? { messages: batch } : {}) });
      } catch (err) {
        if (isGone(err)) { states[id] = { ...st, dead: true }; log(`thread ${id} is tombstoned on the server — not published again`); report?.skipped.push(id); return null; }
        throw err;
      }
      if (last.applied) {
        st.metaSig = sig;
        st.publishedAt = clock;
        // A fresh PUT carried the FIRST messages (the rest append below); a
        // shrink replaced the transcript with its TAIL — the server now holds
        // everything this side has, so nothing is appended after it (re-sending
        // the tail from `batch.length` was the duplication, 2026-10-04).
        if (batch) { st.syncedUpTo = shrank ? messages.length : batch.length; report?.[shrank ? "replaced" : "indexed"].push(id); }
        else report?.indexed.push(id);
      } else {
        // The server holds a strictly newer copy of this thread (another
        // surface wrote it): its clock is the floor for the next write, and
        // what it already counts is NOT appended again from zero.
        st.publishedAt = Math.max(st.publishedAt, last.thread?.updatedAt ?? 0);
        st.syncedUpTo = Math.max(st.syncedUpTo, Math.min(messages.length, last.thread?.messageCount ?? 0));
        log(`thread ${id}: index refused as stale (server at ${last.thread?.updatedAt ?? "?"}) — retried after the next save`);
      }
      states[id] = st;
    }

    // The messages after what already landed — appended, never re-sent.
    let retried = false;
    while (messages.length > st.syncedUpTo) {
      const chunk = messages.slice(st.syncedUpTo, st.syncedUpTo + MAX_BATCH);
      const clock = nextClock();
      let res: PushThreadResult;
      try { res = await deps.api.appendMessages(id, { messages: chunk, updatedAt: clock }); }
      catch (err) {
        if (isStale(err)) res = { applied: false, thread: last?.thread ?? ({ id, updatedAt: clock } as SessionThreadMeta) };
        else if (isGone(err)) { states[id] = { ...st, dead: true }; report?.skipped.push(id); return last; }
        else throw err;
      }
      last = res;
      if (res.applied) {
        st.syncedUpTo += chunk.length;
        st.publishedAt = clock;
        states[id] = st;
        if (report) report.appended[id] = (report.appended[id] ?? 0) + chunk.length;
        continue;
      }
      // Stale: the server's clock moved past ours (another surface wrote).
      // One retry strictly after the server's clock; still refused → the
      // next save tries again.
      if (retried) { log(`thread ${id}: append refused as stale twice — left for the next save`); break; }
      retried = true;
      st.publishedAt = Math.max(st.publishedAt, res.thread?.updatedAt ?? 0, Date.now());
      states[id] = st;
    }
    return last;
  }

  // ONE PASS AT A TIME: a save's pass and a renderer-driven publishThread used
  // to run together, each reading syncedUpTo 0 and each appending the whole
  // transcript, then overwriting the other's advance in the state file.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  function publishAll(): Promise<PublishReport> { return serial(publishAllNow); }
  function publishThread(id: string): Promise<PushThreadResult | null> { return serial(() => publishThreadNow(id)); }

  async function publishAllNow(): Promise<PublishReport> {
    const report: PublishReport = { indexed: [], appended: {}, replaced: [], skipped: [] };
    const states = deps.state.read();
    // The server's counts, once per pass: a thread it holds fewer messages of
    // than this side published is repaired below. Unreadable → no repair this pass.
    const counts = new Map<string, number>();
    try { for (const m of await deps.api.threads()) counts.set(m.id, m.messageCount ?? 0); }
    catch (err) { if (err instanceof ConnectError || err instanceof AuthError) throw err; }
    try {
      for (const c of deps.chats()) {
        if (!c.id) continue;
        if (!madeHere(c)) { continue; }
        try { await publishOne(c, states, report, counts.get(c.id)); }
        catch (err) {
          if (err instanceof ConnectError || err instanceof AuthError) throw err; // the pass is over
          log(`thread ${c.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      deps.state.write(states);
    }
    return report;
  }

  async function publishThreadNow(id: string): Promise<PushThreadResult | null> {
    const c = deps.chats().find((x) => x.id === id);
    if (!c) return null;
    const states = deps.state.read();
    try { return await publishOne(c, states); }
    finally { deps.state.write(states); }
  }

  /** The thread is gone here: tombstone it on the server (404 = already). */
  async function forget(id: string): Promise<void> {
    const states = deps.state.read();
    delete states[id];
    deps.state.write(states);
    try { await deps.api.deleteThread(id); }
    catch (err) { if (!isGone(err)) throw err; }
  }

  return { publishAll, publishThread, forget };
}

// ── The desktop's wiring ─────────────────────────────────────────────────────

export const THREAD_SYNC_FILE = (): string => userScopedPath("thread-sync.json");

const fileState = {
  read(): ThreadStates {
    try {
      const raw = JSON.parse(fs.readFileSync(THREAD_SYNC_FILE(), "utf-8")) as { threads?: ThreadStates };
      return raw && typeof raw.threads === "object" && raw.threads ? raw.threads : {};
    } catch { return {}; }
  },
  write(threads: ThreadStates): void {
    try {
      const file = THREAD_SYNC_FILE();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ threads }, null, 2), "utf-8");
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) { console.warn("[threads] sync state not written:", err instanceof Error ? err.message : err); }
  },
};

let publisher: ReturnType<typeof createThreadPublisher> | null = null;
function live(): ReturnType<typeof createThreadPublisher> {
  return (publisher ??= createThreadPublisher({
    api: getClient().sessions,
    chats: listStoredChats,
    state: fileState,
    log: (msg) => console.warn(`[threads] ${msg}`),
  }));
}

const DEBOUNCE_MS = 2000;
let debounce: NodeJS.Timeout | null = null;
let running: Promise<void> | null = null;
let offlineWarned = false;

async function runPublish(): Promise<void> {
  if (!isAuthenticated()) return;
  try {
    const r = await live().publishAll();
    offlineWarned = false;
    const appended = Object.values(r.appended).reduce((a, b) => a + b, 0);
    if (r.indexed.length || appended || r.replaced.length) console.warn("[threads] published", JSON.stringify({ indexed: r.indexed.length, appended, replaced: r.replaced.length }));
  } catch (err) {
    if (!offlineWarned) { offlineWarned = true; console.warn("[threads] publish skipped (server unreachable or not signed in):", err instanceof Error ? err.message : err); }
  }
}

/** The chat store was written: publish what moved, soon (debounced; one pass at a time). */
/** The chat store was repaired on load (chat-store-repair.ts): each thread's
 *  OLD length becomes its syncedUpTo, so the next pass sees a shrink and
 *  replaces the server's polluted transcript with the real one. */
export function noteThreadsRepaired(repaired: Record<string, number>): void {
  const ids = Object.keys(repaired);
  if (!ids.length) return;
  const states = fileState.read();
  for (const id of ids) {
    const st = states[id] ?? { syncedUpTo: 0, metaSig: "", publishedAt: 0 };
    states[id] = { ...st, syncedUpTo: Math.max(st.syncedUpTo, repaired[id]) };
  }
  fileState.write(states);
  console.warn("[threads] repaired on load", JSON.stringify(repaired));
}

export function noteThreadsSaved(): void {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    const run = (): Promise<void> => (running = runPublish().finally(() => { running = null; }));
    void (running ? running.then(run) : run());
  }, DEBOUNCE_MS);
}

/** A chat was deleted here: the server's copy is tombstoned, best-effort. */
export function noteThreadDeleted(id: string): void {
  if (!isAuthenticated()) return;
  void live().forget(id).catch((err) => console.warn(`[threads] delete ${id} not published:`, err instanceof Error ? err.message : err));
}

/** Publish now (sign-in). */
export function publishThreadsNow(): Promise<void> { return runPublish(); }

/** The whole transcript from its presigned URL — NDJSON, one message a line. */
export async function fetchTranscript(url: string, fetchImpl: (u: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }> = fetch): Promise<SessionThreadMessage[]> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`transcript: HTTP ${res.status}`);
  const whole = await res.text();
  // A polluted transcript can run to hundreds of megabytes: only the tail is
  // read (the first partial line after the cut is dropped as torn).
  const text = whole.length > TRANSCRIPT_TAIL_CHARS ? whole.slice(-TRANSCRIPT_TAIL_CHARS) : whole;
  const out: SessionThreadMessage[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try { const m = JSON.parse(t) as SessionThreadMessage; if (m && typeof m.role === "string") out.push(m); } catch { /* a torn line */ }
  }
  return boundMessages(out);
}
const TRANSCRIPT_TAIL_CHARS = 8_000_000;

// ── The renderer's thread channels (preload threadsList/Get/Push/Delete —
//    thread-store.ts's desktop transport; agent-ipc.ts registers them) ───────

/** The caller's threads on the server — metadata only. Signed out: none. */
export function threadsList(): Promise<SessionThreadMeta[]> {
  if (!isAuthenticated()) return Promise.resolve([]);
  return getClient().sessions.threads();
}

/** One thread with its WHOLE transcript: the read carries a preview (the
 *  last 20); when more is stored, the rest comes from the transcript URL. */
export async function threadsGet(id: string): Promise<SessionThread> {
  const t = await getClient().sessions.thread(String(id));
  if (t.transcriptUrl && t.messageCount > (t.messages?.length ?? 0)) {
    try { t.messages = await fetchTranscript(t.transcriptUrl); }
    catch (err) { console.warn(`[threads] transcript of ${id} not read:`, err instanceof Error ? err.message : err); }
  }
  return t;
}

/** The renderer pushed a thread. A LOCAL thread is the publisher's: its index
 *  and its messages ride the same idempotent lane as every store write (never
 *  a PUT with messages). A cloud thread: the index only — its transcript is
 *  the pod's. */
export async function threadsPush(id: string, body: PushThreadInput | undefined): Promise<PushThreadResult> {
  if (!id) throw new Error("threadsPush requires an id");
  const local = listStoredChats().find((c) => c.id === id);
  if (local && threadLocus(local) === "local") {
    const res = await live().publishThread(id);
    if (res) return res;
    const index = threadIndexOf(local);
    return { applied: true, thread: { id, title: index.title ?? "", mode: index.mode ?? "code", source: index.source ?? null, createdAt: local.createdAt ?? index.updatedAt, updatedAt: index.updatedAt, messageCount: local.messages?.length ?? 0 } };
  }
  const { messages: _messages, ...index } = body ?? { updatedAt: Date.now() };
  void _messages;
  return getClient().sessions.pushThread(id, index);
}

/** The renderer deleted a thread: tombstone it on the server (404 = already). */
export function threadsDelete(id: string): Promise<void> {
  return live().forget(String(id));
}
