/**
 * avatar-guard.ts — THE HARD GUARD ON GENERATED AVATARS (his order,
 * 2026-10-09: "We should guard against anything inappropriate etc. very hard
 * guards here"). Three gates, every one failing closed:
 *
 *   1. this word screen on what the member typed (pure, here);
 *   2. a model reads the prompt and must answer exactly SAFE (main/avatar-guard.ts);
 *   3. a vision model looks at the picture and must answer exactly SAFE.
 *
 * And the style prompt itself pins the subject: a black alien-cat sticker,
 * no text, nothing else in the picture (shared/avatar-style.ts).
 */

/** The longest ask a member may type. */
export const AVATAR_ASK_MAX = 300;

/** Words refused outright, by kind. Lower case, whole words (a plural s is
 *  fine); a trailing * makes a stem that matches any ending. */
const BLOCKED: ReadonlyArray<{ why: string; words: ReadonlyArray<string> }> = Object.freeze([
  { why: "sexual content", words: ["nude*", "naked", "nsfw", "sex", "sexy", "sexual*", "porn*", "erotic*", "lingerie", "bikini", "boob*", "breast*", "nipple*", "genital*", "penis", "vagina", "butt", "fetish*", "bdsm", "kink*", "seductive", "topless", "hentai", "onlyfans", "horny", "orgasm*", "lewd"] },
  { why: "violence or gore", words: ["blood", "bloody", "gore", "gory", "murder*", "corpse*", "decapitat*", "behead*", "dismember*", "tortur*", "mutilat*", "stabbing", "massacre*", "suicid*", "self-harm", "selfharm", "killing", "killed", "slaughter*"] },
  { why: "weapons", words: ["gun", "guns", "rifle", "pistol", "shotgun", "firearm*", "ak47", "ak-47", "ar15", "ar-15", "bomb", "grenade", "machete", "weapon*", "ammo", "ammunition", "sniper"] },
  { why: "drugs", words: ["cocaine", "heroin", "meth", "weed", "marijuana", "cannabis", "bong", "lsd", "ecstasy", "mdma", "opioid*", "fentanyl"] },
  { why: "hate or extremism", words: ["nazi*", "swastika*", "hitler", "kkk", "isis", "terroris*", "jihad*", "white power", "supremac*", "slur*", "racis*", "genocid*"] },
  { why: "real people or brands", words: ["trump", "biden", "obama", "putin", "elon", "celebrity", "celebrities", "politician*", "mickey", "disney", "pokemon", "pikachu", "marvel", "nintendo", "brand logo*"] },
  { why: "text in the picture", words: ["text saying", "words saying", "caption*", "slogan*", "letters spelling"] },
]);

const escapeRe = (w: string): string => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** One pattern per kind, built once. */
const BLOCKED_RE = BLOCKED.map((k) => ({
  why: k.why,
  re: new RegExp(`(^|[^a-z])(${k.words.map((w) => (w.endsWith("*") ? `${escapeRe(w.slice(0, -1))}[a-z]*` : `${escapeRe(w)}s?`)).join("|")})(?![a-z])`, "i"),
}));

/** Folds tricks a screen would miss: case, accents, leetspeak, separators inside words. */
export function foldForScreen(text: string): string {
  return String(text ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[0]/g, "o").replace(/[1!|]/g, "i").replace(/[3]/g, "e").replace(/[4@]/g, "a").replace(/[5$]/g, "s").replace(/[7]/g, "t")
    .replace(/([a-z])[.\-_*]+(?=[a-z])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Why what the member TYPED is refused, or null when it may go on to the
 *  model check (a super power's name and description go to the model check
 *  only: "technical execution" is a job, not violence). */
export function avatarAskProblem(ask: string): string | null {
  const raw = String(ask ?? "");
  if (raw.length > AVATAR_ASK_MAX) return `Keep it under ${AVATAR_ASK_MAX} characters.`;
  if (/https?:\/\/|www\./i.test(raw)) return "Describe it in words; links are not used.";
  const folded = foldForScreen(raw);
  for (const kind of BLOCKED_RE) {
    if (kind.re.test(folded)) return `That can't be part of an avatar (${kind.why}). Describe a friendly character instead.`;
  }
  return null;
}

/** The instruction both model checks read. The answer must be exactly SAFE to pass. */
export const GUARD_POLICY = [
  "You are a strict content gate for avatar icons in a workplace app used by all ages.",
  "Answer UNSAFE if there is ANY sign of: nudity, sexual or suggestive content, violence, blood, gore, injury, death, weapons, drugs, alcohol, tobacco, hate or extremist symbols, slurs, harassment, self-harm, horror, real or recognizable people, politicians, celebrities, trademarked characters or brand logos, readable text or letters, or anything a careful school would not show.",
  "When unsure, answer UNSAFE.",
  "Answer with exactly one word: SAFE or UNSAFE.",
].join("\n");

/** A check's answer passes only when it is exactly SAFE (any other text fails). */
export function guardPassed(answer: string): boolean {
  return String(answer ?? "").trim().replace(/[.!]$/, "").toUpperCase() === "SAFE";
}
