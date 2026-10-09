/**
 * bot-avatar — THE SUPER POWERS' FACES (his orders, 2026-10-08: "funny cat
 * characters… sick avatars for our bots"; 2026-10-09: "app icons that look
 * extremely similar in style to the glyphh mascot… just variants, colors,
 * etc. stay true to the styling").
 *
 * Every face IS the Glyphh mascot, traced to a vector (165×200): the sticker
 * border, the silhouette with its two ears, the ringed eye, the leg gap, the
 * tail. A variant changes one or two parts (an eye, the ears, the tail, a
 * hero's antenna, cape or bolt); a colour fills the body. A bot picks a
 * VARIANT and a COLOUR (its avatar, kept on its record); its MOOD changes the
 * eye, so the rail and the panel show a bot thinking, working, done or stuck.
 *
 * Pure — no DOM, so the thing is unit-tested (test/main/bot-avatar.test.ts).
 */

export interface BotAvatar { variant: number; color: string }

export type BotMood = "idle" | "thinking" | "generating" | "done" | "listening" | "error" | "curious" | "sleepy" | "playful" | "dizzy";

/** The house colours a bot can wear — the accent, then the mascots' cast,
 *  then Glyphh's own black. */
export const AVATAR_COLORS: ReadonlyArray<string> = Object.freeze([
  "#af5fff", "#2dd4bf", "#fbbf24", "#fb7185", "#60a5fa", "#4ade80", "#f97316", "#e879f9", "#0b0a0f",
]);

type Ear = "classic" | "tall" | "folded" | "round" | "spiky";
type Eye = "classic" | "look" | "up" | "big" | "sleepy" | "wink" | "star";
type Tail = "classic" | "bolt" | "curl" | "long";
type Extra = "none" | "antenna" | "cape" | "bolt";
interface MascotParts { ear: Ear; eye: Eye; tail: Tail; extra: Extra }
const BASE: MascotParts = { ear: "classic", eye: "classic", tail: "classic", extra: "none" };

/** THE SUPER POWERS' FACES (his order, 2026-10-09: "a series of app icons
 *  that look extremely similar in style to the glyphh mascot… just variants,
 *  colors, etc. stay true to the styling"). Every one is THE mascot — the
 *  sticker silhouette, the ringed eye, the leg gap, the tail — with one or
 *  two parts changed. */
export const AVATAR_VARIANTS: ReadonlyArray<{ id: number; name: string; o: Partial<MascotParts> }> = Object.freeze([
  { id: 1, name: "Glyphh", o: {} },
  { id: 2, name: "Side-eye", o: { eye: "look" } },
  { id: 3, name: "Big eye", o: { eye: "big" } },
  { id: 4, name: "Sleepy", o: { eye: "sleepy" } },
  { id: 5, name: "Wink", o: { eye: "wink" } },
  { id: 6, name: "Star eye", o: { eye: "star" } },
  { id: 7, name: "Tall ears", o: { ear: "tall" } },
  { id: 8, name: "Folded ear", o: { ear: "folded" } },
  { id: 9, name: "Spiky", o: { ear: "spiky" } },
  { id: 10, name: "Round ears", o: { ear: "round" } },
  { id: 11, name: "Bolt tail", o: { tail: "bolt" } },
  { id: 12, name: "Curl tail", o: { tail: "curl" } },
  { id: 13, name: "Long tail", o: { tail: "long" } },
  { id: 14, name: "Antenna", o: { extra: "antenna" } },
  { id: 15, name: "Cape", o: { extra: "cape" } },
  { id: 16, name: "Bolt mark", o: { extra: "bolt" } },
]);

/** What a mood changes: the eye. Idle keeps the variant's own. */
const MOOD_EYE: Record<BotMood, Eye | null> = {
  idle: null, thinking: "up", generating: "big", done: "wink", listening: "big",
  error: "sleepy", curious: "look", sleepy: "sleepy", playful: "wink", dizzy: "star",
};

/** A swarm status → the cat's mood. */
export function moodOf(status: "working" | "waiting" | "done" | "failed" | "idle" | undefined): BotMood {
  switch (status) {
    case "working": return "generating";
    case "waiting": return "curious";
    case "done": return "done";
    case "failed": return "error";
    default: return "idle";
  }
}

/** The face a bot wears until it picks one (his order, 2026-10-09: "Default
 *  to look"): Side-eye. */
export const DEFAULT_VARIANT = 2;
/** A stable pick for a bot with no avatar of its own: Side-eye, in a colour
 *  from the slug, so the same bot wears the same face everywhere. */
export function defaultAvatar(slug: string): BotAvatar {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return { variant: DEFAULT_VARIANT, color: AVATAR_COLORS[(h >>> 4) % AVATAR_COLORS.length]! };
}

/** The avatar a record carries, or the slug's default. */
export function avatarOf(bot: { slug: string; avatar?: BotAvatar | null }): BotAvatar {
  const a = bot.avatar;
  if (a && Number.isFinite(a.variant) && a.variant >= 1 && a.variant <= AVATAR_VARIANTS.length && /^#[0-9a-f]{3,8}$/i.test(a.color)) return { variant: Math.round(a.variant), color: a.color };
  return defaultAvatar(bot.slug);
}

/**
 * The mascot as an inline SVG string, 165×200 box: the sticker border in
 * white, the body in the bot's colour, the eye and leg gap in white. The root
 * carries `bot-cat` and the mood as classes (styles.css animates per mood).
 */
export function botAvatarSvg(avatar: BotAvatar, mood: BotMood = "idle", opts: { size?: number; title?: string } = {}): string {
  const def = AVATAR_VARIANTS.find((x) => x.id === avatar.variant) ?? AVATAR_VARIANTS[0]!;
  const v: MascotParts = { ...BASE, ...def.o };
  const eye: Eye = MOOD_EYE[mood] ?? v.eye;
  const fill = avatar.color;
  const white = "#fff";
  const ears: Record<Ear, { right: string; left: string }> = {
    classic: { right: "L131 20 L123 57", left: "M33 22 L62 42 L39 54 Z" },
    tall: { right: "L133 12 L123 57", left: "M28 10 L62 42 L39 54 Z" },
    folded: { right: "L112 30 L134 30 L123 57", left: "M33 22 L62 42 L39 54 Z" },
    round: { right: "C108 22 136 14 123 57", left: "M38 26 C30 36 34 50 39 54 L62 42 C56 32 48 24 38 26 Z" },
    spiky: { right: "L101 18 L110 38 L131 20 L123 57", left: "M33 22 L62 42 L39 54 Z" },
  };
  const tails: Record<Tail, string> = {
    classic: "L112 150 C126 152 136 151 145 149 C137 158 130 164 124 169",
    bolt: "L112 148 L136 140 L128 152 L152 146 L126 168",
    curl: "L112 150 C132 150 150 140 146 126 C143 138 132 158 124 169",
    long: "L112 150 C130 152 150 150 160 140 C150 160 134 166 124 169",
  };
  const e = ears[v.ear];
  const body = `M40 62 ${e.right} C140 70 144 104 128 121 L112 133 ${tails[v.tail]} L128 179 L35 180 L44 131 C18 118 20 80 40 62 Z`;
  const ring = "M45 104 C43 89 70 66 96 64 C116 62 124 80 121 97 C118 116 100 126 86 122 C70 118 47 112 45 104 Z";
  const ringEl = `<path d="${ring}" fill="none" stroke="${white}" stroke-width="6"/>`;
  const eyes: Record<Eye, string> = {
    classic: `${ringEl}<circle class="eye" cx="94" cy="94" r="9" fill="${white}"/>`,
    look: `${ringEl}<circle class="eye" cx="72" cy="96" r="9" fill="${white}"/>`,
    up: `${ringEl}<circle class="eye" cx="96" cy="80" r="9" fill="${white}"/>`,
    big: `${ringEl}<circle class="eye" cx="90" cy="94" r="15" fill="${white}"/><circle cx="95" cy="89" r="5" fill="${fill}"/>`,
    sleepy: `<path d="M45 104 C60 96 100 90 121 97 C118 116 100 126 86 122 C70 118 47 112 45 104 Z" fill="none" stroke="${white}" stroke-width="6"/><circle class="eye" cx="94" cy="106" r="7" fill="${white}"/>`,
    wink: `<path d="M50 102 C70 84 100 82 118 96" fill="none" stroke="${white}" stroke-width="7" stroke-linecap="round"/>`,
    star: `${ringEl}<path class="eye" d="M94 82 L97.5 90 L106 90.5 L99.5 96 L101.5 104.5 L94 100 L86.5 104.5 L88.5 96 L82 90.5 L90.5 90 Z" fill="${white}"/>`,
  };
  const antenna = v.extra === "antenna";
  const sticker = `<g fill="${white}" stroke="${white}" stroke-width="16" stroke-linejoin="round"><path d="${body}"/><path d="${e.left}"/>`
    + (antenna ? `<path d="M86 46 L92 18" stroke-width="20" stroke-linecap="round"/><circle cx="93" cy="14" r="9"/>` : "") + `</g>`;
  const cape = v.extra === "cape" ? `<path d="M46 128 C30 140 16 162 10 182 L44 181 Z" fill="${fill}" stroke="${white}" stroke-width="7" stroke-linejoin="round"/>` : "";
  const extra = antenna
    ? `<path d="M86 46 L92 18" stroke="${fill}" stroke-width="5" stroke-linecap="round"/><circle cx="93" cy="14" r="7" fill="${fill}"/>`
    : v.extra === "bolt" ? `<path d="M74 142 L88 142 L82 152 L94 152 L72 170 L78 157 L68 157 Z" fill="${fill}"/>` : "";
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : "";
  const title = opts.title ? `<title>${opts.title.replace(/[<>&]/g, "")}</title>` : "";
  return `<svg class="bot-cat ${mood}" viewBox="0 0 165 200" role="img"${size} data-variant="${def.id}">${title}`
    + `<g class="body">${cape}${sticker}`
    + `<path d="${body}" fill="${fill}" stroke="${fill}" stroke-width="1.5" stroke-linejoin="round"/>`
    + `<path class="ear ear-l" d="${e.left}" fill="${fill}" stroke="${fill}" stroke-width="1.5" stroke-linejoin="round"/>`
    + `<path d="M61 138 L99 150 L100 172 L51 171 Z" fill="${white}"/>${extra}${eyes[eye]}`
    + `</g></svg>`;
}
