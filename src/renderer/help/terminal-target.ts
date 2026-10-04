/**
 * terminal-target.ts — WHERE a Terminal tile's shell runs, as one pure rule
 * (his report, 2026-10-04: "What happened to my terminals in the cloud?").
 *
 * A session's locus decides. A CLOUD session's shell is the pod's pty over
 * the harness lane (remote-terminal.ts target "worker"), in the thread's
 * workspace — on the desktop AND on app.glyphh.ai. A LOCAL session's shell
 * runs on the user's machine: the desktop spawns it itself (node-pty over
 * wb-term IPC); the web reaches it over the relay (target "desktop"). A slot
 * may pin its far side (a CLI session resumed off the machine's own stores
 * runs THERE, whatever the current session's locus): "desktop" means the
 * user's machine — the local pty on the desktop surface, the relay on the web.
 *
 * The decision is data in, data out, so both surfaces and the tests share it;
 * code-workbench.ts reads the live session and hands it in.
 */

export type TerminalSurface = "desktop" | "web";
export type TerminalFarSide = "worker" | "desktop";

/** What code-workbench knows about the current session's source. */
export interface TerminalSourceLike {
  kind: string;
  /** cloud-space: the thread id that keyed the pod workspace. */
  space?: string;
  /** A folder INSIDE the cloud workspace (relative), when one was picked. */
  dir?: string;
}

export interface TerminalTransportInput {
  surface: TerminalSurface;
  /** The current session's source (code.ts activeSource()); absent = none known. */
  source?: TerminalSourceLike | null;
  /** The current session's id — the worker shell's fs scope for a born cloud thread. */
  chatId?: string | null;
  /** The slot's own pinned far side, when a CLI session was resumed somewhere specific. */
  slotTarget?: TerminalFarSide;
}

export type TerminalTransport =
  /** The desktop's own pty (wb-term IPC). */
  | { kind: "local" }
  /** The pod's pty over /api/harness/pty — `scope` names the workspace, `cwd` a folder inside it. */
  | { kind: "remote"; target: "worker"; scope: string; cwd?: string }
  /** The attached desktop's pty over the relay (web only). */
  | { kind: "remote"; target: "desktop" };

/** Anything not local is the cloud (session-locus.ts's rule). No source = no locus. */
export function isCloudSource(source: TerminalSourceLike | null | undefined): boolean {
  return !!source && !!source.kind && source.kind !== "local";
}

/** The workspace a cloud session's shell runs in: a re-entered space's own
 *  id, else the thread's (remote-run.ts runThreadId — the same scope the run
 *  and the fs panels use). */
export function cloudScope(source: TerminalSourceLike | null | undefined, chatId: string | null | undefined): string {
  if (source?.kind === "cloud-space" && source.space) return String(source.space);
  return String(chatId || "");
}

export function terminalTransport(input: TerminalTransportInput): TerminalTransport {
  const { surface, source, chatId, slotTarget } = input;
  const worker = (): TerminalTransport => {
    const dir = (source?.dir || "").replace(/^\/+|\/+$/g, "");
    return { kind: "remote", target: "worker", scope: cloudScope(source, chatId), ...(dir ? { cwd: dir } : {}) };
  };
  // A pinned far side wins over the session's locus.
  if (slotTarget === "worker") return worker();
  if (slotTarget === "desktop") return surface === "desktop" ? { kind: "local" } : { kind: "remote", target: "desktop" };
  if (isCloudSource(source)) return worker();
  if (surface === "desktop") return { kind: "local" };
  // Web, a machine-bound session: the attached desktop. No session at all:
  // the web has no machine of its own — the worker is the only shell it has.
  return source?.kind === "local" ? { kind: "remote", target: "desktop" } : worker();
}

// ── The CLI agent line the POD's pty starts ─────────────────────────────────
// Main's composeCommand is the MACHINE's line (a `cd` into a local folder, the
// local MCP server, env files, the bundled CLI run by the app binary). None of
// that exists on the pod: the CLI there is the bare binary on PATH, riding the
// gateway the server already configured for the pty (harness_api.pty_body).
// Same table as the web's cli-agents-web.js. POSIX only — the worker is Linux.

const POD_CLI_BIN: Record<string, string> = {
  claude: "claude", codex: "codex", gemini: "gemini", copilot: "copilot", cursor: "cursor-agent", glyphh: "glyphh",
};

const sq = (s: string): string => `'${String(s).replace(/'/g, "'\\''")}'`;

function resumePart(cli: string, resume: boolean | string | undefined): string {
  if (!resume) return "";
  const rid = typeof resume === "string" ? resume.replace(/'/g, "") : "";
  switch (cli) {
    case "claude": return rid ? ` --resume ${sq(rid)}` : " --continue";
    case "codex": return rid ? ` resume ${sq(rid)}` : " resume --last";
    case "gemini": return rid ? ` --resume ${sq(rid)}` : " --resume latest";
    default: return rid ? ` --resume ${sq(rid)}` : " --continue";
  }
}

function promptPart(cli: string, prompt: string | undefined): string {
  const p = (prompt || "").trim();
  if (!p) return "";
  if (cli === "claude" || cli === "codex" || cli === "glyphh") return ` ${sq(p)}`;
  if (cli === "gemini") return ` -i ${sq(p)}`;
  return "";
}

/** The line a cloud session's CLI tile hands the worker pty (its first word
 *  is the program the pty starts; the rest is typed after `ready`). Null for
 *  a CLI the pod does not carry. */
export function podCliCommand(cli: string, ov: { resume?: boolean | string; prompt?: string } = {}): string | null {
  const bin = POD_CLI_BIN[cli];
  if (!bin) return null;
  if (cli === "codex") return `${bin} -c check_for_update_on_startup=false${resumePart(cli, ov.resume)}${promptPart(cli, ov.prompt)}`;
  if (cli === "glyphh") return `${bin} --trust${resumePart(cli, ov.resume)}${promptPart(cli, ov.prompt)}`;
  return `${bin}${resumePart(cli, ov.resume)}${promptPart(cli, ov.prompt)}`;
}
