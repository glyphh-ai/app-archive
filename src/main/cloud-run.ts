/**
 * cloud-run.ts — THE DESKTOP'S CLOUD LANE (his words, 2026-10-04: "the desktop
 * can reach both the local file system and the sandbox on the ephemeral
 * machine").
 *
 * A session whose locus is "In the cloud" runs on the member's ephemeral worker
 * behind the gateway's `/api/harness/*`, driven from the desktop exactly as the
 * web drives it: the SDK's one `client.run({ target: "cloud" })`. The desktop's
 * renderer never holds the SDK (the client lives here, glyphh-client.ts), so
 * the lane is an IPC family the renderer's remote-run.ts wraps into the same
 * HarnessRunHandle shape the web consumes — nothing in code.ts knows which
 * lane ran a turn.
 *
 *   glyphh-cloud-run-start       {chatId, threadId, prompt, mode, …} → {ok, runId}
 *     frames stream back to the CALLING WebContents as
 *       glyphh-cloud-run:frame   {chatId, runId, frame}      (every HarnessWireFrame)
 *       glyphh-cloud-run:done    {chatId, runId, ok, result | error}
 *   glyphh-cloud-run-answer      {runId, id, reply}   a parked approval / ask
 *   glyphh-cloud-run-stop        {runId | chatId}
 *   glyphh-cloud-run-permission  {runId, mode}        mid-run mode flip
 *   glyphh-cloud-run-attach      {threadId, token, from}  observe a run already
 *     in flight on the pod: this desktop's own run (replayed from its tape),
 *     else the SDK's run-stream watch; frames come as
 *       glyphh-cloud-run:observe-run {token, runId} then
 *       glyphh-cloud-run:observe     {token, frame}
 *   glyphh-cloud-run-detach      {token}
 *   cloud-spaces-list            → the member's cloud folders (fs/spaces)
 *   cloud-fs-browse              (scope, dir?) → the folders inside one workspace
 *   harness-stop-run             (runId) → the cross-surface stop
 *   glyphh-harness-token         → the session's current access token (the
 *     cloud TERMINAL's bearer: the renderer opens the pod's pty itself over
 *     /api/harness/pty, remote-terminal.ts, with the token main holds); null
 *     when signed out. NEVER logged.
 *
 * THE RAIL SEES A CLOUD RUN LIKE A LOCAL ONE: the lane drives the same live
 * ledger glyphh-loop.ts drives (agent-live.ts) — working from the moment the
 * turn is on the wire (a cold pod can take seconds before its first frame),
 * waiting on an approval/ask, red on an error frame, cleared on done — so a
 * cloud session's row pulses, and a click on it finds the panel (senderId).
 *
 * THE POD OWNS THE TRANSCRIPT: a cloud turn's answer is never written into
 * the local chat store by main (the loop's commitBackgroundTurn is for local
 * threads); the server's thread row + R2 transcript are the record, and the
 * renderer's thread-store pushes a cloud thread's INDEX only (thread-publish.ts).
 *
 * The core is injectable (`createCloudLane`) so it is tested against a fake
 * SDK client and a fake ledger; `registerCloudRunIpc` wires Electron.
 */

import { ipcMain, type WebContents } from "electron";
import { agentLive, noteRunDelta } from "./agent-live.js";
import { getClient } from "./glyphh-client.js";
import { isAuthenticated } from "./auth.js";

export type CloudPermission = "ask" | "plan" | "acceptEdits" | "auto";

/** A harness frame as it rides `glyphh.harness/v1` — forwarded verbatim. */
export interface CloudWireFrame { type: string; seq: number; runId: string; at: number; [k: string]: unknown }

export interface CloudRunResult { runId: string; stopped: boolean; text: string; error?: string }

/** What the renderer sends to start a turn (remote-run.ts builds it). */
export interface CloudRunStart {
  chatId: string;
  /** The id the run threads on — a cloud-space session re-enters its space's id. */
  threadId: string;
  prompt: string;
  mode: "work" | "code";
  model?: string;
  loop?: string;
  permission?: CloudPermission;
  effort?: string;
  images?: Array<{ mediaType: string; data: string }>;
  memory?: unknown;
  subdir?: string;
  repo?: string;
}

/** The slice of the SDK's run handle the lane drives (`client.run()` →
 *  HarnessRun), read structurally so a test can hand in a fake. */
export interface CloudRunHandle {
  readonly runId?: string;
  readonly whenStarted?: Promise<{ runId: string }>;
  readonly done: Promise<{ runId: string; text?: string; stopped?: boolean; error?: string }>;
  on(cb: (frame: { type: string; [k: string]: unknown }) => void): () => void;
  answer(id: string, reply: { allow?: boolean; answers?: string[] }): Promise<void>;
  stop(): Promise<void>;
  setPermission(mode: CloudPermission): Promise<void>;
}

export interface CloudSpace { id: string; updatedAt: number; top: string[] }
export interface CloudFsEntry { name: string; path: string; kind: string }

/** The slice of `@glyphh/sdk`'s Client the lane uses. */
export interface CloudLaneClient {
  run(opts: {
    target: "cloud";
    threadId: string;
    prompt: string;
    mode: "work" | "code";
    model?: string;
    loop?: string;
    permission?: string;
    effort?: string;
    images?: Array<{ mediaType: string; data: string }>;
    memory?: unknown;
    subdir?: string;
    repo?: string;
  }): CloudRunHandle;
  harnessViaApi(): {
    fsSpaces(): Promise<{ spaces: CloudSpace[] }>;
    fsInfo(opts: { scope?: string }): Promise<{ root: string }>;
    fsList(opts: { dir?: string; scope?: string }): Promise<{ entries: CloudFsEntry[]; error?: string }>;
    stopRun(runId: string): Promise<void>;
  };
  /** The session bearer (the SDK's TokenProvider: refreshes ahead of expiry; throws signed out). */
  token(): Promise<string>;
  runStream: {
    activeRun(threadId: string): Promise<string | null>;
    attach(threadId: string, opts?: { from?: string }): {
      on(cb: (frame: { type: string; [k: string]: unknown }) => void): () => void;
      onRun(cb: (runId: string) => void): () => void;
      stop(): void;
    };
  };
}

/** The live ledger (agent-live.ts) as the lane drives it. */
export interface CloudLiveLedger {
  start(run: { chatId: string; cliSessionId: string | null; cli: string; runId: string; senderId: number }): void;
  update(chatId: string, patch: { runId?: string; senderId?: number; status?: "working" | "waiting" | "error" }): void;
  done(chatId: string, runId?: string): void;
  list(): Array<{ chatId: string; status: string }>;
}

export interface CloudLaneDeps {
  client: () => CloudLaneClient;
  signedIn: () => boolean;
  live: CloudLiveLedger;
  noteDelta: (chatId: string, delta: string) => void;
  log?: (msg: string) => void;
}

/** The WebContents a run streams to — only what the lane touches. */
export type CloudSender = Pick<WebContents, "id" | "send" | "isDestroyed">;

export type CloudStartReply = { ok: true; runId: string } | { ok: false; error: string };
/** How a run ended: an `error` FRAME is an ok result with `error` set (the
 *  SDK's contract); only a transport failure is `ok: false`. */
export type CloudDoneBody = { ok: true; result: CloudRunResult } | { ok: false; error: string };
export type CloudDonePayload = { chatId: string; runId: string } & CloudDoneBody;

interface LiveCloudRun {
  chatId: string;
  threadId: string;
  runId: string;
  handle: CloudRunHandle;
  sender: CloudSender;
  text: string;
  settled: boolean;
  off: () => void;
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createCloudLane(deps: CloudLaneDeps) {
  const log = deps.log ?? (() => undefined);
  const byChat = new Map<string, LiveCloudRun>();
  const byRun = new Map<string, LiveCloudRun>();
  /** Observers by their renderer-minted token → how to stop them. */
  const observers = new Map<string, () => void>();

  const send = (to: CloudSender, channel: string, payload: unknown): boolean => {
    if (to.isDestroyed()) return false;
    try { to.send(channel, payload); return true; } catch { return false; }
  };

  /** The ledger, marked like glyphh-loop.ts marks it: a chat not on it (or on
   *  it only as an old error) starts fresh; otherwise its state moves. */
  const mark = (entry: LiveCloudRun, status: "working" | "waiting" | "error"): void => {
    if (status === "working" && !deps.live.list().some((r) => r.chatId === entry.chatId && r.status !== "error")) {
      deps.live.start({ chatId: entry.chatId, cliSessionId: entry.chatId, cli: "glyphh", runId: entry.runId, senderId: entry.sender.id });
      return;
    }
    deps.live.update(entry.chatId, { status, runId: entry.runId, senderId: entry.sender.id });
  };

  const deliver = (entry: LiveCloudRun, frame: { type: string; [k: string]: unknown }): void => {
    if (entry.settled) return;
    const runId = entry.runId || String(frame.runId ?? "");
    send(entry.sender, "glyphh-cloud-run:frame", { chatId: entry.chatId, runId, frame });
    switch (frame.type) {
      case "setup": mark(entry, "working"); break;
      case "approval":
      case "ask": mark(entry, "waiting"); break;
      case "delta": {
        const d = String(frame.delta ?? "");
        entry.text += d;
        deps.noteDelta(entry.chatId, d);
        mark(entry, "working");
        break;
      }
      case "error": mark(entry, "error"); break;
      default: break;
    }
  };

  const settle = (entry: LiveCloudRun, payload: CloudDoneBody): void => {
    if (entry.settled) return;
    entry.settled = true;
    entry.off();
    if (byChat.get(entry.chatId) === entry) byChat.delete(entry.chatId);
    if (entry.runId && byRun.get(entry.runId) === entry) byRun.delete(entry.runId);
    if (!payload.ok) mark(entry, "error");
    deps.live.done(entry.chatId, entry.runId || undefined);
    const to = entry.sender;
    if (to.isDestroyed()) log(`cloud turn on ${entry.chatId} settled with nobody listening — the pod's transcript is the record`);
    const done: CloudDonePayload = { chatId: entry.chatId, runId: entry.runId, ...payload };
    send(to, "glyphh-cloud-run:done", done);
  };

  async function start(sender: CloudSender, p: CloudRunStart): Promise<CloudStartReply> {
    if (!deps.signedIn()) return { ok: false, error: "signed out" };
    const chatId = String(p?.chatId ?? "").trim();
    const threadId = String(p?.threadId ?? chatId).trim();
    const prompt = String(p?.prompt ?? "");
    if (!chatId || !threadId || !prompt.trim()) return { ok: false, error: "chatId, threadId and prompt are required" };
    if (byChat.has(chatId)) return { ok: false, error: "a turn is already running on this thread" };

    let handle: CloudRunHandle;
    try {
      handle = deps.client().run({
        target: "cloud",
        threadId,
        prompt,
        mode: p.mode === "work" ? "work" : "code",
        ...(p.model ? { model: p.model } : {}),
        ...(p.loop ? { loop: p.loop } : {}),
        ...(p.permission ? { permission: p.permission } : {}),
        ...(p.effort ? { effort: p.effort } : {}),
        ...(p.images?.length ? { images: p.images } : {}),
        ...(p.memory ? { memory: p.memory } : {}),
        ...(p.subdir ? { subdir: p.subdir } : {}),
        ...(p.repo ? { repo: p.repo } : {}),
      });
    } catch (err) { return { ok: false, error: errorText(err) }; }

    const entry: LiveCloudRun = { chatId, threadId, runId: "", handle, sender, text: "", settled: false, off: () => undefined };
    byChat.set(chatId, entry);
    // On the ledger from the first moment: a cold worker answers nothing for
    // seconds, and the rail must show the session working meanwhile.
    mark(entry, "working");
    entry.off = handle.on((frame) => deliver(entry, frame));
    void handle.done.then(
      (r) => settle(entry, { ok: true, result: { runId: r.runId || entry.runId, stopped: !!r.stopped, text: r.text ?? entry.text, ...(r.error ? { error: r.error } : {}) } }),
      (err) => settle(entry, { ok: false, error: errorText(err) }),
    );

    let runId: string;
    try {
      runId = (await (handle.whenStarted ?? handle.done)).runId || handle.runId || `cloud-${chatId}`;
    } catch (err) {
      // The pod could not be had (503 worker_unavailable, 412 not-configured,
      // signed out): the done rejection above settles the ledger and the
      // renderer; this reply is the typed failure the composer renders.
      return { ok: false, error: errorText(err) };
    }
    if (entry.settled) return { ok: true, runId: entry.runId || runId };
    entry.runId = runId;
    byRun.set(runId, entry);
    deps.live.update(chatId, { runId });
    return { ok: true, runId };
  }

  const find = (p: { runId?: string; chatId?: string } | undefined): LiveCloudRun | undefined =>
    (p?.runId ? byRun.get(String(p.runId)) : undefined) ?? (p?.chatId ? byChat.get(String(p.chatId)) : undefined);

  async function answer(p: { runId: string; id: string; reply: { allow?: boolean; answers?: string[] } }): Promise<{ ok: boolean; error?: string }> {
    const entry = find(p);
    if (!entry) return { ok: false, error: "no such run" };
    try { await entry.handle.answer(String(p.id), p.reply ?? {}); return { ok: true }; }
    catch (err) { return { ok: false, error: errorText(err) }; }
  }

  async function stop(p: { runId?: string; chatId?: string }): Promise<{ ok: boolean; error?: string }> {
    const entry = find(p);
    if (!entry) return { ok: false, error: "no such run" };
    try { await entry.handle.stop(); return { ok: true }; }
    catch (err) { return { ok: false, error: errorText(err) }; }
  }

  async function setPermission(p: { runId: string; mode: CloudPermission }): Promise<{ ok: boolean; error?: string }> {
    const entry = find(p);
    if (!entry) return { ok: false, error: "no such run" };
    try { await entry.handle.setPermission(p.mode); return { ok: true }; }
    catch (err) { return { ok: false, error: errorText(err) }; }
  }

  /**
   * Observe a run in flight on the pod. This desktop's OWN run on the thread
   * is replayed from its handle's tape and followed live (another panel
   * opening the thread sees the turn, read-only — the launching panel keeps
   * the approvals). Otherwise the SDK's run-stream watch: asked ONCE for the
   * thread's active run — a 200 (a run, or `null` while idle) means the
   * server brokers runs and the watch stays on; a refusal means this server
   * has no broker (the LiteLLM fork serves none, 2026-10-04) and nothing is
   * polled.
   */
  async function attach(sender: CloudSender, p: { threadId: string; token: string; from?: string }): Promise<{ ok: boolean; running?: boolean; error?: string }> {
    const threadId = String(p?.threadId ?? "").trim();
    const token = String(p?.token ?? "").trim();
    if (!threadId || !token) return { ok: false, error: "threadId and token are required" };
    if (observers.has(token)) return { ok: false, error: "token already attached" };
    const mine = [...byChat.values()].find((e) => e.threadId === threadId || e.chatId === threadId);
    if (mine) {
      let off: () => void = () => undefined;
      observers.set(token, () => off());
      void (mine.handle.whenStarted ?? Promise.resolve({ runId: mine.runId })).then(({ runId }) => {
        if (!observers.has(token) || mine.settled) return;
        if (!send(sender, "glyphh-cloud-run:observe-run", { token, runId: mine.runId || runId })) { detach({ token }); return; }
        off = mine.handle.on((frame) => {
          if (!send(sender, "glyphh-cloud-run:observe", { token, frame })) detach({ token });
        });
      }, () => detach({ token }));
      return { ok: true, running: true };
    }
    if (!deps.signedIn()) return { ok: false, error: "signed out" };
    try { await deps.client().runStream.activeRun(threadId); }
    catch (err) { log(`no run broker on this server (${errorText(err)}) — ${threadId} not watched`); return { ok: true, running: false }; }
    const h = deps.client().runStream.attach(threadId, p.from ? { from: p.from } : {});
    observers.set(token, () => h.stop());
    h.onRun((runId) => { if (!send(sender, "glyphh-cloud-run:observe-run", { token, runId })) detach({ token }); });
    h.on((frame) => { if (!send(sender, "glyphh-cloud-run:observe", { token, frame })) detach({ token }); });
    return { ok: true, running: false };
  }

  function detach(p: { token: string }): { ok: boolean } {
    const stopIt = observers.get(String(p?.token ?? ""));
    if (!stopIt) return { ok: false };
    observers.delete(String(p.token));
    try { stopIt(); } catch { /* already gone */ }
    return { ok: true };
  }

  /** The member's cloud folders — the picker's "Your spaces". Signed out or unreachable: none. */
  async function spaces(): Promise<{ spaces: CloudSpace[] }> {
    if (!deps.signedIn()) return { spaces: [] };
    try {
      const r = await deps.client().harnessViaApi().fsSpaces();
      return { spaces: Array.isArray(r?.spaces) ? r.spaces : [] };
    } catch (err) { log(`cloud spaces not listed: ${errorText(err)}`); return { spaces: [] }; }
  }

  /** The folders inside one cloud workspace (the chip's "Folder in this
   *  workspace…"), the shape the web's wb-pod answers. Null when it cannot be read. */
  async function fsBrowse(scope: string, dir?: string): Promise<{ root: string; path: string; entries: CloudFsEntry[] } | null> {
    if (!deps.signedIn() || !scope) return null;
    try {
      const hc = deps.client().harnessViaApi();
      const info = await hc.fsInfo({ scope });
      const path = dir || info.root;
      const r = await hc.fsList({ dir: path, scope });
      return { root: info.root, path, entries: (r.entries ?? []).filter((e) => e.kind === "dir") };
    } catch (err) { log(`cloud folder not browsed: ${errorText(err)}`); return null; }
  }

  /** The session's access token for the renderer's own harness calls (the
   *  cloud terminal). The SDK refreshes it when it is about to expire; a
   *  signed-out desktop, or a refresh the server refused, answers null. */
  async function token(): Promise<string | null> {
    if (!deps.signedIn()) return null;
    try { return (await deps.client().token()) || null; }
    catch { return null; } // the reason is the SDK's to surface (onSignedOut); never the token's text
  }

  /** The cross-surface stop by run id — an observed run this desktop did not launch. */
  async function stopRun(runId: string): Promise<{ ok: boolean; error?: string }> {
    if (!runId) return { ok: false, error: "runId is required" };
    const mine = byRun.get(runId);
    if (mine) return stop({ runId });
    if (!deps.signedIn()) return { ok: false, error: "signed out" };
    try { await deps.client().harnessViaApi().stopRun(runId); return { ok: true }; }
    catch (err) { return { ok: false, error: errorText(err) }; }
  }

  return {
    start, answer, stop, setPermission, attach, detach, spaces, fsBrowse, stopRun, token,
    /** Is a cloud turn running on the chat? */
    has: (chatId: string): boolean => byChat.has(chatId),
  };
}

export type CloudLane = ReturnType<typeof createCloudLane>;

let lane: CloudLane | null = null;
function live(): CloudLane {
  return (lane ??= createCloudLane({
    client: () => getClient(),
    signedIn: isAuthenticated,
    live: agentLive,
    noteDelta: noteRunDelta,
    log: (msg) => console.warn(`[cloud-run] ${msg}`),
  }));
}

export function registerCloudRunIpc(): void {
  ipcMain.handle("glyphh-cloud-run-start", (e, p: CloudRunStart) => live().start(e.sender, p));
  ipcMain.handle("glyphh-cloud-run-answer", (_e, p: { runId: string; id: string; reply: { allow?: boolean; answers?: string[] } }) => live().answer(p));
  ipcMain.handle("glyphh-cloud-run-stop", (_e, p: { runId?: string; chatId?: string }) => live().stop(p ?? {}));
  ipcMain.handle("glyphh-cloud-run-permission", (_e, p: { runId: string; mode: CloudPermission }) => live().setPermission(p));
  ipcMain.handle("glyphh-cloud-run-attach", (e, p: { threadId: string; token: string; from?: string }) => live().attach(e.sender, p));
  ipcMain.handle("glyphh-cloud-run-detach", (_e, p: { token: string }) => live().detach(p));
  // The source chip's cloud sections: the member's spaces, and the folders inside one.
  ipcMain.handle("cloud-spaces-list", () => live().spaces());
  ipcMain.handle("cloud-fs-browse", (_e, scope: string, dir?: string) => live().fsBrowse(String(scope ?? ""), dir ? String(dir) : undefined));
  // The cross-surface stop remote-run.ts fires at an observed run's id.
  ipcMain.handle("harness-stop-run", (_e, runId: string) => live().stopRun(String(runId ?? "")));
  // The cloud terminal's bearer (help/harness-api.ts falls back to it on the desktop).
  ipcMain.handle("glyphh-harness-token", () => live().token());
}
