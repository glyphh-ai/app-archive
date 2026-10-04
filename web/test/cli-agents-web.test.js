/**
 * cli-agents-web.test.js — the CLI agent window's command on the web
 * (web/src/cli-agents-web.js): the same table as main's gateway-off case,
 * computed locally for the worker's pty.
 */
import { describe, it, expect } from 'vitest';
import { composeWebCliCommand, listWebCliAgents, openWebCliAgent, WEB_CLI_AGENTS } from '../src/cli-agents-web.js';

describe('composeWebCliCommand', () => {
  it('the bare CLI for a plain open', () => {
    expect(composeWebCliCommand('claude')).toBe('claude');
    expect(composeWebCliCommand('codex')).toBe('codex -c check_for_update_on_startup=false');
    expect(composeWebCliCommand('gemini')).toBe('gemini');
    expect(composeWebCliCommand('copilot')).toBe('copilot');
    expect(composeWebCliCommand('cursor')).toBe('cursor-agent');
    expect(composeWebCliCommand('glyphh')).toBe('glyphh --trust');
    expect(composeWebCliCommand('nope')).toBeNull();
  });
  it('resume: continue-last vs a specific session, per CLI', () => {
    expect(composeWebCliCommand('claude', { resume: true })).toBe('claude --continue');
    expect(composeWebCliCommand('claude', { resume: 'abc' })).toBe("claude --resume 'abc'");
    expect(composeWebCliCommand('codex', { resume: true })).toBe('codex -c check_for_update_on_startup=false resume --last');
    expect(composeWebCliCommand('codex', { resume: 's1' })).toBe("codex -c check_for_update_on_startup=false resume 's1'");
    expect(composeWebCliCommand('gemini', { resume: true })).toBe('gemini --resume latest');
    expect(composeWebCliCommand('copilot', { resume: true })).toBe('copilot --continue');
  });
  it('model + prompt flags, prompt quoted safely', () => {
    expect(composeWebCliCommand('claude', { model: 'anthropic::claude-sonnet-4-5', prompt: "fix it's bug" }))
      .toBe(`claude --model "claude-sonnet-4-5" 'fix it'\\''s bug'`);
    expect(composeWebCliCommand('gemini', { model: 'g', prompt: 'hi' })).toBe(`gemini -m "g" -i 'hi'`);
    expect(composeWebCliCommand('cursor', { prompt: 'ignored' })).toBe('cursor-agent');
  });
  it('a folder becomes a cd inside the workspace', () => {
    expect(composeWebCliCommand('claude', { cwd: 'apps/web' })).toBe("cd 'apps/web' && claude");
    expect(composeWebCliCommand('glyphh', { cwd: ' ', prompt: 'go' })).toBe("glyphh --trust 'go'");
  });
});

describe('the contract shapes', () => {
  it('listWebCliAgents mirrors preload cliAgentsList rows, gateway-less', () => {
    const rows = listWebCliAgents();
    expect(rows.map((r) => r.id)).toEqual(WEB_CLI_AGENTS.map((a) => a.id));
    for (const r of rows) {
      expect(r).toMatchObject({ cli: r.id, mcp: false, session: 'keep', gatewayCapable: false });
      expect(typeof r.command).toBe('string');
    }
  });
  it('openWebCliAgent answers like cli-agent-open, keeps the asked cwd', () => {
    expect(openWebCliAgent('claude', { cwd: 'src', prompt: 'x' })).toEqual({ ok: true, command: "cd 'src' && claude 'x'", name: 'Claude', cwd: 'src', gateway: false });
    expect(openWebCliAgent('codex')).toEqual({ ok: true, command: 'codex -c check_for_update_on_startup=false', name: 'Codex', gateway: false });
    expect(openWebCliAgent('zzz')).toEqual({ ok: false, error: 'unknown CLI agent: zzz' });
  });
});
