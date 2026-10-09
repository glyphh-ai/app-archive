/**
 * agent-ipc.ts — THE AGENT PANEL'S SEAM: the chat store on disk, and the
 * `glyphh-agent-*` channels the renderer has always spoken.
 *
 * This was glyphh-cli-bridge.ts, which spawned a vendor CLI per chat and
 * translated its stream. That whole lane is gone (his order, 2026-09-28: "all
 * the bridge code goes period... Everything centers back to a single agent loop
 * in glyphh that can have multiple instances, no cli switching etc"). So every
 * turn on every chat now runs on the Glyphh loop (glyphh-loop.ts), and what
 * stays here is what was never about CLIs:
 *
 *   THE CHAT STORE — chats and their turns in the signed-in user's own folder,
 *                    merged by id so several panels (and the terminal) can
 *                    write it, watched so another writer repaints the rail.
 *   THE CHANNELS   — run / stop / permission / approvals / attachments /
 *                    context / compaction / load / save.
 *
 * A chat is a thread of ours, not a vendor session: its id IS the session id,
 * which is why the >_ hop can open `glyphh --resume <chatId>` on the same
 * conversation.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import * as fsWatch from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ipcMain, webContents, type WebContents } from "electron";
import { pickAttachments, classifyPaths, saveClipboardImage, type AttachRef } from "./glyphh-agent-attachments";
import { startLocalMcpServer } from "./local-mcp-server.js";
import { getAgent, type AgentRow } from "./local-agents.js";
import { powerOfChat } from "../shared/powers.js";
import { getWorkingDirectory } from "./working-directory.js";
import { GLYPHH_DIR, getActiveUserId, userScopedDir } from "./app-paths.js";
// The server's copy of every local thread (his rule, 2026-10-04): each write
// here publishes the index + the new messages (thread-publish.ts).
import { noteThreadsSaved, noteThreadDeleted, noteThreadsRepaired, threadsList, threadsGet, threadsPush, threadsDelete } from "./thread-publish.js";
import { repairChatStore, mergeChats } from "./chat-store-repair.js";
import type { PushThreadInput } from "@glyphh/sdk";
import {
  compactGlyphhLoop, glyphhLoopUsage, isGlyphhApproval, respondGlyphhApproval,
  runGlyphhLoopTurn, setGlyphhLoopPermission, stopGlyphhLoop, type LoopPermission,
} from "./glyphh-loop.js";

// ── the chat store (~/.glyphh/users/<id> — the desktop's local law) ─────────

const STORE_DIR = (): string => userScopedDir();
// RESOLVED PER CALL, never at import (his report, 2026-09-21: the terminal's
// chats were in no rail). At import time no user is known yet, so a constant
// here pointed at ~/.glyphh/agent-sessions.json for the whole run while every
// other per-user path — and the terminal we launch — used users/<id>/.
const sessionsFile = (): string => path.join(STORE_DIR(), "agent-sessions.json");
const LEGACY_SESSIONS_FILE = path.join(GLYPHH_DIR, "agent-sessions.json");

interface StoredMessage { role?: string; text?: string; at?: number }
interface StoredChat { id?: string; updatedAt?: number; messages?: StoredMessage[] }
interface SessionsSnapshot { chats: unknown[]; currentId: string | null; /** Ids the saver deleted — dropped from the merge. */ deleted?: string[] }

/** A chat's folder as an absolute path: a display "~" that leaked into the
 *  store (2026-09-21) becomes the home folder, so nothing downstream resolves
 *  it against the app's own directory. */
function healFolder<T extends { workdir?: unknown; source?: unknown }>(c: T): T {
  const fix = (p: unknown): unknown => (p === "~" ? homedir() : typeof p === "string" && p.startsWith("~/") ? path.join(homedir(), p.slice(2)) : p);
  const src = c.source as { kind?: string; path?: unknown } | undefined;
  return {
    ...c,
    ...(c.workdir !== undefined ? { workdir: fix(c.workdir) } : {}),
    ...(src && src.kind === "local" && src.path !== undefined ? { source: { ...src, path: fix(src.path) } } : {}),
  };
}

function readSnapshot(file: string): SessionsSnapshot {
  try {
    const j = JSON.parse(readFileSync(file, "utf-8")) as SessionsSnapshot;
    return { chats: Array.isArray(j.chats) ? (j.chats as Array<{ workdir?: unknown; source?: unknown }>).map(healFolder) : [], currentId: typeof j.currentId === "string" ? j.currentId : null };
  } catch { return { chats: [], currentId: null }; }
}

/** ONE-TIME: the chats the import-time constant kept machine-global move under
 *  the signed-in user (merged by id, the newer updatedAt winning); the legacy
 *  file is renamed so this runs once. */
function adoptLegacySessions(): void {
  if (!getActiveUserId() || !existsSync(LEGACY_SESSIONS_FILE)) return;
  try {
    const legacy = readSnapshot(LEGACY_SESSIONS_FILE);
    const mine = readSnapshot(sessionsFile());
    const byId = new Map<string, StoredChat>();
    for (const c of legacy.chats as StoredChat[]) if (c && typeof c.id === "string") byId.set(c.id, c);
    for (const c of mine.chats as StoredChat[]) {
      if (!c || typeof c.id !== "string") continue;
      const cur = byId.get(c.id);
      if (!cur || (c.updatedAt ?? 0) >= (cur.updatedAt ?? 0)) byId.set(c.id, c);
    }
    mkdirSync(STORE_DIR(), { recursive: true });
    writeFileSync(sessionsFile(), JSON.stringify({ chats: [...byId.values()], currentId: mine.currentId ?? legacy.currentId }), "utf-8");
    renameSync(LEGACY_SESSIONS_FILE, `${LEGACY_SESSIONS_FILE.slice(0, -5)}.legacy.json`);
  } catch { /* best-effort: the legacy chats simply stay where they were */ }
}

/** A store the sync loop bloated (2026-10-04) is repaired once on load, before
 *  any of it crosses IPC, and the publisher is told to replace those threads
 *  on the server. */
let repairedFile = "";
function loadSessionsFile(): SessionsSnapshot {
  adoptLegacySessions();
  const snap = readSnapshot(sessionsFile());
  if (repairedFile === sessionsFile()) return snap;
  repairedFile = sessionsFile();
  const r = repairChatStore(snap.chats as StoredChat[]);
  if (!Object.keys(r.repaired).length) return snap;
  try {
    writeFileSync(sessionsFile(), JSON.stringify({ chats: r.chats, currentId: snap.currentId }), "utf-8");
    try { ourWriteAt = statSync(sessionsFile()).mtimeMs; } catch { /* announced by the watcher then */ }
  } catch { /* the in-memory copy is repaired either way */ }
  noteThreadsRepaired(r.repaired);
  return { ...snap, chats: r.chats };
}

/** ANOTHER WRITER (the glyphh terminal, 2026-09-21): watch the store and tell
 *  every renderer when a write that was not ours lands, so the rail and the
 *  panel show a terminal's turns without a restart. Never a persistent
 *  handle (it would keep main alive after the last window closed). */
let watchedFile = "";
let ourWriteAt = 0;
function watchSessionsFile(): void {
  const file = sessionsFile();
  if (watchedFile === file) return;
  if (watchedFile) fsWatch.unwatchFile(watchedFile);
  watchedFile = file;
  fsWatch.watchFile(file, { interval: 1500, persistent: false }, (cur) => {
    if (Math.abs(cur.mtimeMs - ourWriteAt) < 50) return; // our own save
    for (const wc of webContents.getAllWebContents()) { if (!wc.isDestroyed()) wc.send("glyphh-sessions-updated"); }
  });
}

function saveSessionsFile(snap: SessionsSnapshot, from?: WebContents): void {
  try {
    mkdirSync(STORE_DIR(), { recursive: true });
    // Several agent panels write this file (2026-09-16): merge by chat id, the
    // newer updatedAt wins, and a chat only one panel knows about survives.
    const have = readSnapshot(sessionsFile()).chats as StoredChat[];
    const incoming = snap.chats as StoredChat[];
    const gone = new Set(snap.deleted ?? []);
    const chats = mergeChats(have, incoming, gone);
    writeFileSync(sessionsFile(), JSON.stringify({ chats, currentId: snap.currentId }), "utf-8");
    try { ourWriteAt = statSync(sessionsFile()).mtimeMs; } catch { /* the watcher will just announce it */ }
    watchSessionsFile();
    // OUR OWN WRITES MUST BE ANNOUNCED TOO (his report, 2026-09-29: the left
    // rail read "No recent sessions yet" beside a panel listing eight). The
    // watcher above deliberately ignores this write — it is ours — so without
    // this the OTHER documents (the shell that hosts the rail, a second panel)
    // never learned the store had moved. The writer itself already repainted.
    // The deleted ids ride along: the file alone cannot tell a panel "the
    // session you are showing is gone" (his report, 2026-09-29).
    const deleted = [...gone];
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed() || (from && wc.id === from.id)) continue;
      wc.send("glyphh-sessions-updated", { deleted });
    }
    // THE SERVER HEARS EVERY WRITE: the index and the new messages of each
    // local thread ride up (debounced); a deleted id is tombstoned there.
    for (const id of deleted) noteThreadDeleted(id);
    noteThreadsSaved();
  } catch { /* a failed save loses nothing but the recents ordering */ }
}

/** A stored chat by id, for the turn text and the loop's seed history. */
function storedChat(chatId: string): StoredChat | undefined {
  return (loadSessionsFile().chats as StoredChat[]).find((x) => x?.id === chatId);
}

// ── the store as the PHONE sees it (attach-handlers.ts sessions.*) ───────────
// The chats live on this machine only; mobile.glyphh.ai reads and writes them
// over the attach socket. Rich desktop fields (steps, parts, pins) are never
// replaced by the phone's plain {role, text} copies: the phone writes metadata,
// and a relayed turn's two messages are appended here (attach-run.ts).

export interface RelayChat extends StoredChat {
  title?: string; createdAt?: number; mode?: string; workdir?: string; source?: unknown; pinned?: boolean;
  /** A BOT'S THREAD (his order, 2026-10-08): the slug of the bot this
   *  conversation is with. The rail lists it under the bot's cat and a click
   *  opens the Bots panel on it, never the agent panel. */
  bot?: string;
}

export function listStoredChats(): RelayChat[] {
  return (loadSessionsFile().chats as RelayChat[]).filter((c) => c && typeof c.id === "string");
}

export function getStoredChat(chatId: string): RelayChat | undefined {
  return storedChat(chatId) as RelayChat | undefined;
}

/** Create the chat if it is new, else patch its metadata. Messages are only
 *  ever seeded on creation. */
export function upsertStoredChat(chatId: string, patch: { title?: string; mode?: string; workdir?: string; messages?: StoredMessage[]; bot?: string }): RelayChat {
  const snap = loadSessionsFile();
  const chats = snap.chats as RelayChat[];
  const now = Date.now();
  let chat = chats.find((c) => c?.id === chatId);
  if (!chat) {
    chat = {
      id: chatId, title: patch.title?.trim() || "New session", createdAt: now, updatedAt: now,
      mode: "code", messages: patch.messages ?? [],
      ...(patch.workdir ? { workdir: patch.workdir, source: { kind: "local", path: patch.workdir } } : {}),
      ...(patch.bot ? { bot: patch.bot } : {}),
    };
    chats.unshift(chat);
  } else {
    if (patch.title?.trim()) chat.title = patch.title.trim();
    if (patch.workdir && !chat.workdir) { chat.workdir = patch.workdir; chat.source = { kind: "local", path: patch.workdir }; }
    chat.updatedAt = now;
  }
  saveSessionsFile({ chats, currentId: snap.currentId });
  return chat;
}

/** Append one message to a chat (creating it when a relayed turn is its first).
 *  A repeat of the last message is not written twice. */
export function appendStoredMessage(chatId: string, msg: { role: "user" | "assistant"; text: string }, seed?: { title?: string; mode?: string; workdir?: string; bot?: string }): void {
  const text = msg.text.trim();
  if (!chatId || !text) return;
  const snap = loadSessionsFile();
  const chats = snap.chats as RelayChat[];
  if (!chats.some((c) => c?.id === chatId)) { upsertStoredChat(chatId, { ...seed, title: seed?.title || text.slice(0, 60) }); return appendStoredMessage(chatId, msg); }
  const chat = chats.find((c) => c?.id === chatId)!;
  // A chat the phone named before its first turn has no folder yet: the turn's is its folder.
  if (seed?.workdir && !chat.workdir) { chat.workdir = seed.workdir; chat.source = { kind: "local", path: seed.workdir }; }
  const msgs = Array.isArray(chat.messages) ? chat.messages : (chat.messages = []);
  const last = msgs[msgs.length - 1];
  if (last && last.role === msg.role && String(last.text ?? "").trim() === text) return;
  msgs.push({ role: msg.role, text, at: Date.now() });
  chat.updatedAt = Date.now();
  saveSessionsFile({ chats, currentId: snap.currentId });
}

/** A chat's messages as plain turns — the Bots panel's thread after a restart. */
export function storedMessages(chatId: string): Array<{ role: "user" | "assistant"; text: string; at: number }> {
  const chat = storedChat(chatId);
  return (Array.isArray(chat?.messages) ? chat.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .map((m) => ({ role: m.role as "user" | "assistant", text: String(m.text), at: Number((m as { at?: number }).at ?? 0) || 0 }));
}

export function deleteStoredChat(chatId: string): boolean {
  const snap = loadSessionsFile();
  if (!(snap.chats as StoredChat[]).some((c) => c?.id === chatId)) return false;
  saveSessionsFile({ chats: (snap.chats as StoredChat[]).filter((c) => c?.id !== chatId), currentId: snap.currentId === chatId ? null : snap.currentId, deleted: [chatId] });
  return true;
}

// ── one turn ─────────────────────────────────────────────────────────────────

export interface RunPayload {
  chatId: string;
  attachments?: AttachRef[];
  workdir?: string;
  permission?: LoopPermission;
  /** A hidden prefix (the voice brief), never the message itself. */
  steer?: string;
  model?: string;
  prompt?: string;
  /** The workspace the chat runs under, for project memory. */
  workspace?: string;
  /** The thread's TYPE, as the composer knows it: chat or code. */
  mode?: string;
  /** The composer's effort dial; glyphh-loop.ts checks it against the SDK's names. */
  effort?: string;
}

/** One user turn on a chat, from ANY sender: the renderer's IPC, or the attach
 *  executor's fake WebContents that forwards frames up the socket (attach-run.ts). */
/** The bot a `bots/<slug>` thread is with, or null (any other thread, or a bot since deleted). */
function botOfChat(chatId: string): AgentRow | null {
  if (!chatId.startsWith("bots/")) return null;
  try { return getAgent(chatId.slice(5)); } catch { return null; }
}

export async function runAgentTurn(sender: WebContents, p: RunPayload): Promise<{ runId: string }> {
  // A TURN RUNS IN ITS THREAD'S FOLDER OR NOT AT ALL (his rule, 2026-09-29:
  // "The agent should work from the selected folder period!!! that is a hard
  // hard constraint, it is sandboxed to that folder"). There is no fallback:
  // NO_WORKDIR is the composer's cue to ask. One type since 2026-10-08: every
  // turn is this kind of turn.
  // A BOT'S THREAD (his order, 2026-10-09: "the user can click a bot and its
  // Glyphh chat history opens. Same ui same everything"): `bots/<slug>` runs
  // in the same chat as any Glyphh thread, carrying the bot's brief (its
  // personality) and its model. With no folder picked it works in the
  // member's working folder, as the bot's own runs always have.
  const bot = botOfChat(p.chatId);
  // A POWER'S THREAD (`powers/<id>`, his order 2026-10-09): talking to a power
  // directly — its brief leads the turn, like a bot's.
  const power = powerOfChat(p.chatId);
  const folder = String(p.workdir ?? "").trim() || (bot || power ? getWorkingDirectory() : "");
  if (!folder) throw new Error("NO_WORKDIR: this session has no folder yet");
  if (folder) {
    let ok = false;
    try { ok = statSync(folder).isDirectory(); } catch { ok = false; }
    if (!ok) throw new Error(`NO_WORKDIR: this session's folder no longer exists (${folder})`);
  }
  await startLocalMcpServer().catch(() => { /* the turn still runs, with fewer tools and honestly so */ });
  // The composer's contract (unchanged since the bridge): the user turn is
  // already IN the chat store when run arrives — same-renderer IPC ordering
  // guarantees the save landed first.
  const chat = storedChat(p.chatId);
  const lastUser = [...(chat?.messages ?? [])].reverse().find((m) => m?.role === "user");
  const steer = String(p.steer ?? "").trim();
  const brief = String(bot?.prompt ?? power?.brief ?? "").trim();
  const text = [brief, steer, String(p.prompt ?? lastUser?.text ?? "").trim()].filter(Boolean).join("\n\n");
  const model = String(bot?.model ?? "").trim() || p.model;
  return runGlyphhLoopTurn(sender, {
    chatId: p.chatId,
    ...(p.permission ? { permission: p.permission } : {}),
    ...(model ? { model } : {}),
    ...(p.effort ? { effort: p.effort } : {}),
    workdir: folder,
    ...(p.workspace ? { workspace: p.workspace } : {}),
    ...(p.attachments?.length ? { attachments: p.attachments } : {}),
    history: chat?.messages ?? [],
  }, text);
}

/**
 * A TURN THAT OUTLIVED ITS PANEL (his order, 2026-09-29: "the agents do not
 * continue to run in the background. Each agent should be its own thread that
 * continues working even if the work panel app is closed").
 *
 * The loop itself always kept running — it lives in this process, not in the
 * panel — but the ANSWER was lost: a renderer commits the assistant turn when
 * it hears `done`, and with its webContents gone nobody heard it. So the
 * thread looked like it had been abandoned mid-sentence. When the owning panel
 * is gone, main writes the turn into the shared store itself and announces it;
 * the next surface to open that thread reads a finished conversation.
 */
export function commitBackgroundTurn(chatId: string, text: string): void {
  const answer = text.trim();
  if (!chatId || !answer) return;
  try {
    const snap = loadSessionsFile();
    const chats = snap.chats as Array<StoredChat & { updatedAt?: number }>;
    const chat = chats.find((c) => c?.id === chatId);
    if (!chat) return;
    const msgs = Array.isArray(chat.messages) ? chat.messages : (chat.messages = []);
    // Never twice: a panel that DID hear the done already wrote it.
    const last = msgs[msgs.length - 1];
    if (last && last.role === "assistant" && String(last.text ?? "").trim() === answer) return;
    msgs.push({ role: "assistant", text: answer } as StoredMessage);
    chat.updatedAt = Date.now();
    saveSessionsFile({ chats, currentId: snap.currentId });
    console.warn("[agent] background turn committed", JSON.stringify({ chatId, chars: answer.length }));
  } catch (err) {
    console.warn("[agent] background turn not committed:", err instanceof Error ? err.message : err);
  }
}

export function stopAgentChat(chatId: string): boolean {
  return chatId ? stopGlyphhLoop(chatId) : false;
}

export function setAgentPermission(chatId: string, permission: LoopPermission): boolean {
  return setGlyphhLoopPermission(chatId, permission);
}

export function respondAgentApproval(id: string, allow: boolean): boolean {
  if (!isGlyphhApproval(id)) return false;
  return respondGlyphhApproval(id, allow);
}

// ── IPC surface — the exact channels the renderer calls ──────────────────────

export function registerAgentIpc(): void {
  ipcMain.handle("glyphh-agent-run", (e, p: RunPayload) => runAgentTurn(e.sender, p));
  ipcMain.handle("glyphh-agent-stop", (_e, p: { chatId?: string }) => stopAgentChat(p?.chatId ?? ""));

  // (A message typed mid-run needs no channel of its own: the composer queues
  //  it as a visible note and sends it through the normal path when the turn
  //  ends, and the engine queues a programmatic one the same way.)

  ipcMain.handle("glyphh-agent-set-permission", (_e, p: { chatId: string; permission: LoopPermission }) => ({ updated: setAgentPermission(p.chatId, p.permission) }));
  ipcMain.handle("glyphh-agent-approval-respond", (_e, p: { id: string; allow: boolean }) => respondAgentApproval(p.id, p.allow));

  // Questions arrive as tool permission asks and are answered there; these stay
  // callable so no renderer path throws.
  ipcMain.handle("glyphh-agent-ask-respond", () => false);
  ipcMain.handle("glyphh-agent-connect-respond", () => false);

  ipcMain.handle("glyphh-agent-context-usage", (_e, p: { chatId: string }) => {
    const u = glyphhLoopUsage(p?.chatId ?? "");
    // Cached prompt tokens are billed too, at cache rates, and they sit in the
    // window like any other (his question, 2026-09-19).
    const tokens = u.inTokens + u.outTokens + u.cacheRead;
    const budget = 200_000;
    return { tokens, budget, ratio: Math.min(1, tokens / budget), foldAt: 0.8, lanes: [] };
  });

  // COMPACTION IS OURS NOW (it used to be "open the Terminal and /compact",
  // because the bridge had no conversation of its own to summarize).
  ipcMain.handle("glyphh-agent-compact", async (_e, p: { chatId?: string }) => {
    const r = await compactGlyphhLoop(String(p?.chatId ?? ""));
    return r.ok ? { ok: true } : { ok: false, reason: r.error };
  });
  ipcMain.handle("glyphh-agent-remember", () => false);

  ipcMain.handle("glyphh-agent-pick-attachments", async (_e, p: { mode?: "files" | "folder" }) => pickAttachments(p?.mode));
  ipcMain.handle("glyphh-agent-classify-paths", (_e, p: { paths: string[] }) => classifyPaths(p?.paths ?? []));
  ipcMain.handle("glyphh-agent-save-clipboard-image", (_e, p: { bytes: ArrayBuffer }) => saveClipboardImage(p.bytes));

  // (The per-CLI session bindings are gone: THE CHAT IS THE SESSION, so there
  //  is nothing to bind or look up — `glyphh --resume <chatId>` opens the same
  //  conversation the panel has.)

  ipcMain.handle("glyphh-agent-sessions-load", () => {
    watchSessionsFile();
    return loadSessionsFile();
  });
  ipcMain.handle("glyphh-agent-sessions-save", (e, p: { chats: unknown[]; currentId: string | null; deleted?: string[] }) => {
    saveSessionsFile({ chats: p?.chats ?? [], currentId: p?.currentId ?? null, ...(Array.isArray(p?.deleted) ? { deleted: p.deleted.map(String) } : {}) }, e.sender);
    return true;
  });

  // THE SERVER'S THREADS SURFACE for the renderer's thread-store (dead ends in
  // agent-stubs.ts until 2026-10-04): the rail lists local + cloud threads
  // from it, and a cloud thread's transcript comes down whole (thread-publish.ts).
  ipcMain.handle("glyphh-threads-list", () => threadsList());
  ipcMain.handle("glyphh-threads-get", (_e: unknown, id: string) => threadsGet(String(id)));
  ipcMain.handle("glyphh-threads-push", (_e: unknown, p: { id: string; body: PushThreadInput }) => threadsPush(String(p?.id ?? ""), p?.body));
  ipcMain.handle("glyphh-threads-delete", (_e: unknown, id: string) => threadsDelete(String(id)));
}
