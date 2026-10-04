/**
 * cli-agents-web.js — the CLI agent window on the WEB (his order, 2026-10-04).
 *
 * On the desktop `cli-agent-open` is main's: it starts the local MCP server,
 * writes the gateway env, pins themes and composes the command line
 * (src/main/cli-agents.ts composeCommand). On the web none of that machine
 * work exists — the CLI runs in the WORKER's terminal (POST /api/harness/pty
 * with `command`) and signs in on its own there. So the web computes the
 * command LOCALLY, from the same table as main's gateway-off case: the bare
 * CLI, its resume flag, its model flag, its prompt, and a `cd` when a folder
 * was asked for. No MCP wiring, no gateway, no env files (nothing here to
 * wire them into). POSIX only — the worker is Linux.
 */

/** The same ids, names and binaries as src/main/cli-agents.ts. */
export const WEB_CLI_AGENTS = [
  { id: 'claude',  name: 'Claude',     bin: 'claude' },
  { id: 'codex',   name: 'Codex',      bin: 'codex' },
  { id: 'gemini',  name: 'Gemini',     bin: 'gemini' },
  { id: 'copilot', name: 'Copilot',    bin: 'copilot' },
  { id: 'cursor',  name: 'Cursor',     bin: 'cursor-agent' },
  { id: 'glyphh',  name: 'Glyphh CLI', bin: 'glyphh' },
];

const byId = (id) => WEB_CLI_AGENTS.find((a) => a.id === String(id || '')) || null;

/** POSIX single-quote a value for the command line. */
const sq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

function resumePart(cli, resume) {
  if (!resume) return '';
  const rid = typeof resume === 'string' ? resume.replace(/'/g, '') : '';
  switch (cli) {
    case 'claude': return rid ? ` --resume ${sq(rid)}` : ' --continue';
    case 'codex':  return rid ? ` resume ${sq(rid)}` : ' resume --last';
    case 'gemini': return rid ? ` --resume ${sq(rid)}` : ' --resume latest';
    default:       return rid ? ` --resume ${sq(rid)}` : ' --continue';
  }
}

function modelPart(cli, model) {
  const m = String(model || '').trim().replace(/^[^:]+::/, '').replace(/"/g, '');
  if (!m) return '';
  switch (cli) {
    case 'gemini': return ` -m "${m}"`;
    case 'codex':  return ` -c model="${m}"`;
    default:       return ` --model "${m}"`;
  }
}

function promptPart(cli, prompt) {
  const p = String(prompt || '').trim();
  if (!p) return '';
  if (cli === 'claude' || cli === 'codex' || cli === 'glyphh') return ` ${sq(p)}`;
  if (cli === 'gemini') return ` -i ${sq(p)}`;
  return '';
}

/**
 * The command the worker's pty starts for a CLI agent.
 * @param {string} id  one of WEB_CLI_AGENTS ids
 * @param {{ cwd?: string, resume?: boolean|string, prompt?: string, model?: string }} [ov]
 * @returns {string|null} null for an unknown id
 */
export function composeWebCliCommand(id, ov = {}) {
  const a = byId(id);
  if (!a) return null;
  const cli = a.id;
  let base;
  if (cli === 'codex') base = `${a.bin} -c check_for_update_on_startup=false${modelPart(cli, ov.model)}${resumePart(cli, ov.resume)}${promptPart(cli, ov.prompt)}`;
  else if (cli === 'glyphh') base = `${a.bin} --trust${resumePart(cli, ov.resume)}${modelPart(cli, ov.model)}${promptPart(cli, ov.prompt)}`;
  else base = `${a.bin}${resumePart(cli, ov.resume)}${modelPart(cli, ov.model)}${promptPart(cli, ov.prompt)}`;
  const cwd = String(ov.cwd || '').trim();
  return cwd ? `cd ${sq(cwd)} && ${base}` : base;
}

/** The rows the workbench's CLI tiles read (preload's cliAgentsList shape). */
export function listWebCliAgents() {
  return WEB_CLI_AGENTS.map((a) => ({
    id: a.id, name: a.name, cli: a.id, cmd: a.bin,
    mcp: false, session: 'keep',
    command: composeWebCliCommand(a.id),
    gatewayCapable: false,
  }));
}

/** The `cliAgentOpen` answer on web (preload's shape, minus what only a
 *  machine can know — a missing binary is the worker's to report). */
export function openWebCliAgent(id, ov = {}) {
  const a = byId(id);
  if (!a) return { ok: false, error: `unknown CLI agent: ${String(id)}` };
  const cwd = String(ov.cwd || '').trim();
  return { ok: true, command: composeWebCliCommand(a.id, ov), name: a.name, ...(cwd ? { cwd } : {}), gateway: false };
}
