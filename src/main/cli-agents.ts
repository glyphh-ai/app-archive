/**
 * cli-agents.ts — THE CLI AGENTS, back as their own window (his order,
 * 2026-09-30: "Bring back the glyphh agent window before we moved to our
 * glyphh only loop… I only want it to be for cli. No switching back and forth
 * between glyphh view and cli view").
 *
 * A CLI agent is a vendor CLI (Claude Code, Codex, Gemini, Copilot, Cursor)
 * or the Glyphh CLI, played in a terminal card: the command to run, the
 * Glyphh MCP wiring that lets it drive the workspace, and — for a paying org,
 * when the member wants it — the gateway lane. It never runs in the Glyphh
 * agent panel; that is the Glyphh loop's alone.
 *
 *   ~/.glyphh/users/<id>/loops/<cli>/mcp.json — the --mcp-config file pointing
 *                                               the CLI at this machine's MCP
 *   ~/.glyphh/users/<id>/loops/<cli>/env      — the gateway lines (0600)
 *
 * Restored from the pre-cut build (dd724920) without the bridge, the headless
 * chat lane, the server roster or BYOK — all of which stay gone.
 */

import fs from "fs";
import { execFileSync, spawn } from "child_process";
import path from "path";
import { homedir } from "os";
import { ipcMain } from "electron";
import { userScopedPath } from "./app-paths.js";
import { startLocalMcpServer, localMcpStatus, localMcpGenToken, localMcpTokenValid } from "./local-mcp-server.js";
import { effectiveToolMode } from "./conn-tool-modes.js";
import { preferencesByPrefix, getPreference } from "./stores/preferences-db";
import { gatewayCreds, mcpCreds, writeGatewayEnv, clearGatewayEnv, type GatewayCreds } from "./gateway-token.js";
import { SERVER_URL } from "./glyphh-client.js";
import { CLI_INSTALL, missingCli } from "./cli-install.js";
import { getWorkingDirectory } from "./working-directory.js";
import { bareModel, orgHasPlan, orgRequiredModel, refreshOrgModels } from "./org-models.js";
import { hostDialect, andThen, cd as shCd, invoke, setVar, sourceEnvFile, type Dialect } from "./shell-dialect.js";
import { bundledGlyphhCli } from "./bundled-cli.js";

export const AGENTS_DIR = (): string => userScopedPath("loops");

export type CliId = "claude" | "codex" | "gemini" | "copilot" | "cursor" | "glyphh";

export interface CliAgentRow {
  id: CliId;
  name: string;
  cli: CliId;
  /** The command line the terminal plays on open (before MCP wiring). */
  cmd: string;
  /** Wire the Glyphh local MCP server into the CLI. */
  mcp: boolean;
  /** What an open does with the agent's session (a workspace slot overrides):
   *    keep — re-attach the parked terminal if one survives; else start.
   *    new  — always a fresh session; closing kills the terminal.
   *    last — re-attach if parked; else the CLI resumes its own last one. */
  session: "keep" | "new" | "last";
}

/** A listed agent plus the composed command, so renderers can open synchronously. */
export type CliAgentListed = CliAgentRow & { command: string; gatewayCapable: boolean };

/** THE GLYPHH CLI IS NAMED FOR WHAT IT IS (his order, 2026-09-30: "glyphh cli
 *  (we need to rename the icon on the echo panel to this)"). */
const AGENT_NAMES: Record<CliId, string> = {
  claude: "Claude", codex: "Codex", gemini: "Gemini", copilot: "Copilot", cursor: "Cursor", glyphh: "Glyphh CLI",
};
const CLI_BIN: Record<CliId, string> = {
  claude: "claude", codex: "codex", gemini: "gemini", copilot: "copilot", cursor: "cursor-agent", glyphh: "glyphh",
};
export const CLI_IDS = Object.keys(AGENT_NAMES) as CliId[];

const isCliId = (v: string): v is CliId => (CLI_IDS as string[]).includes(v);

export function agentRowFor(id: string): CliAgentRow | null {
  if (!isCliId(id)) return null;
  return { id, name: AGENT_NAMES[id], cli: id, cmd: CLI_BIN[id], mcp: true, session: "keep" };
}

const mcpFile = (id: string): string => path.join(AGENTS_DIR(), id, "mcp.json");
const envFile = (id: string): string => path.join(AGENTS_DIR(), id, "env");

/**
 * OUR TOOL SURFACE, NOT THE MACHINE'S (his report, 2026-09-17: asked to read
 * his mail, the CLI reached for its own Gmail server). `--mcp-config` ADDS to
 * the user's own Claude Code servers; with this flag the file we write is the
 * whole surface for what WE launch.
 */
const STRICT_MCP = " --strict-mcp-config";

/** (Re)write the agent's --mcp-config file against the CURRENT port. The
 *  bearer grants loopback access to this machine's own tool surface only. */
function ensureMcpConfig(id: string): void {
  const { port } = localMcpStatus();
  let token = mcpTokenOf(id);
  if (!token || !localMcpTokenValid(token)) token = localMcpGenToken(`agent:${id}`, 365).token;
  fs.mkdirSync(path.join(AGENTS_DIR(), id), { recursive: true });
  upsertMcpServer(mcpFile(id), "glyphh", {
    type: "http",
    url: `http://127.0.0.1:${port}/mcp`,
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Upsert ONE server entry into an mcpServers JSON file, every other key preserved. */
function upsertMcpServer(file: string, key: string, entry: Record<string, unknown>): void {
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>; } catch { /* first write */ }
  const servers = (cfg.mcpServers && typeof cfg.mcpServers === "object" ? cfg.mcpServers : {}) as Record<string, unknown>;
  servers[key] = entry;
  cfg.mcpServers = servers;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), "utf-8");
}

/** The REMOTE MCP server — the gateway's /mcp, where the org's connections
 *  live. The member's own key authenticates it, so every connection call is
 *  metered to them (Free included: its $1 a month pays for them). */
function ensureRemoteMcp(id: string, cli: CliId, creds: GatewayCreds | null): void {
  if (!creds) return;
  const entry = { type: "http", url: `${creds.baseUrl.replace(/\/$/, "")}/mcp`, headers: { Authorization: `Bearer ${creds.token}` } };
  upsertMcpServer(mcpFile(id), "glyphh_gateway", entry);
  if (cli === "gemini") upsertMcpServer(path.join(homedir(), ".gemini", "settings.json"), "glyphh_gateway", { httpUrl: entry.url, headers: entry.headers });
  if (cli === "copilot") upsertMcpServer(path.join(homedir(), ".copilot", "mcp-config.json"), "glyphh_gateway", entry);
  if (cli === "cursor") upsertMcpServer(path.join(homedir(), ".cursor", "mcp.json"), "glyphh_gateway", { url: entry.url, headers: entry.headers });
}

/** The agent's bearer, minted if it is missing or stale — every reader goes through here. */
function ensureMcpToken(id: string): string {
  const have = mcpTokenOf(id);
  if (have && localMcpTokenValid(have)) return have;
  ensureMcpConfig(id);
  return mcpTokenOf(id);
}

function mcpTokenOf(id: string): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(mcpFile(id), "utf-8")) as {
      mcpServers?: { glyphh?: { headers?: { Authorization?: string } } };
    };
    return /^Bearer (.+)$/.exec(cfg.mcpServers?.glyphh?.headers?.Authorization ?? "")?.[1] ?? "";
  } catch {
    return "";
  }
}

/** The settings-file MCP seams: Gemini, Copilot and Cursor read theirs from home. */
function ensureSettingsMcp(id: string, cli: CliId): void {
  const { port } = localMcpStatus();
  const token = mcpTokenOf(id);
  const auth = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
  const url = `http://127.0.0.1:${port}/mcp`;
  if (cli === "gemini") upsertMcpServer(path.join(homedir(), ".gemini", "settings.json"), "glyphh", { httpUrl: url, ...auth });
  if (cli === "copilot") upsertMcpServer(path.join(homedir(), ".copilot", "mcp-config.json"), "glyphh", { type: "http", url, ...auth });
  if (cli === "cursor") upsertMcpServer(path.join(homedir(), ".cursor", "mcp.json"), "glyphh", { url, ...auth });
}

/** Pin the CLI's OWN theme to the app's (his order, 2026-09-10). One key changes, the rest survives. */
function ensureClaudeTheme(light: boolean): void {
  const file = path.join(homedir(), ".claude.json");
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>; } catch { /* first write */ }
  cfg.theme = light ? "light" : "dark";
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), "utf-8");
}

function ensureGeminiTheme(light: boolean): void {
  const file = path.join(homedir(), ".gemini", "settings.json");
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>; } catch { /* first write */ }
  cfg.theme = light ? "Default Light" : "Default";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), "utf-8");
}

/** The base-URL variables each CLI honors — the gateway lane's seam. Copilot
 *  and Cursor have none, so they always ride their own login; the Glyphh CLI
 *  signs in to our server itself. */
export const BASE_URL_ENV: Record<CliId, string[]> = {
  claude: ["ANTHROPIC_BASE_URL"], codex: ["OPENAI_BASE_URL"], gemini: ["GOOGLE_GEMINI_BASE_URL"],
  copilot: [], cursor: [], glyphh: [],
};

function modelFlag(cli: CliId, model: string): string {
  if (!model) return "";
  const m = bareModel(model).replace(/"/g, "");
  switch (cli) {
    case "claude": case "copilot": case "cursor": case "glyphh": return ` --model "${m}"`;
    case "gemini": return ` -m "${m}"`;
    // Codex takes it as a -c override before any subcommand (codexModelOverride).
    case "codex": return "";
  }
}

/** CODEX TAKES THE MODEL AS A CONFIG OVERRIDE (his report, 2026-09-23): `-m`
 *  belongs to `codex exec` alone and a resumed rollout keeps its own model. */
const codexModelOverride = (model: string): string => {
  const m = bareModel(model).replace(/"/g, "");
  return m ? ` -c 'model="${m}"'` : "";
};

/** Settings → Connections' tool modes projected onto Claude Code's own flags.
 *  "Never" is also enforced at the gateway; the other CLIs prompt for the rest. */
function claudeToolFlags(): string {
  const modes = preferencesByPrefix<Record<string, string>>("connToolModes:");
  const allow: string[] = [];
  const deny: string[] = [];
  for (const [key, byTool] of Object.entries(modes)) {
    if (key.startsWith("app:") || !byTool || typeof byTool !== "object") continue;
    for (const tool of Object.keys(byTool)) {
      const id = `mcp__glyphh_gateway__${tool.replace(/["'\s]/g, "")}`;
      const mode = effectiveToolMode(key, tool, modes);
      if (mode === "allow") allow.push(id);
      else if (mode === "never") deny.push(id);
    }
  }
  const list = (flag: string, ids: string[]): string => (ids.length ? ` ${flag} ${ids.map((x) => `"${x}"`).join(" ")}` : "");
  return list("--allowedTools", allow) + list("--disallowedTools", deny);
}

/** Codex 0.155 asks "Update available?" on first run; the check is its own config switch. */
const CODEX_NO_UPDATE = " -c check_for_update_on_startup=false";
/** CODEX IGNORES OPENAI_BASE_URL ON A CHATGPT LOGIN (proved 2026-09-20): the one
 *  proxy route it honors is a custom provider whose key comes from an env var.
 *  The single quotes are load-bearing — the values must reach codex as TOML strings. */
const CODEX_PROVIDER = ` -c 'model_provider="glyphh"' -c 'model_providers.glyphh.name="Glyphh"' -c 'model_providers.glyphh.base_url="'"$OPENAI_BASE_URL"'"' -c 'model_providers.glyphh.env_key="OPENAI_API_KEY"' -c 'model_providers.glyphh.wire_api="responses"'`;
/** codex's accepted values: auto | prompt | writes | approve. */
const CODEX_MCP_APPROVE = ` -c 'mcp_servers.glyphh.default_tools_approval_mode="approve"'`;

/** resume: true = the CLI's continue-last; a string = a SPECIFIC session id.
 *  gateway: the workspace slot's override of the member's default (his order,
 *  2026-09-30: "the user can then override gate way or not per slot"). */
export interface OpenOverrides { model?: string; cwd?: string; resume?: boolean | string; prompt?: string; light?: boolean; gateway?: boolean }

/** The member's default in Settings → CLI agents. Off until they turn it on. */
export const CLI_GATEWAY_PREF = "cliGateway";

/** DOES THIS OPEN RIDE THE GATEWAY? (his order, 2026-09-30: "if the user is
 *  paying for glyphh we allow them to pass the gateway to the agent but we need
 *  some way to allow them to set that they either want that or they don't").
 *  A paid plan, a CLI with a base-URL seam, then the slot's override, else the
 *  member's default. Free never does: its CLI runs on the CLI's own login. */
export function opensViaGateway(cli: CliId, override: boolean | undefined, hasPlan: boolean, defaultOn: boolean): boolean {
  if (!hasPlan || !BASE_URL_ENV[cli].length) return false;
  return override ?? defaultOn;
}

function expandHome(p: string): string {
  return p === "~" ? homedir() : p.startsWith("~/") ? path.join(homedir(), p.slice(2)) : p;
}

const isDirectory = (p: string): boolean => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** The folder the terminal starts in: the first EXISTING folder of the
 *  slot's / caller's, the workbench's, home. */
export function agentTerminalFolder(wanted: string | undefined): string {
  for (const raw of [wanted, getWorkingDirectory()]) {
    const dir = expandHome((raw ?? "").trim());
    if (dir && path.isAbsolute(dir) && isDirectory(dir)) return dir;
  }
  return homedir();
}

/** The Glyphh CLI keeps ITS OWN history when the app launches it, so its
 *  sessions list in the CLI window's recents and never in the Glyphh agent's. */
export const glyphhCliSessionsFile = (): string => userScopedPath("glyphh-cli-sessions.json");

export function composeCommand(row: CliAgentRow, ov: OpenOverrides, viaGateway: boolean, dialect?: Dialect): string {
  const d = dialect ?? hostDialect();
  const picked = (ov.model ?? "").trim();
  // A slot's model names a gateway model: it rides only the gateway lane, where
  // an unset one is the org's default. On the CLI's own login the CLI decides.
  const model = viaGateway ? (picked || orgRequiredModel()) : "";
  const cwd = expandHome((ov.cwd ?? "").trim());
  const rid = typeof ov.resume === "string" ? ov.resume.replace(/'/g, "") : "";
  const resumePart = ov.resume
    ? row.cli === "claude" ? (rid ? ` --resume '${rid}'` : " --continue")
      : row.cli === "codex" ? (rid ? ` resume '${rid}'` : " resume --last")
      : row.cli === "gemini" ? (rid ? ` --resume '${rid}'` : " --resume latest")
      : (rid ? ` --resume '${rid}'` : " --continue")
    : "";
  const p0 = (ov.prompt ?? "").trim().replace(/'/g, "'\\''");
  const promptPart = p0
    ? (row.cli === "claude" || row.cli === "codex" || row.cli === "glyphh") ? ` '${p0}'`
      : row.cli === "gemini" ? ` -i '${p0}'`
      : ""
    : "";
  if (row.cli === "glyphh") {
    const { port } = localMcpStatus();
    const mcpToken = row.mcp && port ? ensureMcpToken(row.id) : "";
    const envPairs: Array<[string, string]> = [["GLYPHH_SERVER_URL", SERVER_URL], ["GLYPHH_APP_SESSIONS", glyphhCliSessionsFile()]];
    if (mcpToken) envPairs.push(["GLYPHH_APP_MCP_URL", `http://127.0.0.1:${port}/mcp`], ["GLYPHH_APP_MCP_TOKEN", mcpToken]);
    // The CLI the app carries, run by the app's own binary as Node; the PATH
    // `glyphh` only when this build carries none (a dev checkout).
    const bundled = bundledGlyphhCli();
    if (bundled) envPairs.push(["ELECTRON_RUN_AS_NODE", "1"]);
    const env = envPairs.map(([k, v]) => setVar(k, v, d)).join("").trim();
    const bin = bundled ? invoke(process.execPath, [bundled], d) : row.cmd;
    const base = `${env} ${bin} --trust${resumePart}${modelFlag(row.cli, picked)}${promptPart}`;
    return cwd ? andThen([shCd(cwd, d), base], d) : base;
  }
  let base: string;
  if (row.cli === "codex") {
    const provider = viaGateway ? CODEX_PROVIDER : "";
    const { port } = localMcpStatus();
    const token = row.mcp ? ensureMcpToken(row.id) : "";
    const mcp = row.mcp
      ? ` -c experimental_use_rmcp_client=true -c 'mcp_servers.glyphh.url="http://127.0.0.1:${port}/mcp"'`
        + (token ? ` -c 'mcp_servers.glyphh.bearer_token_env_var="GLYPHH_MCP_TOKEN"'` : "") + CODEX_MCP_APPROVE
      : "";
    base = (token ? `${setVar("GLYPHH_MCP_TOKEN", token, d)} ` : "")
      + `${row.cmd}${CODEX_NO_UPDATE}${provider}${mcp}${codexModelOverride(model)}${resumePart}${promptPart}`;
  } else if (row.cli === "claude") {
    base = `${row.cmd}${resumePart}${modelFlag(row.cli, model)}${promptPart}${claudeToolFlags()}${row.mcp ? ` --mcp-config "${mcpFile(row.id)}"${STRICT_MCP}` : ""}`;
  } else {
    // gemini / copilot / cursor: their MCP seams are settings files written at open.
    base = `${row.cmd}${resumePart}${modelFlag(row.cli, model)}${promptPart}`;
  }
  const line = cwd ? andThen([shCd(cwd, d), base], d) : base;
  // The gateway lines source INVISIBLY — the terminal shows the file path,
  // never the key — and only on the gateway lane: off it, the CLI's own login.
  return viaGateway && fs.existsSync(envFile(row.id)) ? `${sourceEnvFile(envFile(row.id), d)} ${line}` : line;
}

/** Write (or strip) the gateway lines in the agent's env file for this open. */
async function ensureAgentEnv(row: CliAgentRow, viaGateway: boolean): Promise<boolean> {
  const vars = BASE_URL_ENV[row.cli];
  if (!vars.length) return false;
  const creds = viaGateway ? await gatewayCreds() : null;
  if (creds) { writeGatewayEnv(row.id, row.cli, vars, creds); return true; }
  clearGatewayEnv(row.id, row.cli, vars);
  return false;
}

export function listCliAgents(): CliAgentListed[] {
  const defaultOn = !!getPreference<boolean>(CLI_GATEWAY_PREF, false);
  return CLI_IDS.map((id) => agentRowFor(id)!).map((row) => {
    const via = opensViaGateway(row.cli, undefined, orgHasPlan(), defaultOn);
    return { ...row, command: composeCommand(row, {}, via), gatewayCapable: BASE_URL_ENV[row.cli].length > 0 };
  });
}

// ── Recent CLI sessions — each CLI's OWN store is the source ─────────────────

export type SessionCli = CliId;
export interface CliSessionRow { id: string; cli: SessionCli; title: string; cwd: string; mtime: number }

/** Lines a CLI prints on its own that can land in a transcript as if typed. */
export const NOISE_TITLE = /^(For more information and help, consult|Electron Security Warning|<local-command-caveat|<command-name|<command-message|<command-args|<local-command-stdout|<system-reminder|<user-prompt-submit-hook|Caveat: The messages below were generated)/i;

function readHead(file: string, bytes: number): string {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.toString("utf-8", 0, n);
  } catch { return ""; }
}

type SessionFile = { file: string; mtime: number; cli: SessionCli; cwd?: string };

function copilotSessionFiles(): SessionFile[] {
  const root = path.join(homedir(), ".copilot", "session-state");
  let ids: string[] = [];
  try { ids = fs.readdirSync(root); } catch { return []; }
  const files: SessionFile[] = [];
  for (const id of ids) {
    const file = path.join(root, id, "events.jsonl");
    let cwd = "";
    try { cwd = /^cwd:\s*(.+)$/m.exec(fs.readFileSync(path.join(root, id, "workspace.yaml"), "utf-8"))?.[1]?.trim() ?? ""; } catch { cwd = ""; }
    try { const st = fs.statSync(file); if (st.size > 0) files.push({ file, mtime: st.mtimeMs, cli: "copilot", cwd }); } catch { /* no events yet */ }
  }
  return files;
}

function readCopilotSessionHead(file: string, mtime: number, cwdIn: string): CliSessionRow | null {
  const head = readHead(file, 131_072);
  if (!head) return null;
  let id = "";
  let title = "";
  let cwd = cwdIn;
  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    let j: { type?: string; data?: { sessionId?: string; content?: string; context?: { cwd?: string } } };
    try { j = JSON.parse(line) as typeof j; } catch { continue; }
    if (j.type === "session.start") { id = j.data?.sessionId || id; cwd = cwd || j.data?.context?.cwd || ""; }
    if (j.type === "user.message" && !title && typeof j.data?.content === "string" && !NOISE_TITLE.test(j.data.content.trim())) title = j.data.content.trim();
    if (id && title) break;
  }
  if (!id) id = path.basename(path.dirname(file));
  if (!title) return null;
  return { id, cli: "copilot", title: title.replace(/\s+/g, " ").slice(0, 80), cwd, mtime };
}

/** Cursor CLI: ~/.cursor/chats/<workspace>/<chatId>/ holds meta.json and store.db. */
export function cursorSessionFiles(): SessionFile[] {
  const root = path.join(homedir(), ".cursor", "chats");
  let spaces: string[] = [];
  try { spaces = fs.readdirSync(root); } catch { return []; }
  const files: SessionFile[] = [];
  for (const ws of spaces) {
    let chats: string[] = [];
    try { chats = fs.readdirSync(path.join(root, ws)); } catch { continue; }
    for (const id of chats) {
      const dir = path.join(root, ws, id);
      let meta: { cwd?: string; updatedAtMs?: number; hasConversation?: boolean } = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf-8")) as typeof meta; } catch { continue; }
      if (meta.hasConversation === false) continue;
      files.push({ file: path.join(dir, "store.db"), mtime: Number(meta.updatedAtMs) || 0, cli: "cursor", cwd: meta.cwd || "" });
    }
  }
  return files;
}

/** One sqlite3 shell-out per chat per change (his report, 2026-09-17). */
const cursorTitles = new Map<string, { mtime: number; title: string }>();

function readCursorSessionHead(file: string, mtime: number, cwd: string): CliSessionRow | null {
  const id = path.basename(path.dirname(file));
  const seen = cursorTitles.get(file);
  let title = seen && seen.mtime === mtime ? seen.title : "";
  if (!seen || seen.mtime !== mtime) {
    title = "";
    if (fs.existsSync(file)) {
      try {
        const hex = execFileSync("sqlite3", ["-readonly", file, "select hex(value) from meta where key = '0' limit 1"], {
          encoding: "utf-8", timeout: 3_000, stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (hex) title = String((JSON.parse(Buffer.from(hex, "hex").toString("utf-8")) as { name?: string }).name || "");
      } catch { title = ""; }
    }
    cursorTitles.set(file, { mtime, title });
    if (cursorTitles.size > 500) for (const k of [...cursorTitles.keys()].slice(0, 100)) cursorTitles.delete(k);
  }
  if (!title) return null;
  return { id, cli: "cursor", title: title.replace(/\s+/g, " ").slice(0, 80), cwd, mtime };
}

/** Gemini CLI: a chat per session under ~/.gemini/tmp/<project>/chats/. */
export function geminiSessionFiles(): SessionFile[] {
  const root = path.join(homedir(), ".gemini", "tmp");
  let projects: string[] = [];
  try { projects = fs.readdirSync(root); } catch { return []; }
  const files: SessionFile[] = [];
  for (const proj of projects) {
    const dir = path.join(root, proj, "chats");
    let cwd = "";
    try { cwd = fs.readFileSync(path.join(root, proj, ".project_root"), "utf-8").trim(); } catch { cwd = ""; }
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith(".jsonl")) continue;
      try { const st = fs.statSync(path.join(dir, n)); if (st.size > 0) files.push({ file: path.join(dir, n), mtime: st.mtimeMs, cli: "gemini", cwd }); } catch { /* raced */ }
    }
  }
  return files;
}

function readGeminiSessionHead(file: string, mtime: number, cwd: string): CliSessionRow | null {
  const head = readHead(file, 131_072);
  if (!head) return null;
  let id = "";
  let title = "";
  type Msg = { type?: string; content?: Array<{ text?: string }> | string };
  const consider = (m: Msg): void => {
    if (title || m.type !== "user") return;
    const text = Array.isArray(m.content) ? m.content.map((c) => c.text || "").join("") : String(m.content || "");
    const t = text.trim();
    if (t && !t.startsWith("<session_context>") && !NOISE_TITLE.test(t)) title = t;
  };
  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    let j: { sessionId?: string; $set?: { messages?: Msg[] }; $push?: { messages?: Msg | Msg[] }; messages?: Msg[] };
    try { j = JSON.parse(line) as typeof j; } catch { continue; }
    if (typeof j.sessionId === "string") id = j.sessionId;
    for (const m of j.$set?.messages ?? j.messages ?? []) consider(m);
    const pushed = j.$push?.messages;
    if (pushed) for (const m of Array.isArray(pushed) ? pushed : [pushed]) consider(m);
    if (id && title) break;
  }
  if (!id || !title) return null;
  return { id, cli: "gemini", title: title.replace(/\s+/g, " ").slice(0, 80), cwd, mtime };
}

function claudeSessionFiles(): SessionFile[] {
  const root = path.join(homedir(), ".claude", "projects");
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(root); } catch { return []; }
  const files: SessionFile[] = [];
  for (const d of dirs) {
    const dir = path.join(root, d);
    let names: string[] = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch { continue; }
    for (const n of names) {
      try {
        const st = fs.statSync(path.join(dir, n));
        if (st.size > 0) files.push({ file: path.join(dir, n), mtime: st.mtimeMs, cli: "claude" });
      } catch { /* raced */ }
    }
  }
  return files;
}

function codexSessionFiles(): SessionFile[] {
  const root = path.join(homedir(), ".codex", "sessions");
  const files: SessionFile[] = [];
  const walk = (dir: string, depth: number): void => {
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = path.join(dir, n);
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) { if (depth < 3) walk(p, depth + 1); }
        else if (n.endsWith(".jsonl") && st.size > 0) files.push({ file: p, mtime: st.mtimeMs, cli: "codex" });
      } catch { /* raced */ }
    }
  };
  walk(root, 0);
  return files;
}

/** The Glyphh CLI's chats, from the file the app points it at. */
function glyphhCliSessions(): CliSessionRow[] {
  try {
    const j = JSON.parse(fs.readFileSync(glyphhCliSessionsFile(), "utf-8")) as { chats?: Array<{ id?: string; title?: string; workdir?: string; updatedAt?: number; createdAt?: number; messages?: unknown[] }> };
    return (j.chats ?? [])
      .filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages) && c.messages.length > 0)
      .map((c) => ({ id: c.id!, cli: "glyphh" as const, title: String(c.title || "New session").slice(0, 80), cwd: c.workdir || "", mtime: c.updatedAt || c.createdAt || 0 }));
  } catch { return []; }
}

function readCodexSessionHead(file: string, mtime: number): CliSessionRow | null {
  const head = readHead(file, 65_536);
  if (!head) return null;
  let id = "";
  let cwd = "";
  let title = "";
  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    let j: { type?: string; payload?: Record<string, unknown> };
    try { j = JSON.parse(line) as typeof j; } catch { continue; }
    const p = j.payload ?? {};
    if (j.type === "session_meta") {
      if (typeof p.id === "string") id = p.id;
      if (typeof p.cwd === "string") cwd = p.cwd;
    }
    if (!title && p.type === "message" && p.role === "user" && Array.isArray(p.content)) {
      const t = (p.content as Array<{ type?: string; text?: string }>).find((c) => c.type === "input_text" && c.text)?.text ?? "";
      // codex prepends AGENTS.md + environment context as user messages.
      if (t && !/^(#|<INSTRUCTIONS|<environment_context|<ENVIRONMENT)/.test(t.trim()) && !NOISE_TITLE.test(t.trim())) title = t;
    }
    if (id && cwd && title) break;
  }
  if (!title) return null;
  if (!id) id = /rollout-[\dT-]+-([0-9a-f-]{36})\.jsonl$/.exec(path.basename(file))?.[1] ?? "";
  if (!id) return null;
  return { id, cli: "codex", title: title.replace(/\s+/g, " ").trim().slice(0, 80), cwd, mtime };
}

/** Claude APPENDS its `type:"summary"` line — the name its own --resume picker shows. */
function claudeTailSummary(file: string): string {
  try {
    const st = fs.statSync(file);
    const want = Math.min(st.size, 65_536);
    if (!want) return "";
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(want);
    const n = fs.readSync(fd, buf, 0, want, st.size - want);
    fs.closeSync(fd);
    const lines = buf.toString("utf-8", 0, n).split("\n").slice(st.size > want ? 1 : 0);
    let found = "";
    for (const line of lines) {
      if (!line.trim() || !line.includes('"summary"')) continue;
      try {
        const j = JSON.parse(line) as Record<string, unknown>;
        if (j.type === "summary" && typeof j.summary === "string" && j.summary.trim()) found = j.summary;
      } catch { /* partial */ }
    }
    return found;
  } catch { return ""; }
}

export function readClaudeSessionHead(file: string, mtime: number): CliSessionRow | null {
  const head = readHead(file, 32_768);
  if (!head) return null;
  let cwd = "";
  let title = claudeTailSummary(file);
  for (const line of head.split("\n")) {
    if (!line.trim()) continue;
    let j: Record<string, unknown>;
    try { j = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (!cwd && typeof j.cwd === "string") cwd = j.cwd;
    if (!title && j.type === "summary" && typeof j.summary === "string") title = j.summary;
    if (!title && j.type === "user") {
      const msg = (j.message as { content?: unknown } | undefined)?.content;
      let cand = "";
      if (typeof msg === "string") cand = msg;
      else if (Array.isArray(msg)) {
        const t = msg.find((c) => (c as { type?: string }).type === "text") as { text?: string } | undefined;
        if (t?.text) cand = t.text;
      }
      if (cand.trim() && !NOISE_TITLE.test(cand.trim())) title = cand;
    }
    if (cwd && title) break;
  }
  if (!title) return null;
  return { id: path.basename(file, ".jsonl"), cli: "claude", title: title.replace(/\s+/g, " ").trim().slice(0, 80), cwd, mtime };
}

export function listCliSessions(limit = 40): CliSessionRow[] {
  const files: SessionFile[] = [...claudeSessionFiles(), ...codexSessionFiles(), ...geminiSessionFiles(), ...copilotSessionFiles(), ...cursorSessionFiles()];
  files.sort((a, b) => b.mtime - a.mtime);
  const readers: Record<Exclude<SessionCli, "glyphh">, (f: SessionFile) => CliSessionRow | null> = {
    claude: (f) => readClaudeSessionHead(f.file, f.mtime),
    codex: (f) => readCodexSessionHead(f.file, f.mtime),
    gemini: (f) => readGeminiSessionHead(f.file, f.mtime, f.cwd || ""),
    copilot: (f) => readCopilotSessionHead(f.file, f.mtime, f.cwd || ""),
    cursor: (f) => readCursorSessionHead(f.file, f.mtime, f.cwd || ""),
  };
  const out: CliSessionRow[] = [];
  for (const f of files.slice(0, limit * 3)) {
    const row = readers[f.cli as Exclude<SessionCli, "glyphh">](f);
    if (row) out.push(row);
    if (out.length >= limit) break;
  }
  return [...out, ...glyphhCliSessions()].sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

function deleteCliSession(id: string): void {
  const base = `${id}.jsonl`;
  if (!/^[\w-]+\.jsonl$/.test(base)) throw new Error("bad session id");
  const root = path.join(homedir(), ".claude", "projects");
  let dirs: string[] = [];
  try { dirs = fs.readdirSync(root); } catch { dirs = []; }
  for (const d of dirs) {
    const f = path.join(root, d, base);
    if (fs.existsSync(f)) { fs.rmSync(f); return; }
  }
  const hit = codexSessionFiles().find((f) => f.file.endsWith(`-${id}.jsonl`));
  if (hit) { fs.rmSync(hit.file); return; }
  const g = geminiSessionFiles().find((f) => readHead(f.file, 400).includes(`"sessionId":"${id}"`));
  if (g) { fs.rmSync(g.file); return; }
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const cp = path.join(homedir(), ".copilot", "session-state", id);
    if (fs.existsSync(cp)) { fs.rmSync(cp, { recursive: true, force: true }); return; }
    const cu = cursorSessionFiles().find((f) => path.basename(path.dirname(f.file)) === id);
    if (cu) { fs.rmSync(path.dirname(cu.file), { recursive: true, force: true }); return; }
  }
  try {
    const file = glyphhCliSessionsFile();
    const j = JSON.parse(fs.readFileSync(file, "utf-8")) as { chats?: Array<{ id?: string }>; currentId?: string | null };
    const chats = (j.chats ?? []).filter((c) => c.id !== id);
    if (chats.length !== (j.chats ?? []).length) {
      fs.writeFileSync(file, JSON.stringify({ chats, currentId: j.currentId === id ? null : j.currentId ?? null }), "utf-8");
      return;
    }
  } catch { /* no Glyphh CLI store */ }
  throw new Error("session not found");
}

export function registerCliAgentsIpc(): void {
  ipcMain.handle("cli-agents-list", async () => {
    await refreshOrgModels().catch(() => undefined);
    try { return { ok: true, agents: listCliAgents(), hasPlan: orgHasPlan(), gatewayDefault: !!getPreference<boolean>(CLI_GATEWAY_PREF, false) }; }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err), agents: [] }; }
  });
  ipcMain.handle("cli-sessions-list", () => {
    try { return { ok: true, sessions: listCliSessions() }; }
    catch (err) { return { ok: false, sessions: [], error: err instanceof Error ? err.message : String(err) }; }
  });
  ipcMain.handle("cli-session-delete", (_e, id: string) => {
    try { deleteCliSession(String(id)); return { ok: true }; }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
  });
  // SIGNING A CLI BACK IN (his report, 2026-09-17): we cannot refresh someone
  // else's session, so we open a terminal on the command that can.
  ipcMain.handle("cli-login", (_e, cli: string) => {
    const command = CLI_INSTALL[String(cli)]?.login ?? String(cli || "claude");
    try {
      if (process.platform === "darwin") {
        const script = ['tell application "Terminal"', "activate", `do script "${command.replace(/["\\]/g, "\\$&")}"`, "end tell"].flatMap((l) => ["-e", l]);
        execFileSync("osascript", script);
        return { ok: true, data: { command } };
      }
      spawn(process.env.SHELL || "/bin/bash", ["-lc", command], { detached: true, stdio: "ignore" }).unref();
      return { ok: true, data: { command } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  // "Open" = the dependencies live (MCP server, env file), then the composed
  // command for the terminal the renderer opens.
  ipcMain.handle("cli-agent-open", async (_e, id: string, overrides?: OpenOverrides) => {
    try {
      const row = agentRowFor(String(id));
      if (!row) return { ok: false, error: `unknown CLI agent: ${String(id)}` };
      await refreshOrgModels().catch(() => undefined);
      const ov: OpenOverrides = overrides ?? {};
      const missing = row.cli === "glyphh" && bundledGlyphhCli() ? null : await missingCli(row);
      if (ov.light !== undefined) {
        try {
          if (row.cli === "claude") ensureClaudeTheme(ov.light);
          if (row.cli === "gemini") ensureGeminiTheme(ov.light);
        } catch (err) {
          console.warn("[agents] theme pin failed:", err instanceof Error ? err.message : err);
        }
      }
      const wantGateway = opensViaGateway(row.cli, ov.gateway, orgHasPlan(), !!getPreference<boolean>(CLI_GATEWAY_PREF, false));
      const viaGateway = await ensureAgentEnv(row, wantGateway);
      if (row.mcp) {
        const r = await startLocalMcpServer();
        if (!r.ok) return { ok: false, error: r.error ?? "local MCP server failed to start" };
        ensureMcpConfig(row.id);
        ensureRemoteMcp(row.id, row.cli, await mcpCreds());
        ensureSettingsMcp(row.id, row.cli);
      }
      const cwd = agentTerminalFolder(ov.cwd);
      const command = composeCommand(row, { ...ov, cwd }, viaGateway);
      console.warn("[agents] open", JSON.stringify({ id: row.id, cwd, gateway: viaGateway, resume: ov.resume ?? null, missing: missing?.bin ?? null, command: command.replace(/(GLYPHH_(APP_)?MCP_TOKEN=)"?[^"\s]*"?/g, "$1…") }));
      return { ok: true, command, name: row.name, cwd, gateway: viaGateway, ...(missing ? { missing } : {}) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

