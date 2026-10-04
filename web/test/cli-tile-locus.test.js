/**
 * cli-tile-locus.test.js — a CLI tile on the WEB opens a terminal running that
 * CLI, composed per the session's locus (his report, 2026-10-04: "the CLIs
 * don't work on app.glyphh.ai"):
 *
 *   CLOUD session → the worker pty: POST /api/harness/pty with `command` = the
 *     bare program (started directly) and `scope` = the thread; a line with
 *     arguments opens the shell and is typed whole after `ready`.
 *   LOCAL (desktop-relay) session → the desktop's shell over the relay
 *     (pty.open, no command on the wire); the composed line is typed after boot.
 *
 * The pieces are pure: cli-agents-web.js composes, pty-frames.ts splits and
 * bodies the open; remote-terminal.ts wires them (covered by
 * remote-terminal-desktop.test.js for the relay side).
 */
import { describe, it, expect } from 'vitest';
import { openWebCliAgent, listWebCliAgents } from '../src/cli-agents-web.js';
import { splitProgram, ptyOpenBody } from '../../src/renderer/pty-frames.ts';
import { createWbSelector, noteSessionsSnapshot, wbLocus } from '../src/wb-pod.js';

/** What spawnRemoteTerm (code-workbench.ts) hands openRemotePty for a tile. */
function plan(locus, command) {
  const target = locus.local ? 'desktop' : 'worker';
  const scope = locus.cloud ? (locus.scope || locus.chatId || '') : '';
  if (target === 'desktop') return { target, open: { cols: 80, rows: 24 }, typedAfterBoot: command };
  const { program, rest } = splitProgram(command);
  return { target, open: ptyOpenBody({ cols: 80, rows: 24, command: program, scope }), typedAfterReady: rest };
}

describe('the CLI tile, per locus', () => {
  it('the web table serves every tile without the desktop IPC', () => {
    const rows = listWebCliAgents();
    expect(rows.map((r) => r.id)).toEqual(['claude', 'codex', 'gemini', 'copilot', 'cursor', 'glyphh']);
    expect(openWebCliAgent('claude')).toEqual({ ok: true, command: 'claude', name: 'Claude', gateway: false });
    expect(openWebCliAgent('nope').ok).toBe(false);
  });

  it('CLOUD: a bare CLI is the worker pty\'s command, scoped to the thread', () => {
    const r = openWebCliAgent('claude');
    expect(plan({ cloud: true, chatId: 'thread-1' }, r.command)).toEqual({
      target: 'worker', open: { cols: 80, rows: 24, command: 'claude', scope: 'thread-1' }, typedAfterReady: '',
    });
    // A re-entered space scopes by the space id.
    expect(plan({ cloud: true, chatId: 'thread-1', scope: 'space-9' }, 'codex').open.scope).toBe('space-9');
  });

  it('CLOUD: a composed line (resume / prompt / folder) opens the shell and is typed whole', () => {
    const r = openWebCliAgent('claude', { resume: true, prompt: 'fix the build', cwd: '/w/app' });
    expect(r.command).toBe("cd '/w/app' && claude --continue 'fix the build'");
    const p = plan({ cloud: true, chatId: 't' }, r.command);
    expect(p.open).toEqual({ cols: 80, rows: 24, scope: 't' });   // no program on the wire
    expect(p.typedAfterReady).toBe(r.command);
    // Flags alone, too — never typed into a started program's prompt.
    expect(plan({ cloud: true, chatId: 't' }, 'codex -c check_for_update_on_startup=false').open.command).toBeUndefined();
  });

  it('LOCAL: the desktop relay opens a plain shell and the line is typed after boot', () => {
    const r = openWebCliAgent('codex', { model: 'o3' });
    const p = plan({ local: true, chatId: 't' }, r.command);
    expect(p).toEqual({ target: 'desktop', open: { cols: 80, rows: 24 }, typedAfterBoot: 'codex -c check_for_update_on_startup=false -c model="o3"' });
  });

  it('the locus follows the session store (wb-pod.js): cloud, local, or neither', () => {
    noteSessionsSnapshot([{ id: 'a', source: { kind: 'cloud-new' } }, { id: 'b', source: { kind: 'local', machineId: 'm1' } }], 'a');
    expect(wbLocus().cloud).toBe(true);
    noteSessionsSnapshot([{ id: 'a', source: { kind: 'cloud-new' } }, { id: 'b', source: { kind: 'local', machineId: 'm1' } }], 'b');
    expect(wbLocus().local).toBe(true);
    noteSessionsSnapshot([], '');
    expect(wbLocus()).toEqual({ chatId: '', cloud: false, local: false, scope: '' });
    // The locus routes the fs/git transports only; the Terminal tile decides
    // its far side from the session's source itself (help/terminal-target.ts,
    // one rule for the desktop and the web), so the selector exposes no locus().
    const sel = createWbSelector({ relay: {}, pod: {} });
    expect(sel.locus).toBeUndefined();
  });
});
