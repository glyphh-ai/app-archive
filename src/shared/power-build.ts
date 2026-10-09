/**
 * power-build.ts — A NEW POWER, BUILT BY GLYPHH (his order, 2026-10-09:
 * "should also support adding a power right there too with ai, nothing by
 * hand… Adding the power that requires connections like gmail and calendar
 * the user should be prompted to add those connections"). The rules main
 * (power-build-ipc.ts) runs a headless Glyphh turn with, and how it reads
 * what Glyphh says it built. Pure, for the tests.
 */

export const POWER_ASK_MAX = 2000;

/** What Glyphh is told: build exactly one power with skill_save, declare its connections, say what it made. */
export function powerBuildPrompt(ask: string): string {
  return [
    "The member is adding a new POWER from the powers modal. Build exactly one with skill_save, then stop.",
    "Choose its shape: type \"skill\" when it is instructions an agent follows; type \"task\" when it must run on its own (on a schedule, as a pipeline), and then write its program (run.js) and its slots too.",
    "Declare every connected account it uses in `connections`, by app slug (gmail, google_calendar, slack, …), including ones the member has not connected yet.",
    "Do not ask questions: make sensible choices and say them in the description. Do not run it.",
    "End your reply with ONE line of JSON and nothing after it: {\"slug\":\"…\",\"type\":\"skill\"|\"task\",\"name\":\"…\",\"connections\":[\"…\"]}",
    "",
    "What the member asked for:",
    String(ask ?? "").trim().slice(0, POWER_ASK_MAX),
  ].join("\n");
}

export interface BuiltPower { slug: string; type: "skill" | "task"; name: string; connections: string[] }

/** The last JSON object in Glyphh's reply that names what it built, or null. */
export function parseBuiltPower(text: string): BuiltPower | null {
  const s = String(text ?? "");
  const found = s.match(/\{[^{}]*"slug"[^{}]*\}/g);
  if (!found?.length) return null;
  for (let i = found.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(found[i]!) as Record<string, unknown>;
      const slug = String(o.slug ?? "").trim();
      if (!slug) continue;
      const type = o.type === "task" ? "task" : "skill";
      const connections = Array.isArray(o.connections)
        ? [...new Set(o.connections.map((c) => String(c ?? "").trim().toLowerCase()).filter((c) => /^[a-z0-9_.-]{1,80}$/.test(c)))]
        : [];
      return { slug, type, name: String(o.name ?? slug).trim() || slug, connections };
    } catch { /* not this one */ }
  }
  return null;
}
