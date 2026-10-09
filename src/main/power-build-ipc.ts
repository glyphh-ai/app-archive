/**
 * power-build-ipc.ts — "+ Add" on the powers modal's Your powers tab (his
 * order, 2026-10-09): the member describes a power, Glyphh builds it headless
 * with its own skill_save (instructions, or a program when it must run on its
 * own), and the modal reads back what was made and the connections it needs.
 * The rules are shared/power-build.ts.
 */
import { ipcMain } from "electron";
import { runGlyphhHeadless } from "./glyphh-loop.js";
import { listSkills } from "./skills-fs.js";
import { parseBuiltPower, powerBuildPrompt, POWER_ASK_MAX } from "../shared/power-build.js";

export interface PowerBuildAnswer {
  id: string; slug: string; type: "skill" | "task"; name: string; description: string; connections: string[];
}

export async function buildPower(ask: string): Promise<PowerBuildAnswer> {
  const text = String(ask ?? "").trim();
  if (!text) throw new Error("Say what the power should do.");
  if (text.length > POWER_ASK_MAX) throw new Error(`Keep it under ${POWER_ASK_MAX} characters.`);
  const kinds = ["skill", "task"] as const;
  const before = new Set(listSkills([...kinds]).map((s) => s.id));
  const r = await runGlyphhHeadless(powerBuildPrompt(text));
  if (!r.ok) throw new Error(r.error || "Glyphh couldn't build it.");
  const said = parseBuiltPower(r.text);
  const after = listSkills([...kinds]);
  const fresh = after.filter((s) => !before.has(s.id));
  const slugOf = (id: string): string => id.slice(id.indexOf(":") + 1);
  const made = (said && after.find((s) => slugOf(s.id) === said.slug && s.type === said.type))
    ?? (said && after.find((s) => slugOf(s.id) === said.slug))
    ?? fresh[0];
  if (!made) throw new Error("Glyphh answered but no new power was saved. Try describing it again.");
  return {
    id: made.id, slug: slugOf(made.id), type: made.type === "task" ? "task" : "skill",
    name: made.name, description: made.description, connections: said?.connections ?? [],
  };
}

export function registerPowerBuildIpc(): void {
  ipcMain.handle("power-build", async (_e, ask: string) => {
    try { return { ok: true as const, data: await buildPower(ask) }; }
    catch (err) { return { ok: false as const, error: err instanceof Error ? err.message : String(err) }; }
  });
}
