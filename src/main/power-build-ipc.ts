/**
 * power-build-ipc.ts — "+ Add" on the powers modal's Your powers tab (his
 * order, 2026-10-09): the member describes a power, Glyphh builds it headless
 * with its own skill_save (instructions, or a program when it must run on its
 * own), and the modal reads back what was made and the connections it needs.
 * The rules are shared/power-build.ts.
 */
import { ipcMain } from "electron";
import { runGlyphhHeadless, stopGlyphhHeadless } from "./glyphh-loop.js";
import { listSkills } from "./skills-fs.js";
import { lastLine, parseBuiltPower, powerBuildPrompt, powerToolLine, POWER_ASK_MAX, POWER_BUILD_LIMIT_MS } from "../shared/power-build.js";

export interface PowerBuildAnswer {
  id: string; slug: string; type: "skill" | "task"; name: string; description: string; connections: string[];
}

/** The build running now (one at a time), so Stop can end it. */
let building: { chatId: string; stopped: boolean } | null = null;
export function stopPowerBuild(): boolean {
  if (!building) return false;
  building.stopped = true;
  return stopGlyphhHeadless(building.chatId);
}

const slugOf = (id: string): string => id.slice(id.indexOf(":") + 1);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function buildPower(ask: string, progress: (line: string) => void = () => {}): Promise<PowerBuildAnswer> {
  const text = String(ask ?? "").trim();
  if (!text) throw new Error("Say what the power should do.");
  if (text.length > POWER_ASK_MAX) throw new Error(`Keep it under ${POWER_ASK_MAX} characters.`);
  if (building) stopPowerBuild();
  const kinds = ["skill", "task"] as const;
  const started = new Date(Date.now() - 2000).toISOString();
  const before = new Set(listSkills([...kinds]).map((s) => s.id));
  const me = { chatId: `power-build-${Date.now().toString(36)}`, stopped: false };
  building = me;
  let r: { ok: boolean; text: string; error?: string };
  // WHAT IT IS DOING (his report, 2026-10-09: "just spinning"): each tool it
  // reaches for and the line it is writing, at most a few times a second.
  let heard = "";
  let lastSent = 0;
  // SAVED IS DONE (his report, 2026-10-09: "it created the power but never
  // finished"): once skill_save has answered, the build wraps up a few
  // seconds later instead of waiting on whatever Glyphh tries next.
  let saved = false;
  let wrapUp: ReturnType<typeof setTimeout> | null = null;
  let declined = 0;
  const tell = (line: string): void => {
    const now = Date.now();
    if (!line || (now - lastSent < 300 && line !== "Saving the power")) return;
    lastSent = now;
    progress(line);
  };
  const limit = setTimeout(() => { me.stopped = true; stopGlyphhHeadless(me.chatId); }, POWER_BUILD_LIMIT_MS);
  let timedOut = false;
  try {
    r = await runGlyphhHeadless(powerBuildPrompt(text), {
      chatId: me.chatId,
      declineApprovals: true,
      onEvent: (ev) => {
        if (ev.type === "tool" && ev.phase === "start") tell(powerToolLine(ev.name));
        else if (ev.type === "tool" && ev.phase === "done" && !ev.failed && !saved && (/skill_save/.test(ev.name) || /skill_save/.test(String(ev.input ?? "")))) {
          saved = true;
          tell("Saved. Finishing up");
          wrapUp = setTimeout(() => { stopGlyphhHeadless(me.chatId); }, 8000);
        }
        else if (ev.type === "thinking") tell("Thinking it through");
        else if (ev.type === "approval") { declined++; tell("Skipped a step that needs your approval"); }
        else if (ev.type === "delta") { heard += ev.delta; tell(lastLine(heard)); }
      },
    });
  } finally {
    clearTimeout(limit);
    if (wrapUp) clearTimeout(wrapUp);
    timedOut = me.stopped && Date.now() - Date.parse(started) >= POWER_BUILD_LIMIT_MS;
    if (building === me) building = null;
  }
  if (timedOut) throw new Error("It was taking too long, so it was stopped after 5 minutes. Try describing it more simply.");
  if (me.stopped) throw new Error("Stopped.");
  if (declined) console.warn("[power-build] approvals declined during the build", declined);
  if (!r.ok) throw new Error(r.error || "Glyphh couldn't build it.");
  const said = parseBuiltPower(r.text);
  // WHAT IT SAVED (his report, 2026-10-09: it saved the power and the modal
  // said it hadn't). Glyphh's own word first, then any power new since the
  // build began or written during it; the folder can land a moment after
  // the turn ends, so the list is read again for a few seconds.
  const find = (): ReturnType<typeof listSkills>[number] | undefined => {
    const all = listSkills([...kinds]);
    const mine = all.filter((s) => s.source === "glyphh" || s.source === "task");
    return (said && mine.find((s) => slugOf(s.id) === said.slug))
      ?? (said && all.find((s) => slugOf(s.id) === said.slug))
      ?? mine.find((s) => !before.has(s.id))
      ?? mine.find((s) => s.updatedAt >= started);
  };
  let made = find();
  for (let i = 0; !made && i < 10; i++) { await sleep(800); made = find(); }
  if (!made) {
    console.warn("[power-build] no power found after the build", JSON.stringify({ said, tail: r.text.slice(-400) }));
    throw new Error("Glyphh answered but no new power was saved. Try describing it again.");
  }
  return {
    id: made.id, slug: slugOf(made.id), type: made.type === "task" ? "task" : "skill",
    name: made.name, description: made.description, connections: said?.connections ?? [],
  };
}

export function registerPowerBuildIpc(): void {
  ipcMain.handle("power-build-stop", () => ({ ok: true as const, stopped: stopPowerBuild() }));
  ipcMain.handle("power-build", async (e, ask: string) => {
    const progress = (line: string): void => { try { if (!e.sender.isDestroyed()) e.sender.send("power-build-progress", line); } catch { /* window gone */ } };
    try { return { ok: true as const, data: await buildPower(ask, progress) }; }
    catch (err) { return { ok: false as const, error: err instanceof Error ? err.message : String(err) }; }
  });
}
