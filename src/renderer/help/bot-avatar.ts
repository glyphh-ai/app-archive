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

/** `image`: a generated picture (a data URL) drawn in place of the face. */
export interface BotAvatar { variant: number; color: string; image?: string }
const AVATAR_IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export type BotMood = "idle" | "thinking" | "generating" | "done" | "listening" | "error" | "curious" | "sleepy" | "playful" | "dizzy";

/** THE INK: every face is Glyphh black for now (his order, 2026-10-09:
 *  "drop the color selections they are all just black for now"). A colour
 *  stored on a record is kept, never drawn — colour can come back without
 *  anyone losing their pick. */
export const AVATAR_INK = "#0b0a0f";
export const AVATAR_COLORS: ReadonlyArray<string> = Object.freeze([AVATAR_INK]);

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
  if (a && Number.isFinite(a.variant) && a.variant >= 1 && a.variant <= AVATAR_VARIANTS.length && /^#[0-9a-f]{3,8}$/i.test(a.color)) {
    const image = typeof a.image === "string" && AVATAR_IMAGE_RE.test(a.image) ? a.image : "";
    return image ? { variant: Math.round(a.variant), color: a.color, image } : { variant: Math.round(a.variant), color: a.color };
  }
  return defaultAvatar(bot.slug);
}

/**
 * The mascot as an inline SVG string, 165×200 box: the sticker border in
 * white, the body in the bot's colour, the eye and leg gap in white. The root
 * carries `bot-cat` and the mood as classes (styles.css animates per mood).
 */
export function botAvatarSvg(avatar: BotAvatar, mood: BotMood = "idle", opts: { size?: number; title?: string } = {}): string {
  // A generated picture stands in for the face, at the same size and classes.
  if (avatar.image && AVATAR_IMAGE_RE.test(avatar.image)) {
    const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : "";
    const alt = (opts.title ?? "").replace(/["<>&]/g, "");
    return `<img class="bot-cat bot-cat-img ${mood}" src="${avatar.image}" alt="${alt}"${size} draggable="false">`;
  }
  const def = AVATAR_VARIANTS.find((x) => x.id === avatar.variant) ?? AVATAR_VARIANTS[0]!;
  const v: MascotParts = { ...BASE, ...def.o };
  const eye: Eye = MOOD_EYE[mood] ?? v.eye;
  const fill = AVATAR_INK;   // black for now; avatar.color is kept, not drawn
  const white = "#fff";
  const ears: Record<Ear, { right: string; left: string }> = {
    classic: { right: "L135 13 L123 57", left: "M28 15 L62 42 L39 54 Z" },
    tall: { right: "L138 9 L123 57", left: "M22 9 L62 42 L39 54 Z" },
    folded: { right: "L110 26 L138 26 L123 57", left: "M28 15 L62 42 L39 54 Z" },
    round: { right: "C106 14 142 6 123 57", left: "M36 20 C26 32 32 50 39 54 L62 42 C56 30 48 18 36 20 Z" },
    spiky: { right: "L99 10 L111 34 L135 13 L123 57", left: "M28 15 L62 42 L39 54 Z" },
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
  // THE EYES MAKE THE CHARACTER (his note, 2026-10-09: "some of the eyes need
  // to be more accentuated"): a thicker ring, a bigger pupil with a dark glint.
  const ringEl = `<path d="${ring}" fill="none" stroke="${white}" stroke-width="8"/>`;
  const pupil = (cx: number, cy: number, r = 12): string =>
    // One group, so the rail's blink (.bot-cat.idle .eye) shuts pupil and glint together.
    `<g class="eye"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${white}"/><circle cx="${cx + r * 0.35}" cy="${cy - r * 0.35}" r="${Math.max(3, r * 0.3)}" fill="${fill}"/></g>`;
  const eyes: Record<Eye, string> = {
    classic: `${ringEl}${pupil(92, 94)}`,
    look: `${ringEl}${pupil(68, 97)}`,
    up: `${ringEl}${pupil(94, 80)}`,
    big: `${ringEl}${pupil(88, 94, 19)}`,
    sleepy: `<path d="M45 104 C60 96 100 90 121 97 C118 116 100 126 86 122 C70 118 47 112 45 104 Z" fill="none" stroke="${white}" stroke-width="8"/><circle class="eye" cx="92" cy="107" r="9" fill="${white}"/>`,
    // A REAL WINK (his note, 2026-10-09: "the wink one needs to actually wink"):
    // the eye shut in a happy curve, three lashes, and a little sparkle.
    wink: `${ringEl}<path d="M66 96 Q92 114 118 96" fill="none" stroke="${white}" stroke-width="9" stroke-linecap="round"/>`
      + `<path d="M75 106 L70 114 M92 110 L92 119 M109 106 L114 114" stroke="${white}" stroke-width="5" stroke-linecap="round"/>`
      + `<path d="M104 70 L106.5 76.5 L113 79 L106.5 81.5 L104 88 L101.5 81.5 L95 79 L101.5 76.5 Z" fill="${white}"/>`,
    star: `${ringEl}<path class="eye" d="M93 77 L97.8 87.6 L109 88.3 L100.4 95.6 L103 106.8 L93 100.8 L83 106.8 L85.6 95.6 L77 88.3 L88.2 87.6 Z" fill="${white}"/>`,
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
