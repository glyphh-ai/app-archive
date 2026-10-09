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

/** How long a build may take before it is stopped. */
export const POWER_BUILD_LIMIT_MS = 5 * 60 * 1000;

/** A tool, as the overlay says what Glyphh is doing with it. */
export function powerToolLine(name: string): string {
  const n = String(name ?? "").toLowerCase();
  if (n.includes("skill_save")) return "Saving the power";
  if (n.includes("skill") || n.includes("task")) return "Looking at your powers";
  if (n.includes("connector") || n.includes("connection")) return "Checking your connections";
  if (n.includes("find_tools") || n.includes("call_tool")) return "Finding the right tools";
  if (n.includes("read") || n.includes("list") || n.includes("search")) return "Reading";
  if (n.includes("write") || n.includes("edit")) return "Writing";
  return "Working";
}

/** The newest whole line of what Glyphh is writing, short enough for the overlay. */
export function lastLine(text: string, max = 70): string {
  const lines = String(text ?? "").split(/\n+/).map((l) => l.replace(/[#*`>_]/g, "").trim()).filter(Boolean);
  const l = lines[lines.length - 1] ?? "";
  return l.length > max ? `${l.slice(0, max - 1)}…` : l;
}
