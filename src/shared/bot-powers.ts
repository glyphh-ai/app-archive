/**
 * bot-powers.ts — WHAT A BOT'S POWERS DO TO ITS TURN (his order, 2026-10-09:
 * "the list of powers this bot has: folder(s), connections, models -> + add a
 * new power"). Pure, so main (agent-ipc.ts runAgentTurn) and the tests read
 * the same rules:
 *
 *   folders      the first is where the bot works; a folder picked for the
 *                thread wins only when it is one of the bot's. The rest ride
 *                as folder attachments, readable beside the working folder.
 *   connections  named to the bot in its brief, so it reaches for them.
 *   models       the bot runs on `model`; the others are named as ones it may use.
 *   skills       named as the powers it may load.
 */

export interface BotPowersLike {
  model?: string;
  personality?: number;
  directness?: number;
  temperament?: number;
  effort?: string;
  folders?: string[];
  connections?: string[];
  models?: string[];
  superPowers?: string[];
  skills?: string[];
}

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];

/** `p` is `root` or inside it, by path segments (callers pass real paths). */
export function withinFolder(root: string, p: string): boolean {
  const r = root.replace(/\/+$/, "");
  return !!r && (p === r || p.startsWith(`${r}/`));
}

/** THE SESSION'S FOLDER IS THE PERIMETER (his rule, 2026-10-09): a bot's grant can
 *  only NARROW it. The bot works in its first folder inside the session's
 *  folder, else in the session's folder; with no session folder, nowhere. */
export function botWorkFolder(bot: BotPowersLike | null, picked: string): string {
  const p = String(picked ?? "").trim();
  if (!p) return "";
  return list(bot?.folders).find((f) => withinFolder(p, f)) ?? p;
}

/** The lines that tell the bot what it has. Empty when it has nothing to name. */
export function botPowersNote(bot: BotPowersLike | null, workdir: string): string {
  if (!bot) return "";
  const lines: string[] = [];
  if (list(bot.folders).length) lines.push(`- Folder: you work in ${workdir}, and nowhere else.`);
  const conns = list(bot.connections);
  if (conns.length) lines.push(`- Connections: ${conns.join(", ")}. Use these accounts for this work.`);
  const main = String(bot.model ?? "").trim();
  const models = list(bot.models).filter((m) => m !== main);
  if (models.length) lines.push(`- Models: ${main ? `you run on ${main}; ` : ""}you may also use ${models.join(", ")}.`);
  const skills = list(bot.skills);
  if (skills.length) lines.push(`- Powers you may load: ${skills.join(", ")}.`);
  // THE SUPER POWERS IT HOLDS (his order, 2026-10-09): the only ones it hands work to.
  const team = list(bot.superPowers);
  if (team.length) lines.push(`- Super powers you may hand work to with spawn_agent: ${team.join(", ")}. Hand work to no other.`);
  return lines.length ? ["Your powers:", ...lines].join("\n") : "";
}

/** THE PERSONALITY SLIDER (his order, 2026-10-09): 1 serious … 5 playful; 3
 *  (or none) adds nothing. The work stays exact at every setting. */
export const PERSONALITY_LINES: Readonly<Record<number, string>> = Object.freeze({
  1: "Personality: strictly professional. Be terse and formal; no jokes, no small talk.",
  2: "Personality: calm and to the point. Friendly, but keep it brief and plain.",
  4: "Personality: warm and lightly playful. A little humour is welcome; the work stays exact.",
  5: "Personality: playful and full of character. Have fun with how you say things; the work itself stays exact.",
});
export function botPersonalityNote(bot: BotPowersLike | null): string {
  const n = Math.round(Number(bot?.personality));
  return [PERSONALITY_LINES[n] ?? "", DIRECTNESS_LINES[Math.round(Number(bot?.directness))] ?? "", TEMPERAMENT_LINES[Math.round(Number(bot?.temperament))] ?? ""].filter(Boolean).join("\n");
}

/** DIRECTNESS (his order, 2026-10-09: "Gentle -> Blunt"): 3 (or none) adds nothing. */
export const DIRECTNESS_LINES: Readonly<Record<number, string>> = Object.freeze({
  1: "Directness: very gentle. Soften hard news, lead with what works, suggest rather than tell.",
  2: "Directness: tactful. Say what matters plainly but kindly.",
  4: "Directness: frank. Say what you think without padding.",
  5: "Directness: blunt. Get straight to it; no cushioning, no hedging.",
});
/** TEMPERAMENT (his order, 2026-10-09: "Kind -> Spicy"): 3 (or none) adds nothing. */
export const TEMPERAMENT_LINES: Readonly<Record<number, string>> = Object.freeze({
  1: "Temperament: kind and encouraging. Warm, patient, generous with praise that is earned.",
  2: "Temperament: friendly and easygoing.",
  4: "Temperament: a little sassy. A dry aside or a raised eyebrow is welcome; stay respectful.",
  5: "Temperament: spicy. Bold, cheeky opinions and playful jabs; never mean, never rude to the user.",
});

/** The effort a bot's turn runs at: its own slider when set, else what the turn asked. */
export function botEffort(bot: BotPowersLike | null, asked: string | undefined): string | undefined {
  const own = String(bot?.effort ?? "").trim();
  return own || asked;
}
