/**
 * remote-run.ts — the renderer's TURN TRANSPORT, routing by the runtime/stator
 * split (server/docs/runtime-stator-split.md): the STATOR is one regional memory
 * plane; the RUNTIME is chosen per session.
 *
 *   LOCAL (machine) session → the attach RELAY (`attach.run`) → the user's own
 *     rrotor — tools on their real folder, memory via /api/stator/*.
 *   everything else → THE SINGLE FRONT DOOR (`harnessViaApi()` → /api/harness/*)
 *     → the org's regional cloud runtime. No pod URL, no per-session
 *     provisioning — the server region-routes and the pod introspects the
 *     user's own bearer (docs/turn-proxy.md).
 *
 * Both paths stream the same HarnessWireFrames onto the same callbacks, so the
 * UI renders identically wherever the turn ran. `threadId` = the CLIENT's chat
 * id — it scopes the pod-side transcript AND the stator memory session.
 *
 * Failure is a TYPED RESULT, not an exception: code.ts renders the designed
 * "runtime not connected" state — never a fake reply.
 *
 * The renderer cannot import from @glyphh/sdk (preload boundary), so the SDK
 * handle's shapes are mirrored here (same discipline as code-source-chip.ts /
 * library-types.ts). They cross window.glyphhSdk verbatim from the SDK.
 *
 * THE DESKTOP HAS NO window.glyphhSdk — its SDK client lives in MAIN. A cloud
 * turn there rides the IPC lane (main/cloud-run.ts: glyphh-cloud-run-*),
 * wrapped by `createIpcCloudRun` into the SAME HarnessRunHandle shape, so
 * everything below the transport — dispatchFrame, the answer seam, the typed
 * outcomes — is one code path for web and desktop (his words, 2026-10-04:
 * "the desktop can reach both the local file system and the sandbox on the
 * ephemeral machine"). A desktop LOCAL session never comes here: main's own
 * loop (glyphhRun) runs it.
 */

import type { Source } from "./code-source-chip.js";
import { devicesForRun, foldersForRun, selfMachineId } from "./devices-pick.js";
import { hostHas } from "./web-surface.js";
import { deviceRowsOf, type DevicesAnswer } from "./devices-rows.js";

// ── SDK handle mirrors (window.glyphhSdk = the raw @glyphh/sdk client) ─────────

/** A harness frame as it rides `glyphh.harness/v1` (SDK contract/harness.ts —
 *  itself the desktop's glyphh-agent frame vocabulary, enveloped). */
export type HarnessWireFrame = (
  | { type: "prompt"; text: string }
  | { type: "open-app"; ref?: string; url?: string }
  /** A build log as it grows (the worker's app_install), or a task program's ctx.log (2026-10-07). */
  | { type: "log"; message: string; detail?: unknown }
  | { type: "delta"; delta: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; phase: "start" | "done"; name: string; thought?: string; title?: string; denied?: boolean; failed?: boolean; preview?: string; detail?: unknown; input?: string; output?: string }
  | { type: "agent"; phase: "start" | "done"; agent: SubAgentRef; task?: string; failed?: boolean; summary?: string }
  | { type: "progress"; inTokens: number; outTokens: number }
  | { type: "credits"; usd: number }
  | { type: "approval"; id: string; kind: string; title: string; detail: string }
  | { type: "ask"; id: string; questions: Array<{ question: string; options?: string[] }> }
  | { type: "setup"; phase: string }
  | { type: "permission"; permission: RemotePermission }
  | { type: "done"; stopped: boolean }
  | { type: "error"; error: string }
) & { seq: number; runId: string; at: number; /** Set on a SUB-AGENT's frame: whose feed it belongs to. */ agent?: SubAgentRef };

/** A sub-agent as the engine names it on every frame of its work. */
export interface SubAgentRef { childId: string; slug: string; name: string; model: string }

/** A frame that belongs to the swarm view, not the thread: a child's own
 *  delta / thinking / tool / approval (tagged `agent`), or the `agent`
 *  start/done frame itself. */
export type SubAgentWireFrame = HarnessWireFrame & { agent: SubAgentRef };

const childOf = (frame: HarnessWireFrame): SubAgentRef | null =>
  frame.agent && typeof frame.agent === "object" && typeof frame.agent.childId === "string" ? frame.agent : null;

interface HarnessRunHandle {
  readonly whenStarted: Promise<{ runId: string; sessionId: string; wire: string }>;
  /** Terminal result — an `error` FRAME resolves (with `error` set); only a
   *  transport-level failure (unreachable pod, wire mismatch) rejects. */
  readonly done: Promise<{ runId: string; stopped: boolean; text: string; error?: string }>;
  on(fn: (frame: HarnessWireFrame) => void): () => void;
  answer(id: string, reply: { allow?: boolean; answers?: string[] }): Promise<void>;
  stop(): Promise<void>;
  /** Change THIS in-flight run's permission mode — the executor re-reads it on the
   *  next tool decision (added with the mid-run mode-change fix). */
  setPermission(mode: RemotePermission): Promise<void>;
}

/** The pod's permission modes — verbatim from the desktop (MODES in code.ts,
 *  enforced by glyphh-agent-permissions.ts locally / rrotor harness/gate.ts in
 *  the pod). Sent per RUN: the pod's own default is `auto`, so a session left
 *  in Ask mode would silently run unattended if we didn't say so. */
export type RemotePermission = "ask" | "plan" | "acceptEdits" | "auto";

/** WHERE THE CALLER IS (SDK HarnessSurface). A cloud run carries it so the
 *  pod's window tools act on the right surface: on the web the page opens
 *  things itself (open-app frames), a desktop keeps the relay. */
export type RunSurface = "web" | "desktop" | "cli";

/** This renderer's surface: app.glyphh.ai (web) or the desktop. */
export function surfaceHere(): RunSurface {
  return (window as unknown as { __GLYPHH_WEB__?: boolean }).__GLYPHH_WEB__ ? "web" : "desktop";
}

/** What an `open-app` frame's `ref` names (his report, 2026-10-06: a web
 *  member's agent opened panels on their DESKTOP; now the pod answers
 *  panels_open / layouts_open / settings_open with this frame and the page
 *  opens the thing itself): `layout:<name>` is a saved workspace,
 *  `settings:<page>` a Settings page, anything else an app slug (a house slug
 *  opens its house panel, as the merged app lane routes it). */
export type OpenRef = { kind: "layout"; name: string } | { kind: "settings"; page: string } | { kind: "app"; slug: string };

export function parseOpenRef(ref: string): OpenRef | null {
  const r = ref.trim();
  if (!r) return null;
  const m = /^(layout|settings):(.*)$/i.exec(r);
  if (!m) return { kind: "app", slug: r };
  const rest = m[2]!.trim();
  if (!rest) return null;
  return m[1]!.toLowerCase() === "layout" ? { kind: "layout", name: rest } : { kind: "settings", page: rest.toLowerCase() };
}

/** The LOOP's memory policy for a turn (mirrors the SDK's HarnessMemoryPolicy):
 *  whether the turn rotates around the stator and how. Absent = runtime default. */
export interface RemoteMemoryPolicy { recall?: boolean; write?: boolean; topK?: number; threshold?: number; entity?: string }

interface HarnessPod {
  start(opts: {
    prompt: string;
    threadId?: string;
    mode?: "work" | "code";
    model?: string;
    permission?: RemotePermission;
    signal?: AbortSignal;
  }): HarnessRunHandle;
}

interface SdkHandle {
  /** THE SINGLE FRONT DOOR: a harness bound to the control-plane turn proxy
   *  (`/api/harness`), auth'd by the user's session token. Region-routes to the
   *  org's regional rrotor + stator — no pod url, no provisioning. */
  harnessViaApi?: () => HarnessPod;
}

const sdk = (): SdkHandle | undefined =>
  (window as unknown as { glyphhSdk?: SdkHandle }).glyphhSdk;

// ── The desktop's cloud lane (preload cloudRun* → main/cloud-run.ts) ─────────

/** What the IPC lane takes to start a cloud turn — main hands it to the SDK's
 *  `client.run({ target: "cloud", … })` verbatim. */
export interface CloudRunStartPayload {
  chatId: string;
  threadId: string;
  prompt: string;
  mode: "work" | "code";
  model?: string;
  loop?: string;
  permission?: RemotePermission;
  effort?: string;
  images?: Array<{ mediaType: string; data: string }>;
  memory?: RemoteMemoryPolicy;
  subdir?: string;
  repo?: string;
  branch?: string;
  /** The attached desktops this session may reach over the relay (HarnessRunBody.devices). */
  devices?: string[];
  /** The member's named cloud environment (personal environments, 2026-10-05); absent = Default. */
  environmentId?: string;
}

export type CloudRunDoneEvent = { chatId: string; runId: string } & (
  | { ok: true; result: { runId: string; stopped: boolean; text: string; error?: string } }
  | { ok: false; error: string }
);

/** The preload bridge's cloud lane, as remote-run drives it. */
export interface CloudRunIpc {
  cloudRunStart: (p: CloudRunStartPayload) => Promise<{ ok: true; runId: string } | { ok: false; error: string }>;
  cloudRunAnswer: (p: { runId: string; id: string; reply: { allow?: boolean; answers?: string[] } }) => Promise<{ ok: boolean; error?: string }>;
  cloudRunStop: (p: { runId?: string; chatId?: string }) => Promise<{ ok: boolean; error?: string }>;
  cloudRunPermission: (p: { runId: string; mode: RemotePermission }) => Promise<{ ok: boolean; error?: string }>;
  onCloudRunFrame: (cb: (p: { chatId: string; runId: string; frame: HarnessWireFrame }) => void) => () => void;
  onCloudRunDone: (cb: (p: CloudRunDoneEvent) => void) => () => void;
}

/** The desktop's lane, when this renderer is the desktop and the bridge has it.
 *  Web's window.glyphh is a Proxy that answers ANY key, so the surface marker
 *  gates first (web always runs through glyphhSdk). */
function desktopCloudLane(): CloudRunIpc | undefined {
  if ((window as unknown as { __GLYPHH_WEB__?: boolean }).__GLYPHH_WEB__) return undefined;
  const ipc = (window as unknown as { glyphh?: Partial<CloudRunIpc> }).glyphh;
  if (typeof ipc?.cloudRunStart !== "function" || typeof ipc.onCloudRunFrame !== "function" || typeof ipc.onCloudRunDone !== "function") return undefined;
  return ipc as CloudRunIpc;
}

/**
 * ONE HarnessRunHandle over the IPC lane's events — the desktop's twin of the
 * SDK's HarnessRun. Frames for this chat (main keys every event by chatId)
 * fan out to `on` subscribers, a late subscriber replays the tape first, the
 * `done` event settles `done` (an `error` FRAME resolves it with `error` set,
 * a transport failure rejects it — the SDK's contract), and answer / stop /
 * setPermission ride back as IPC calls by the run id the start ack minted.
 * Pure over the bridge: the unit test drives it with a fake.
 */
export function createIpcCloudRun(ipc: CloudRunIpc, p: CloudRunStartPayload, signal?: AbortSignal): HarnessRunHandle {
  const subs = new Set<(f: HarnessWireFrame) => void>();
  const tape: HarnessWireFrame[] = [];
  let runId = "";
  let settled = false;
  let started = false;
  let resolveStarted!: (ack: { runId: string; sessionId: string; wire: string }) => void;
  let rejectStarted!: (e: unknown) => void;
  let resolveDone!: (r: { runId: string; stopped: boolean; text: string; error?: string }) => void;
  let rejectDone!: (e: unknown) => void;
  const whenStarted = new Promise<{ runId: string; sessionId: string; wire: string }>((res, rej) => { resolveStarted = res; rejectStarted = rej; });
  const done = new Promise<{ runId: string; stopped: boolean; text: string; error?: string }>((res, rej) => { resolveDone = res; rejectDone = rej; });
  // A consumer watching only one of the two must not crash on the other.
  void whenStarted.catch(() => {});
  void done.catch(() => {});

  const ack = (id: string): void => {
    if (started) return;
    started = true;
    runId = id;
    resolveStarted({ runId: id, sessionId: p.threadId, wire: "glyphh.harness/v1" });
  };
  const settle = (): void => { settled = true; offFrame(); offDone(); };
  const fail = (err: unknown): void => {
    if (settled) return;
    settle();
    if (!started) { started = true; rejectStarted(err); }
    rejectDone(err);
  };

  const offFrame = ipc.onCloudRunFrame((ev) => {
    if (settled || ev.chatId !== p.chatId) return;
    if (!runId && ev.runId) runId = ev.runId;
    tape.push(ev.frame);
    for (const fn of subs) { try { fn(ev.frame); } catch { /* a broken subscriber never takes the run down */ } }
  });
  const offDone = ipc.onCloudRunDone((ev) => {
    if (settled || ev.chatId !== p.chatId) return;
    if (!ev.ok) { fail(new Error(ev.error)); return; }
    settle();
    ack(ev.result.runId || ev.runId || runId);
    resolveDone(ev.result);
  });

  void ipc.cloudRunStart(p).then(
    (r) => { if (r.ok) ack(r.runId); else fail(new Error(r.error)); },
    (err) => fail(err),
  );

  const ref = (): { runId: string } | { chatId: string } => (runId ? { runId } : { chatId: p.chatId });
  const stop = async (): Promise<void> => {
    if (settled) return;
    try { await ipc.cloudRunStop(ref()); } catch { /* main unreachable — nothing to stop */ }
  };
  if (signal?.aborted) void stop();
  else signal?.addEventListener("abort", () => void stop(), { once: true });

  return {
    whenStarted,
    done,
    on(fn) {
      for (const f of tape) fn(f);
      subs.add(fn);
      return () => { subs.delete(fn); };
    },
    async answer(id, reply) {
      const { runId: rid } = await whenStarted;
      const r = await ipc.cloudRunAnswer({ runId: rid, id, reply });
      if (!r?.ok) throw new Error(r?.error || "answer not delivered");
    },
    stop,
    async setPermission(mode) {
      if (settled) return;
      const { runId: rid } = await whenStarted;
      const r = await ipc.cloudRunPermission({ runId: rid, mode });
      if (!r?.ok) throw new Error(r?.error || "permission not delivered");
    },
  };
}

// ── The chat's runtime binding — mirrors code.ts's CodeChat (kept structural so
//    remote-run doesn't reach back into code.ts's interfaces). ────────────────
export interface RuntimeBinding { sessionId: string; url: string; token: string }
export interface RemoteChat {
  /** The attached desktops this session may reach (the + menu's Devices); absent = every attached one. */
  devices?: string[];
  id: string;
  source?: Source;
  /** The session's SPACE + toolbelt (code.ts modeOf) — rides every run. */
  mode?: "work" | "code";
  /** LEGACY pre-mode flag (code.ts) — folded in by modeFor, never written. */
  chat?: boolean;
  /** Bound after a successful provision — reused for every later turn. */
  runtime?: RuntimeBinding;
  [k: string]: unknown;
}

/** How long the runtime waits before deciding FOR the user. Mirrored from the
 *  pod (rrotor `harness/gate.ts`) — and identical to the desktop's local gate
 *  (`glyphh-agent-permissions.ts`), so the dock's countdown is honest on BOTH
 *  paths and there is one set of numbers in the UI. */
export const APPROVAL_TIMEOUT_MS = 120_000;
export const ASK_TIMEOUT_MS = 10 * 60_000;

// ── The answer seam ───────────────────────────────────────────────────────────
//
// A parked `approval`/`ask` frame is answered on the RUN HANDLE that streamed it
// (`run.answer(id, …)` → POST /runs/:id/answer). The handle is owned by
// runRemoteTurnOnce and must not leak into the UI, so a parked frame registers
// its id here and the renderer answers BY ID — exactly the shape the desktop's
// local path has (`window.glyphh.glyphhApprovalRespond(id, allow)` → main's
// pending map). code.ts therefore routes both paths through one call: try this
// registry, and an id it doesn't know is a LOCAL card and goes over IPC.
//
// Entries are dropped the moment they're answered and swept when their run
// settles, so a stopped/finished run leaves nothing behind.

interface PendingAnswer { run: HarnessRunHandle; kind: "approval" | "ask"; deadline: number }
const pending = new Map<string, PendingAnswer>();

/** What answering did: `sent` reached the pod, `late` means the pod had already
 *  resolved it on its own (its timeout fired first — a 404 we swallow), and
 *  `unknown` means this id was never a REMOTE card (the caller should try the
 *  local IPC path). Never throws — a dead pod must not break a click. */
export type AnswerRouting = "sent" | "late" | "unknown";

/** The wall-clock instant the runtime decides on its own, for a parked id. */
export function pendingDeadline(id: string): number | undefined {
  return pending.get(id)?.deadline;
}

/** Answer a parked REMOTE approval (`{allow}`) or ask (`{answers}`). */
export async function answerPending(
  id: string,
  reply: { allow?: boolean; answers?: string[] },
): Promise<AnswerRouting> {
  const entry = pending.get(id);
  if (!entry) return "unknown";
  // Drop it FIRST: a double-click must not post twice, and a failed post means
  // the pod already moved on — there is nothing left to answer either way.
  pending.delete(id);
  try {
    await entry.run.answer(id, reply);
    return "sent";
  } catch (err) {
    try { console.warn("[remote-run] answer landed too late", { id, detail: err instanceof Error ? err.message : String(err) }); } catch { /* no console */ }
    return "late";
  }
}

/** Forget every id parked on a run that has settled (done/stopped/failed). */
function forgetPending(run: HarnessRunHandle): void {
  for (const [id, entry] of pending) if (entry.run === run) pending.delete(id);
}

// ── Live remote-run handles, by threadId (chat id) — the mid-run mode push seam.
// A turn started here holds its handle so a mode-chip flip mid-turn can reach the
// executor (cloud pod or the attached desktop) via handle.setPermission → the
// server's /permission route. Cleared when the run settles.
const liveRemote = new Map<string, HarnessRunHandle>();

/** Change a live remote run's permission mode mid-flight. No live run for the
 *  chat → a harmless no-op (returns false). Never throws. */
export async function setRemotePermission(chatId: string, mode: RemotePermission): Promise<boolean> {
  const run = liveRemote.get(chatId);
  if (!run?.setPermission) return false;
  try { await run.setPermission(mode); return true; }
  catch { return false; }
}

/** A session's source is remote iff it runs in the cloud (cloud-new/cloud-repo). */
export function isRemoteSource(source?: Source): boolean {
  return !!source && source.kind !== "local";
}

/** A remote turn is routed here on WEB (the SDK handle is exposed) and, for a
 *  CLOUD source, on the DESKTOP (main's cloud lane); a desktop local session
 *  stays on the local harness (window.glyphh.glyphhRun → main). */
export function canRunRemote(source?: Source): boolean {
  return isRemoteSource(source) && (!!sdk()?.harnessViaApi || !!desktopCloudLane());
}

/** The honest typed failure — never thrown to the UI, always rendered as the
 *  designed "runtime not connected" state. */
export interface Unavailable { ok: false; unavailable: true; stage: string; detail: string; sessionId?: string }
function unavailable(stage: string, err: unknown): Unavailable {
  const detail = err instanceof Error ? err.message : String(err);
  try { console.warn("[remote-run] unavailable", { stage, detail }); } catch { /* no console */ }
  return { ok: false, unavailable: true, stage, detail };
}

/**
 * Ensure the chat has a live runtime binding, provisioning one if needed and
 * persisting it via `save`. Reuses an existing binding (later turns don't
 * re-provision). On an unavailable provision that still minted a session id, the
 * id is bound onto the chat (the session exists server-side — never orphan it).
 * Returns the binding or a typed unavailable result.
 */
export async function ensureRuntime(
  chat: RemoteChat,
  save: () => void,
  _opts: { rotor?: unknown; signal?: AbortSignal; forceFresh?: boolean } = {},
): Promise<{ ok: true; runtime: RuntimeBinding } | Unavailable | { ok: false; stopped: true }> {
  // SINGLE FRONT DOOR: nothing to provision — a turn goes straight through
  // `harnessViaApi()`, region-routed server-side. Hand back a synthetic binding
  // so the UI reads "connected" (isCommitted) instantly. The per-session
  // provision-and-poll path was deleted with the cutover (no-dead-code).
  if (sdk()?.harnessViaApi || desktopCloudLane()) {
    const runtime: RuntimeBinding = { sessionId: chat.id, url: "api", token: "api" };
    chat.runtime = runtime; save();
    return { ok: true, runtime };
  }
  return unavailable("open", new Error("this build cannot run turns (SDK harnessViaApi missing)"));
}

/** The session's effective TYPE for the pod — the mirror of code.ts's modeOf:
 *  Work or Code, with the legacy chat flag and the retired `cowork`/`chat`
 *  stamps reading as Work (his order, 2026-09-29). */
function modeFor(chat: RemoteChat): "work" | "code" {
  const m = chat.mode ?? (chat.chat ? "work" : "code");
  return m === "code" ? "code" : "work";
}

/** The stream callbacks — mirror code.ts's CURRENT (glyphhRun) run event model so
 *  the thread renders identically whether a turn is local or remote:
 *    onStep   ≈ onGlyphhAgentTool  (a step/tool breadcrumb)
 *    onToken  ≈ onGlyphhAgentDelta (a streamed answer delta — appended)
 *    onDone   ≈ onGlyphhAgentDone
 *    onError  ≈ onGlyphhAgentError
 *    onStopped is onDone with stopped=true (the user aborted). */
export interface RemoteRunCallbacks {
  onStep?: (step: { id: string; type: string; status: string; error?: string }) => void;
  /** Richer per-tool breadcrumb than onStep — fires on BOTH start and finish and
   *  carries the tool's thought, human title, and diff badge. Additive: desktop
   *  keeps using onStep unchanged; the mobile UI uses this to render a collapsible
   *  tool group with proper ✓/✕ rows and [+N -M] badges. Correlate start→done by
   *  name (the most recent still-running step of that name). */
  onTool?: (t: {
    name: string;
    phase: "start" | "done";
    status: "running" | "ok" | "denied" | "failed";
    thought?: string;
    title?: string;
    diff?: string;     // "[+N -M]"
    error?: string;
  }) => void;
  /** Live usage for the turn — dollars as the runtime meters them, and token
   *  progress. Additive; desktop ignores it. Mobile shows a per-turn
   *  dollars + duration footer. */
  onUsage?: (u: { usd?: number; inTokens?: number; outTokens?: number }) => void;
  onToken?: (delta: string) => void;
  /** The model's thinking, streamed — the fold above the answer (code.ts
   *  thinkingEl); the local path's `glyphh-agent:thinking`. */
  onThinking?: (text: string) => void;
  /** A SUB-AGENT's frame (tagged `agent`), or an agent start/done. The thread
   *  never sees these (a child's words would read as the parent's answer);
   *  the Agents work panel builds the swarm view from them (subagent-feed.ts).
   *  A child's approval ALSO reaches onApproval, titled with the child's name:
   *  the person is the only one who can answer it. */
  onAgentFrame?: (frame: SubAgentWireFrame) => void;
  onAnswer?: (fullText: string) => void;
  /** The turn's USER prompt — the run's first frame. Only surfaces OBSERVING a run
   *  started elsewhere render this (the initiating surface already has its own bubble,
   *  so it omits this callback). */
  onUserPrompt?: (text: string) => void;
  /** The agent asked to SHOW an app/page — the watching surface renders it
   *  natively (web/desktop → workbench panel, mobile → tray). Only fired on
   *  frames from CLOUD runs here; desktop-executed runs open machine-side. */
  onOpenApp?: (t: { ref?: string; url?: string }) => void;
  /** A LOG frame — a build's log as it grows (the worker's app_install),
   *  or a task program's ctx.log. The thread draws a build's on its app card. */
  onLog?: (l: { message: string; detail?: unknown }) => void;
  onDone?: (fullText: string) => void;
  onStopped?: () => void;
  onError?: (detail: string) => void;
  /** A tool wants permission — the run is PARKED until `answerPending(id,
   *  {allow})` (or the runtime's own deadline). Same payload the desktop's
   *  `glyphh-agent:approval` IPC carries, plus the deadline. */
  onApproval?: (a: RemoteApprovalRequest) => void;
  /** The agent is asking the user — parked until `answerPending(id, {answers})`
   *  (or the deadline). Mirrors `glyphh-agent:ask`. */
  onAsk?: (a: RemoteAskRequest) => void;
  /** The run's permission mode changed mid-flight (another surface flipped it) —
   *  the surface repaints its mode chip. Rides the frame stream so observers stay
   *  in lockstep with the surface that made the change. */
  onPermission?: (mode: RemotePermission) => void;
}

export interface RemoteApprovalRequest { id: string; kind: string; title: string; detail: string; deadline: number }
export interface RemoteAskRequest { id: string; questions: Array<{ question: string; options?: string[] }>; deadline: number }

export type RemoteRunOutcome =
  | { ok: true; text: string; runtime: RuntimeBinding; error?: string }
  | { ok: false; stopped: true; runtime?: RuntimeBinding }
  | { ok: false; error: string; runtime?: RuntimeBinding }
  | Unavailable;

/** Map one harness frame onto the UI callbacks. `delta` appends; `tool` leaves a
 *  breadcrumb on start (and on a denied/failed finish); `approval`/`ask` PARK the
 *  run — the id is registered on the answer seam and handed to the UI, which
 *  answers it through `answerPending`. A caller with no approval UI (no
 *  onApproval/onAsk) still gets an honest breadcrumb and rides the POD's timeout
 *  (approval → denied after ~2min; ask → answered empty after ~10min, the agent
 *  re-plans). progress/credits/setup: no UI mapping. */
export function dispatchFrame(
  frame: HarnessWireFrame,
  cb: RemoteRunCallbacks,
  state: { text: string; error: string | null },
  run: HarnessRunHandle,
): void {
  // THE SWARM'S FRAMES (his report, 2026-10-05: the web's Agents panel showed
  // nothing): a child's frames and the agent start/done go to the feed, and a
  // child's delta/thinking/tool stop here — never the parent's bubble. Its
  // approval goes on to the dock below, named.
  const child = childOf(frame);
  if (child || frame.type === "agent") cb.onAgentFrame?.(frame as SubAgentWireFrame);
  if (frame.type === "agent" || (child && frame.type !== "approval")) return;
  switch (frame.type) {
    case "log":
      cb.onLog?.({ message: String((frame as { message?: unknown }).message ?? ""), detail: (frame as { detail?: unknown }).detail });
      return;
    case "open-app":
      cb.onOpenApp?.({ ...(frame.ref ? { ref: frame.ref } : {}), ...(frame.url ? { url: frame.url } : {}) });
      break;
    case "prompt":
      cb.onUserPrompt?.(frame.text);
      return;
    case "delta":
      state.text += frame.delta;
      cb.onToken?.(frame.delta);
      cb.onAnswer?.(state.text);
      return;
    case "thinking":
      cb.onThinking?.(frame.text);
      return;
    case "tool":
      if (frame.phase === "start") {
        cb.onStep?.({ id: `${frame.name}#${frame.seq}`, type: frame.name, status: "" });
        // `title` rides the start frame too now (the call's key input — the
        // command, the file path); forward it so live rows show the work.
        cb.onTool?.({
          name: frame.name,
          phase: "start",
          status: "running",
          ...(frame.thought ? { thought: frame.thought } : {}),
          ...(frame.title ? { title: frame.title } : {}),
        });
      } else {
        if (frame.denied || frame.failed) {
          cb.onStep?.({ id: `${frame.name}#${frame.seq}`, type: frame.name, status: frame.denied ? "denied" : "failed", ...(frame.title ? { error: frame.title } : {}) });
        }
        const diff = /\[\+\d+ -\d+\]/.exec(String(frame.preview ?? ""))?.[0] ?? "";
        cb.onTool?.({
          name: frame.name,
          phase: "done",
          status: frame.denied ? "denied" : frame.failed ? "failed" : "ok",
          ...(frame.title ? { title: frame.title } : {}),
          ...(diff ? { diff } : {}),
          ...((frame.denied || frame.failed) && frame.preview ? { error: String(frame.preview).split("\n")[0].slice(0, 140) } : {}),
        });
      }
      return;
    case "approval": {
      if (!cb.onApproval) {
        cb.onStep?.({
          id: frame.id,
          type: "approval",
          status: `${frame.title} — nothing here can answer; auto-denied by the runtime if unanswered`,
        });
        return;
      }
      // The deadline is measured from RECEIPT, not the frame's pod-side `at`:
      // the two clocks are unrelated, and overshooting by the network hop is
      // the safe direction for a countdown the user acts on.
      const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
      pending.set(frame.id, { run, kind: "approval", deadline });
      cb.onApproval({ id: frame.id, kind: frame.kind, title: child ? `${child.name}: ${frame.title}` : frame.title, detail: frame.detail, deadline });
      return;
    }
    case "ask": {
      if (!cb.onAsk) {
        cb.onStep?.({
          id: frame.id,
          type: "question",
          status: `${frame.questions.map((q) => q.question).join(" · ")} — nothing here can answer; the agent continues without one after the runtime's timeout`,
        });
        return;
      }
      const deadline = Date.now() + ASK_TIMEOUT_MS;
      pending.set(frame.id, { run, kind: "ask", deadline });
      cb.onAsk({ id: frame.id, questions: frame.questions, deadline });
      return;
    }
    case "permission":
      cb.onPermission?.(frame.permission);
      return;
    case "error":
      state.error = frame.error || "the runtime reported an error";
      return;
    case "credits":
      cb.onUsage?.({ usd: frame.usd });
      return;
    case "progress":
      cb.onUsage?.({ inTokens: frame.inTokens, outTokens: frame.outTokens });
      return;
    default:
      // setup / done — no UI mapping (done resolves run.done).
      return;
  }
}

/**
 * Run ONE remote turn end to end. Provisions/reuses the runtime, opens the
 * harness data plane, streams the frames through the callbacks, and resolves a
 * typed outcome. Never throws to the caller — every failure is a typed result
 * the UI can render as the honest not-connected / turn-error state.
 */
/** The synthetic runtime binding a relay (on-machine) run carries — it has no
 *  cloud pod, but a non-empty binding keeps `isCommitted` true so the session
 *  doesn't try to provision a cloud pod on open. */
const RELAY_RUNTIME = (chat: RemoteChat): RuntimeBinding => ({ sessionId: chat.id, url: "relay", token: "relay" });

// The id a run THREADS on — the same id the server keys the thread's active-run
// pointer by, and thus the id every surface must OBSERVE by. A cloud-space session
// re-enters an existing workspace, so it threads on the space's original id (not the
// local chat id); everything else threads on the chat id. Both the producer (runRemoteTurn)
// and the observer (attachToActiveRun) MUST derive this identically or a reattach polls the
// wrong key and never finds the live run (his bug: web/mobile can't reattach to an off-desktop
// session in progress).
/** The attached desktops, by machine id, from the Devices page's read. */
async function attachedDeviceIds(): Promise<string[]> {
  const read = (window.glyphh as unknown as { attachDevicesList?: () => Promise<DevicesAnswer> }).attachDevicesList;
  if (!read) return [];
  const a = await read().catch(() => null);
  return a ? deviceRowsOf(a).devices.map((d) => d.machineId) : [];
}
async function devicesForTurn(chat: RemoteChat): Promise<string[]> {
  return devicesForRun(chat.devices, await attachedDeviceIds());
}
/** THE TURN'S OWN FOLDER on the desktop it was born on (his report,
 *  2026-10-07): a desktop-born cloud turn whose thread folder is a local path
 *  names this machine's folder beside the grants, so the device tools reach
 *  it with no device step. Nothing on the web, nothing without the folder,
 *  nothing when this desktop is not among the turn's devices. */
async function foldersForTurn(folder: string, devices: readonly string[]): Promise<Record<string, string[]>> {
  // hostHas: the web's Proxy answers every name, so a typeof check is no gate.
  if (surfaceHere() !== "desktop" || !folder || !hostHas("remoteControlGet") || !hostHas("attachDevicesList")) return {};
  const g = window.glyphh as unknown as { remoteControlGet: () => Promise<{ device?: string }>; attachDevicesList: () => Promise<DevicesAnswer> };
  const [status, list] = await Promise.all([g.remoteControlGet().catch(() => null), g.attachDevicesList().catch(() => null)]);
  const selfId = list && status?.device ? selfMachineId(deviceRowsOf(list).devices, status.device) : null;
  return foldersForRun({ surface: "desktop", folder, selfId, devices });
}

export function runThreadId(chat: RemoteChat): string {
  return chat.source?.kind === "cloud-space"
    ? String((chat.source as { space?: string }).space || chat.id)
    : chat.id;
}



/**
 * THE ONE PATH. Run a turn through the SDK's single `run()` entry, which routes on
 * where execution belongs: a LOCAL (machine-bound) session runs on the user's OWN
 * machine over the relay (`target: 'desktop'` — tools touch its real folder); every
 * other session runs on the cloud runtime through the region-routed front door
 * (`target: 'cloud'`). BOTH reach the SAME regional stator for memory and stream the
 * SAME frames — so the UI is identical and there is exactly one code path here.
 * (docs/runtime-stator-split.md: the cloud pod rejects a caller workdir by design,
 * so a local session must carry `target: 'desktop'`.)
 */
export async function runRemoteTurn(
  chat: RemoteChat,
  prompt: string,
  save: () => void,
  callbacks: RemoteRunCallbacks = {},
  opts: { rotor?: unknown; model?: string; permission?: RemotePermission; effort?: string; signal?: AbortSignal; images?: Array<{ mediaType: string; data: string }>; memory?: RemoteMemoryPolicy } = {},
): Promise<RemoteRunOutcome> {
  void save; // callers keep it in the signature; nothing binds a pod per session now
  const client = sdk() as unknown as { run?: (o: unknown) => HarnessRunHandle } | undefined;
  // Called ON the client (the SDK's resources reach for their own `this`).
  const sdkRun = client?.run ? (o: unknown): HarnessRunHandle => client.run!(o) : null;
  const lane = sdkRun ? undefined : desktopCloudLane();
  if (!sdkRun && !lane) {
    const u = unavailable("open", new Error("this build cannot run turns (SDK run missing)"));
    callbacks.onError?.(u.detail);
    return u;
  }

  const isLocal = chat.source?.kind === "local";
  // The desktop's lane is the CLOUD only: its local sessions are main's own
  // loop (code.ts never routes one here — canRunRemote says no).
  if (lane && isLocal) {
    const u = unavailable("open", new Error("a desktop session runs on this machine's own loop, not the cloud lane"));
    callbacks.onError?.(u.detail);
    return u;
  }
  // Runtime binding for the UI's isCommitted state: the relay marker for an
  // on-machine run, a synthetic api binding for the front door (no pod url to hold).
  chat.runtime = isLocal ? RELAY_RUNTIME(chat) : { sessionId: chat.id, url: "api", token: "api" };
  // The working folder MUST match the send-gate's source of truth (code.ts:
  // `chat.workdir || source.path`). The resolved `workdir` is authoritative — the
  // folder picker and workspace stamps write there, and `source.path` only SEEDS
  // it — so a folder held in `chat.workdir` with an empty `source.path` (e.g. after
  // a reload/retry) would otherwise dispatch folder-less and the desktop would fall
  // back to its own cwd, losing the session's real folder. Local sessions only:
  // the cloud pod rejects a caller workdir by design (runtime-stator-split.md).
  const boundDir = typeof chat.workdir === "string" ? chat.workdir.trim() : "";
  const localPath = chat.source?.kind === "local" ? chat.source.path : "";
  const workdir = isLocal ? (boundDir || localPath || undefined) : undefined;
  // The session's GitHub repo — the cloud workspace's SOURCE. The pod tells
  // the agent and instructs clone-if-absent, so "clone the repo" needs no
  // follow-up question.
  const repo = chat.source?.kind === "cloud-repo" ? String((chat.source as { repo?: string }).repo || "") : "";
  // The BASE BRANCH the pick named (his direction, 2026-10-05: a developer
  // picks a repo and a base branch, like Claude Code on the web). It rides
  // only beside the repo; the front door validates it and the worker's clone
  // checks it out (SDK RunTurnOptions.branch, rrotor config.branch).
  const branch = repo && chat.source?.kind === "cloud-repo" ? String((chat.source as { branch?: string }).branch || "").trim() : "";
  // The member's named cloud ENVIRONMENT (his direction, 2026-10-05: personal
  // environments): the id rides beside the repo; the front door resolves it to
  // the variables + network policy server-side. Default is the absent id.
  const environmentId = chat.source?.kind === "cloud-repo" ? String((chat.source as { environmentId?: string }).environmentId || "").trim() : "";
  // A cloud-space session RE-ENTERS an existing workspace: the run threads on
  // the space's original id so the pod resolves the same folder the space was
  // born with (and the fs panels scope identically — cloud-fs-router/wb-pod).
  const threadId = runThreadId(chat);
  // THE DEVICES THE TURN MAY REACH (his order, 2026-10-07): the session's
  // list, else every attached desktop; a cloud turn names them and the
  // gateway's device tools open those machines inside their granted folders.
  const devices = isLocal ? [] : await devicesForTurn(chat);
  // The thread's folder, when a cloud turn names a local one (the Folder chip
  // on the desktop): it rides for THIS machine beside the grants.
  const folders = isLocal ? {} : await foldersForTurn(boundDir || localPath || "", devices);

  let run: HarnessRunHandle;
  try {
    run = lane ? createIpcCloudRun(lane, {
      chatId: chat.id,
      threadId,
      prompt,
      mode: modeFor(chat),
      ...(chat.source && chat.source.kind !== "local" && (chat.source as { dir?: string }).dir
        ? { subdir: String((chat.source as { dir?: string }).dir) } : {}),
      ...(repo ? { repo } : {}),
      ...(repo && branch ? { branch } : {}),
      ...(environmentId && environmentId !== "default" ? { environmentId } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.rotor ? { loop: String(opts.rotor) } : {}),
      ...(opts.permission ? { permission: opts.permission } : {}),
      ...(opts.effort ? { effort: opts.effort } : {}),
      ...(opts.images && opts.images.length ? { images: opts.images } : {}),
      ...(opts.memory ? { memory: opts.memory } : {}),
      ...(devices.length ? { devices } : {}),
      ...(Object.keys(folders).length ? { folders } : {}),
    }, opts.signal) : sdkRun!({
      target: isLocal ? "desktop" : "cloud", // the one decision: your machine, or the cloud
      // The machine the session is bound to (remote control, 2026-09-30) — absent, the newest.
      ...(isLocal && chat.source?.kind === "local" && chat.source.machineId ? { machineId: chat.source.machineId } : {}),
      prompt,
      threadId, // stable id → transcript + memory + WORKSPACE scope
      ...(chat.source && chat.source.kind !== "local" && (chat.source as { dir?: string }).dir
        ? { subdir: String((chat.source as { dir?: string }).dir) } : {}),
      mode: modeFor(chat),
      ...(workdir ? { workdir } : {}),
      ...(repo ? { repo } : {}),
      ...(repo && branch ? { branch } : {}),
      ...(environmentId && environmentId !== "default" ? { environmentId } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.rotor ? { loop: String(opts.rotor) } : {}),
      ...(opts.permission ? { permission: opts.permission } : {}),
      // The composer's effort dial rides a cloud turn too (SDK RunTurnOptions.effort,
      // 2026-10-04); a desktop-relay turn keeps the machine's own setting.
      ...(opts.effort && !isLocal ? { effort: opts.effort } : {}),
      // THE RUN CARRIES ITS SURFACE (2026-10-06): the pod's window tools act
      // where the member is — on the web the page opens panels, workspaces
      // and Settings itself; nothing relays to a desktop.
      ...(!isLocal ? { surface: surfaceHere() } : {}),
      ...(devices.length ? { devices } : {}),
      ...(Object.keys(folders).length ? { folders } : {}),
      ...(opts.images && opts.images.length ? { images: opts.images } : {}),
      ...(opts.memory ? { memory: opts.memory } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) { const u = unavailable("open", err); callbacks.onError?.(u.detail); return u; }

  // Hold the handle so a mid-turn mode-chip flip can push to this run (the
  // executor re-reads it per tool decision). Keyed by the chat/thread id.
  liveRemote.set(chat.id, run);
  const state = { text: "", error: null as string | null };
  const off = run.on((frame) => { if (opts.signal?.aborted) return; dispatchFrame(frame, callbacks, state, run); });
  let stopped = false;
  try {
    const result = await run.done;
    stopped = result.stopped ?? false;
    if (result.error && !state.error) state.error = result.error;
  } catch (err) {
    off(); forgetPending(run); liveRemote.delete(chat.id);
    if (opts.signal?.aborted) { callbacks.onStopped?.(); return { ok: false, stopped: true, runtime: chat.runtime }; }
    if (!state.text) { const u = unavailable("stream", err); callbacks.onError?.(u.detail); return u; }
    state.error = err instanceof Error ? err.message : String(err);
  }
  off(); forgetPending(run); liveRemote.delete(chat.id);
  if (opts.signal?.aborted || stopped) { callbacks.onStopped?.(); return { ok: false, stopped: true, runtime: chat.runtime }; }
  if (state.error && !state.text) { callbacks.onError?.(state.error); return { ok: false, error: state.error, runtime: chat.runtime }; }
  callbacks.onDone?.(state.text);
  return { ok: true, text: state.text, runtime: chat.runtime, ...(state.error ? { error: state.error } : {}) };
}

// ── Attach to a run happening ELSEWHERE (the run-stream broker consumer) ───────

/** The SDK's `runStream` resource (window.glyphhSdk.runStream), mirrored here the
 *  same way HarnessPod is — the renderer can't import @glyphh/sdk across preload. */
interface RunStreamResource {
  attach(threadId: string, opts?: { from?: string }): {
    on(cb: (frame: HarnessWireFrame) => void): () => void;
    onRun(cb: (runId: string) => void): () => void;
    stop(): void;
  };
}

export interface AttachHandle { readonly runId: string | null; stop(): void }

/** Cross-surface STOP by run id — the seam stopThinking() uses when this page
 *  holds no local run handle (the run was launched before a refresh, or on
 *  another surface, and we are only OBSERVING it through the broker). Web goes
 *  straight through the SDK front door; desktop rides a main-process IPC. */
export async function stopRunById(runId: string): Promise<boolean> {
  const c = sdk() as unknown as { harnessViaApi?: () => { stopRun?: (id: string) => Promise<void> } };
  if (typeof c?.harnessViaApi === "function") {
    try { await c.harnessViaApi().stopRun?.(runId); return true; } catch { return false; }
  }
  const ipc = (window as unknown as { glyphh?: { harnessStopRun?: (id: string) => Promise<{ ok?: boolean }> } }).glyphh;
  if (typeof ipc?.harnessStopRun === "function") {
    try { return (await ipc.harnessStopRun(runId))?.ok !== false; } catch { return false; }
  }
  return false;
}

// ── Desktop observer transport ────────────────────────────────────────────────
// Web exposes the browser SDK (window.glyphhSdk) so the observer consumes the
// broker directly. The desktop renderer is IPC-only: the main process holds the
// SDK client and forwards frames over the cloud lane's observe channels
// (main/cloud-run.ts: glyphh-cloud-run-attach / -detach). The renderer mints
// the subscription token so pushed events are filterable from the very first
// frame — no id-assignment race.
interface RunStreamIpc {
  runStreamAttach?: (threadId: string, token: string) => Promise<{ ok: boolean; error?: string }>;
  runStreamStop?: (token: string) => Promise<{ ok: boolean }>;
  onRunStreamFrame?: (cb: (p: { token: string; frame: HarnessWireFrame }) => void) => () => void;
  onRunStreamRun?: (cb: (p: { token: string; runId: string }) => void) => () => void;
}

function ipcRunStream(): RunStreamResource | undefined {
  // Web's window.glyphh is a Proxy that returns a callable for ANY key, so the
  // typeof probes below can't tell it apart from the real preload — gate on the
  // surface marker instead (web always observes through glyphhSdk).
  if ((window as unknown as { __GLYPHH_WEB__?: boolean }).__GLYPHH_WEB__) return undefined;
  const ipc = (window as unknown as { glyphh?: RunStreamIpc }).glyphh;
  if (typeof ipc?.runStreamAttach !== "function" || typeof ipc.onRunStreamFrame !== "function") return undefined;
  return {
    attach: (threadId) => {
      const token = `rs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const frameCbs = new Set<(f: HarnessWireFrame) => void>();
      const runCbs = new Set<(runId: string) => void>();
      let stopped = false;
      const offFrame = ipc.onRunStreamFrame?.((p) => {
        if (p.token === token) for (const cb of frameCbs) cb(p.frame);
      });
      const offRun = ipc.onRunStreamRun?.((p) => {
        if (p.token === token) for (const cb of runCbs) cb(p.runId);
      });
      void ipc.runStreamAttach?.(threadId, token).then((r) => {
        // Attach refused (signed out, bad thread) — tear the listeners down so
        // a dead subscription doesn't linger for the tab's lifetime.
        if (!r?.ok && !stopped) { offFrame?.(); offRun?.(); }
      }).catch(() => { /* main unavailable — observer stays a no-op */ });
      return {
        on: (cb) => { frameCbs.add(cb); return () => { frameCbs.delete(cb); }; },
        onRun: (cb) => { runCbs.add(cb); return () => { runCbs.delete(cb); }; },
        stop: () => {
          if (stopped) return;
          stopped = true;
          offFrame?.(); offRun?.();
          void ipc.runStreamStop?.(token);
        },
      };
    },
  };
}

/**
 * "Open a thread anywhere, see the live turn." A surface OBSERVES a thread's
 * currently-active run — wherever it executes (this user's desktop or a cloud pod)
 * — by asking the broker for the thread's active run, then subscribing to that run's
 * durable frame stream (replay the tape so far, then follow live). Frames drive the
 * SAME callbacks a live turn uses, so the thread renders identically.
 *
 * READ-ONLY: this surface does not own answering approvals/asks (the executing
 * surface does), so pass no `onApproval`/`onAsk` — parked frames land as honest
 * breadcrumbs and the run rides its owner's answer. `onAttached` fires ONCE with the
 * runId before any frame, so the caller can seed its live-run state first. Returns a
 * null-runId handle (a no-op) when nothing is running — safe to call on every open.
 */
export function attachToActiveRun(
  chat: RemoteChat,
  callbacks: RemoteRunCallbacks = {},
  onRun?: (runId: string) => void,
): AttachHandle {
  // Web: the browser SDK's broker consumer. Desktop: the IPC bridge to the
  // main-process SDK client. Neither present (tests, logged-out) → no-op.
  const webRs = (sdk() as unknown as { runStream?: RunStreamResource })?.runStream;
  // On the DESKTOP a local thread's run is main's own: the live ledger and
  // glyphh-agent-run-adopt reconnect it, so only a cloud thread is observed
  // through the lane (a local one would ask the pod about a run it never had).
  if (!webRs && !isRemoteSource(chat.source)) return { runId: null, stop: () => {} };
  const rs = webRs ?? ipcRunStream();
  if (!rs?.attach) return { runId: null, stop: () => {} };

  // ONE call: the SDK owns "watch this thread and stream whatever runs on it, run after
  // run, forever until stop." This function is just the shared frame->callbacks glue every
  // surface reuses; it does NOT know or care where a run executes. `onRun` fires per run so
  // the surface can start a fresh turn; a terminal frame fires onDone/onError.
  // dispatchFrame only touches `run` to PARK approval/ask (which an observer omits), so the
  // stub handle is never dereferenced.
  const stubRun = {} as unknown as HarnessRunHandle;
  let state = { text: "", error: null as string | null };
  // Observe by the SAME id the run threaded on — a cloud-space session's active-run
  // pointer is keyed by its space id, not chat.id, so attaching by chat.id would poll
  // the wrong key and never discover the live off-desktop run.
  const h = rs.attach(runThreadId(chat), { from: "0" });
  h.onRun((runId) => { state = { text: "", error: null }; onRun?.(runId); });
  h.on((frame) => {
    dispatchFrame(frame, callbacks, state, stubRun);
    if (frame.type === "done") callbacks.onDone?.(state.text);
    else if (frame.type === "error") callbacks.onError?.(state.error || "the run reported an error");
  });
  return { runId: null, stop: () => h.stop() };
}
