/**
 * super-power-build-ipc.ts — the rail's "+" next to SUPER POWERS (his order,
 * 2026-10-09: "a new button next to super powers that opens a new super power
 * modal that has prompt etc."). The member describes it; Glyphh plans it,
 * reuses or forges its powers with skill_save and brings it to life with
 * agent_save, headless; then the app draws its face with the Images power.
 * The modal hears each beat (stage + line) and reads back what was made.
 * The rules are shared/super-power-build.ts.
 */
import { ipcMain } from "electron";
import { runGlyphhHeadless, stopGlyphhHeadless } from "./glyphh-loop.js";
import { listAgents, readAgentRow, saveAgent } from "./local-agents.js";
import { listSkills } from "./skills-fs.js";
import { generateAvatar, stopAvatar } from "./powers.js";
import { lastLine } from "../shared/power-build.js";
import {
  parseBuiltSuperPower, superPowerBuildPrompt, superPowerToolBeat,
  SUPER_POWER_ASK_MAX, SUPER_POWER_BUILD_LIMIT_MS, type SuperPowerBeat,
} from "../shared/super-power-build.js";

export interface SuperPowerBuildAnswer {
  agent: string; name: string; description: string;
  powers: Array<{ id: string; name: string }>;
  connections: string[];
  /** The face drawn for it, or null when the Images power couldn't (it keeps the default cat). */
  avatar: { variant: number; color: string; image?: string } | null;
  avatarError: string | null;
}

/** The build running now (one at a time), so Stop can end it. */
let building: { chatId: string; stopped: boolean } | null = null;
export function stopSuperPowerBuild(): boolean {
  if (!building) return false;
  building.stopped = true;
  stopAvatar();
  return stopGlyphhHeadless(building.chatId);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function buildSuperPower(ask: string, beat: (b: SuperPowerBeat) => void = () => {}): Promise<SuperPowerBuildAnswer> {
  const text = String(ask ?? "").trim();
  if (!text) throw new Error("Say what your super power should do.");
  if (text.length > SUPER_POWER_ASK_MAX) throw new Error(`Keep it under ${SUPER_POWER_ASK_MAX} characters.`);
  if (building) stopSuperPowerBuild();
  const started = Date.now();
  const before = new Set(listAgents().map((a) => a.slug));
  const me = { chatId: `super-power-build-${started.toString(36)}`, stopped: false };
  building = me;
  let heard = "";
  let lastSent = 0;
  let stage: SuperPowerBeat["stage"] = "plan";
  const tell = (b: SuperPowerBeat, force = false): void => {
    const now = Date.now();
    if (!b.line || (!force && b.stage === stage && now - lastSent < 300)) return;
    stage = b.stage;
    lastSent = now;
    beat(b);
  };
  tell({ stage: "plan", line: "Reading what you asked for" }, true);
  // MADE IS DONE: once agent_save has answered, the build wraps up a few
  // seconds later instead of waiting on whatever Glyphh tries next.
  let made = false;
  let wrapUp: ReturnType<typeof setTimeout> | null = null;
  const limit = setTimeout(() => { me.stopped = true; stopGlyphhHeadless(me.chatId); }, SUPER_POWER_BUILD_LIMIT_MS);
  let r: { ok: boolean; text: string; error?: string };
  try {
    r = await runGlyphhHeadless(superPowerBuildPrompt(text), {
      chatId: me.chatId,
      declineApprovals: true,
      onEvent: (ev) => {
        if (ev.type === "tool" && ev.phase === "start") tell(superPowerToolBeat(ev.name));
        else if (ev.type === "tool" && ev.phase === "done" && !ev.failed && !made && /agent_save/.test(`${ev.name} ${String(ev.input ?? "")}`)) {
          made = true;
          tell({ stage: "life", line: "It's alive. Finishing up" }, true);
          wrapUp = setTimeout(() => { stopGlyphhHeadless(me.chatId); }, 8000);
        }
        else if (ev.type === "thinking") tell({ stage, line: "Thinking it through" });
        else if (ev.type === "approval") tell({ stage, line: "Skipped a step that needs your approval" });
        else if (ev.type === "delta") { heard += ev.delta; tell({ stage, line: lastLine(heard) }); }
      },
    });
  } finally {
    clearTimeout(limit);
    if (wrapUp) clearTimeout(wrapUp);
  }
  try {
    const timedOut = me.stopped && Date.now() - started >= SUPER_POWER_BUILD_LIMIT_MS;
    if (timedOut) throw new Error("It was taking too long, so it was stopped after 8 minutes. Try describing it more simply.");
    if (me.stopped) throw new Error("Stopped.");
    if (!r.ok && !made) throw new Error(r.error || "Glyphh couldn't build it.");
    const said = parseBuiltSuperPower(r.text);
    // WHICH ONE IT MADE: Glyphh's own word first, then the one new since the
    // build began; the row can land a moment after the turn, so look again.
    const find = () => {
      const all = listAgents();
      return (said && all.find((a) => a.slug === said.agent)) ?? all.find((a) => !before.has(a.slug));
    };
    let row = find();
    for (let i = 0; !row && i < 10; i++) { await sleep(800); row = find(); }
    if (!row) {
      console.warn("[super-power-build] no super power found after the build", JSON.stringify({ said, tail: r.text.slice(-400) }));
      throw new Error("Glyphh answered but no super power was made. Try describing it again.");
    }
    // ITS FACE, drawn by the Images power in the mascot's style. A failure
    // keeps the default cat; the member can draw another on its page.
    tell({ stage: "face", line: "Drawing its face" }, true);
    let avatar: SuperPowerBuildAnswer["avatar"] = row.avatar ?? null;
    let avatarError: string | null = null;
    try {
      const face = await generateAvatar({ name: row.name, description: row.description });
      if (me.stopped) throw new Error("Stopped.");
      const base = row.avatar ?? { variant: 2, color: "#0b0a0f" };
      avatar = { variant: base.variant, color: base.color, image: face.image };
      saveAgent({ slug: row.slug, avatar });
    } catch (err) {
      avatarError = err instanceof Error ? err.message : String(err);
      if (avatarError === "Stopped.") throw err;
      console.warn("[super-power-build] avatar:", avatarError);
    }
    const fresh = readAgentRow(row.slug) ?? row;
    const skills = listSkills("skill");
    return {
      agent: fresh.slug, name: fresh.name, description: fresh.description,
      powers: (fresh.skills ?? []).map((id) => ({ id, name: skills.find((s) => s.id === id)?.name ?? id.slice(id.indexOf(":") + 1) })),
      connections: [...new Set([...(fresh.connections ?? []), ...(said?.connections ?? [])])],
      avatar, avatarError,
    };
  } finally {
    if (building === me) building = null;
  }
}

export function registerSuperPowerBuildIpc(): void {
  ipcMain.handle("super-power-build-stop", () => ({ ok: true as const, stopped: stopSuperPowerBuild() }));
  ipcMain.handle("super-power-build", async (e, ask: string) => {
    const beat = (b: SuperPowerBeat): void => { try { if (!e.sender.isDestroyed()) e.sender.send("super-power-build-progress", b); } catch { /* window gone */ } };
    try { return { ok: true as const, data: await buildSuperPower(ask, beat) }; }
    catch (err) { return { ok: false as const, error: err instanceof Error ? err.message : String(err) }; }
  });
}
