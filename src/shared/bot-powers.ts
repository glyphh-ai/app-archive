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
  folders?: string[];
  connections?: string[];
  models?: string[];
  skills?: string[];
}

const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];

/** The folder a bot's turn runs in: the picked one when it is the bot's, else the bot's first, else the picked one. */
export function botWorkFolder(bot: BotPowersLike | null, picked: string): string {
  const folders = list(bot?.folders);
  const p = String(picked ?? "").trim();
  if (!folders.length) return p;
  return folders.includes(p) ? p : folders[0]!;
}

/** The bot's other folders: everything but the one it works in. */
export function botExtraFolders(bot: BotPowersLike | null, workdir: string): string[] {
  return list(bot?.folders).filter((f) => f !== workdir);
}

/** The lines that tell the bot what it has. Empty when it has nothing to name. */
export function botPowersNote(bot: BotPowersLike | null, workdir: string): string {
  if (!bot) return "";
  const lines: string[] = [];
  const extra = botExtraFolders(bot, workdir);
  if (list(bot.folders).length) {
    lines.push(`- Folders: you work in ${workdir}.${extra.length ? ` You can also read ${extra.join(", ")}.` : ""}`);
  }
  const conns = list(bot.connections);
  if (conns.length) lines.push(`- Connections: ${conns.join(", ")}. Use these accounts for this work.`);
  const main = String(bot.model ?? "").trim();
  const models = list(bot.models).filter((m) => m !== main);
  if (models.length) lines.push(`- Models: ${main ? `you run on ${main}; ` : ""}you may also use ${models.join(", ")}.`);
  const skills = list(bot.skills);
  if (skills.length) lines.push(`- Powers you may load: ${skills.join(", ")}.`);
  return lines.length ? ["Your powers:", ...lines].join("\n") : "";
}
