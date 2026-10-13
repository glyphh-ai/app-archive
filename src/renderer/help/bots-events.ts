/**
 * bots-events — the one door between the rail and the Bots panel (his order,
 * 2026-10-08: "we add bot threads as a special type in the rail and when
 * clicked they open the Bots panel"). The rail opens the panel and says which
 * bot; a mounted panel selects it, and one mounting later reads the last ask.
 */

export const BOTS_SELECT_EVENT = "glyphh:bots-select";

let lastAsked: string | null = null;

/** Open the Bots panel on a bot. The view's id stays `agents` (saved
 *  workspaces name it); its title is Bots. */
export function openBotsPanel(slug: string): void {
  lastAsked = slug;
  const w = window as unknown as { __wbOpenTool?: (view: string) => void };
  w.__wbOpenTool?.("agents");
  window.dispatchEvent(new CustomEvent(BOTS_SELECT_EVENT, { detail: { bot: slug } }));
}

/** The bot the rail last asked for — a panel that mounts after the click starts on it. */
export function takeBotsSelection(): string | null {
  const s = lastAsked;
  lastAsked = null;
  return s;
}

/** The slug behind a bot's thread id, `bots/<slug>`. */
export function botOfThread(chatId: string): string | null {
  return chatId.startsWith("bots/") ? chatId.slice(5) : null;
}
