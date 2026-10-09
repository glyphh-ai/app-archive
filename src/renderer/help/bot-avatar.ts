/**
 * bot-avatar — THE BOTS' CATS (his order, 2026-10-08: "ours are going to be
 * the funny cat characters we built, with the ability to create sick avatars
 * for our bots").
 *
 * One cat, drawn from parameters, in the theme's ink: two circles (the fat
 * one below, the small one on top), two ears, whiskers, a tail. The design
 * sheets at the repo root (mascot-cat-variations.html, the twelve bodies;
 * mascot-cat-examples.html, the ten moods) are the source; this is the same
 * drawing as a function. A bot picks a BODY and a COLOUR (its avatar, kept on
 * its record); its MOOD follows what it is doing, so the rail and the panel
 * show a bot thinking, generating, done, or stuck, the way the composer's
 * cat does for the main agent.
 *
 * Pure — no DOM, so the thing is unit-tested (test/main/bot-avatar.test.ts).
 */

export interface BotAvatar { variant: number; color: string }

export type BotMood = "idle" | "thinking" | "generating" | "done" | "listening" | "error" | "curious" | "sleepy" | "playful" | "dizzy";

/** The house colours a bot can wear — the accent, then the mascots' cast. */
export const AVATAR_COLORS: ReadonlyArray<string> = Object.freeze([
  "#af5fff", "#2dd4bf", "#fbbf24", "#fb7185", "#60a5fa", "#4ade80", "#f97316", "#e879f9",
]);

type EyeStyle = "focus" | "dots" | "wide" | "happy" | "slits" | "think" | "worry" | "sleepy" | "wink" | "dizzy";
type NoseStyle = "small" | "smile" | "frown" | "o" | "tongue" | "zzz";

interface CatParams {
  hr: number; br: number; hy: number; by: number; sw: number;
  earH: number; earW: number; earRound: boolean; earSpread: number;
  eyeGap: number; eyeStyle: EyeStyle; eyeR: number;
  whiskLen: number; whiskN: number; whiskAngle: number;
  noseSize: number; mouth: boolean;
  tail: "swish" | "curl" | "up" | "stub" | "long"; fill: boolean; collar: boolean; gap: number;
}

const BASE: CatParams = {
  hr: 17, br: 22, hy: 40, by: 76, sw: 2.2,
  earH: 15, earW: 12, earRound: false, earSpread: 0,
  eyeGap: 12, eyeStyle: "focus", eyeR: 2.2,
  whiskLen: 12, whiskN: 3, whiskAngle: 2,
  noseSize: 1.5, mouth: false,
  tail: "swish", fill: false, collar: false, gap: 0,
};

/** The twelve bodies, in the sheet's order and under its names. */
export const AVATAR_VARIANTS: ReadonlyArray<{ id: number; name: string; o: Partial<CatParams> }> = Object.freeze([
  { id: 1, name: "The pick", o: {} },
  { id: 2, name: "Big head", o: { hr: 20, br: 20, hy: 38, by: 78 } },
  { id: 3, name: "Round", o: { br: 26, by: 78, tail: "stub", earRound: true, earH: 12 } },
  { id: 4, name: "Fine line", o: { sw: 1.5, whiskLen: 14 } },
  { id: 5, name: "Bold line", o: { sw: 3.2, whiskLen: 11, eyeR: 2.6 } },
  { id: 6, name: "Silhouette", o: { fill: true, sw: 2.2, eyeStyle: "dots", whiskLen: 10 } },
  { id: 7, name: "Curled tail", o: { tail: "curl" } },
  { id: 8, name: "Tail up", o: { tail: "up", eyeStyle: "wide" } },
  { id: 9, name: "Small face", o: { eyeGap: 8, whiskLen: 8, noseSize: 1.1, eyeStyle: "dots" } },
  { id: 10, name: "Long whiskers", o: { whiskN: 4, whiskLen: 16, whiskAngle: 3, eyeStyle: "slits" } },
  { id: 11, name: "Wide ears", o: { hr: 15, earSpread: 4, earH: 18, earW: 10, hy: 41 } },
  { id: 12, name: "Snowman", o: { hr: 16, br: 24, hy: 44, by: 78, gap: 0, collar: true, eyeStyle: "happy", mouth: true, tail: "long" } },
]);

/** What a mood changes: the eyes, the nose, the tilt of the whiskers. The
 *  body's own eye style (a silhouette's dots, a wide-eyed tail-up) stays
 *  while the cat is idle; a mood overrides it. */
const MOODS: Record<BotMood, { eyes?: EyeStyle; nose: NoseStyle; whisk: number }> = {
  idle: { nose: "small", whisk: 0 },
  thinking: { eyes: "think", nose: "small", whisk: -2 },
  generating: { eyes: "focus", nose: "small", whisk: 2 },
  done: { eyes: "happy", nose: "smile", whisk: 6 },
  listening: { eyes: "wide", nose: "o", whisk: 0 },
  error: { eyes: "worry", nose: "frown", whisk: -7 },
  curious: { eyes: "wide", nose: "small", whisk: 3 },
  sleepy: { eyes: "sleepy", nose: "zzz", whisk: -3 },
  playful: { eyes: "wink", nose: "tongue", whisk: 5 },
  dizzy: { eyes: "dizzy", nose: "o", whisk: -4 },
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

/** A stable pick for a bot with no avatar of its own: body and colour from
 *  the slug, so the same bot wears the same cat everywhere. */
export function defaultAvatar(slug: string): BotAvatar {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return { variant: (h % AVATAR_VARIANTS.length) + 1, color: AVATAR_COLORS[(h >>> 4) % AVATAR_COLORS.length]! };
}

/** The avatar a record carries, or the slug's default. */
export function avatarOf(bot: { slug: string; avatar?: BotAvatar | null }): BotAvatar {
  const a = bot.avatar;
  if (a && Number.isFinite(a.variant) && a.variant >= 1 && a.variant <= AVATAR_VARIANTS.length && /^#[0-9a-f]{3,8}$/i.test(a.color)) return { variant: Math.round(a.variant), color: a.color };
  return defaultAvatar(bot.slug);
}

const r1 = (n: number): string => String(Math.round(n * 10) / 10);

/**
 * The cat as an inline SVG string, 100×100 box, stroke in `color`. The root
 * carries `bot-cat` and the mood as classes; styles.css animates the tail,
 * ears and body per mood (`.bot-cat.generating .tail` swishes, …).
 */
export function botAvatarSvg(avatar: BotAvatar, mood: BotMood = "idle", opts: { size?: number; title?: string } = {}): string {
  const def = AVATAR_VARIANTS.find((x) => x.id === avatar.variant) ?? AVATAR_VARIANTS[0]!;
  const v: CatParams = { ...BASE, ...def.o };
  const m = MOODS[mood] ?? MOODS.idle;
  const eyeStyle: EyeStyle = m.eyes ?? v.eyeStyle;
  const ink = avatar.color;
  const stroke = `fill="none" stroke="${ink}" stroke-width="${v.sw}" stroke-linecap="round" stroke-linejoin="round"`;
  // A silhouette's face is cut out of the ink: its features draw in the page's
  // background, which the stylesheet supplies as currentColor on `.bot-cat`.
  const face = v.fill ? `fill="none" stroke="currentColor" stroke-width="${v.sw}" stroke-linecap="round" stroke-linejoin="round"` : stroke;
  const dot = v.fill ? `fill="currentColor" stroke="none"` : `fill="${ink}" stroke="none"`;
  const L = 50 - v.hr * 0.6 - v.earSpread, R = 50 + v.hr * 0.6 + v.earSpread;
  const top = v.hy - v.hr;
  const earL = v.earRound
    ? `M${r1(L - v.earW / 2)} ${r1(top + 4)} Q ${r1(L - v.earW / 2 - 1)} ${r1(top - v.earH)} ${r1(L + v.earW / 2)} ${r1(top + 1)}`
    : `M${r1(L - v.earW / 2)} ${r1(top + 4)} L${r1(L - 2)} ${r1(top - v.earH)} L${r1(L + v.earW / 2)} ${r1(top + 1)}`;
  const earR = v.earRound
    ? `M${r1(R + v.earW / 2)} ${r1(top + 4)} Q ${r1(R + v.earW / 2 + 1)} ${r1(top - v.earH)} ${r1(R - v.earW / 2)} ${r1(top + 1)}`
    : `M${r1(R + v.earW / 2)} ${r1(top + 4)} L${r1(R + 2)} ${r1(top - v.earH)} L${r1(R - v.earW / 2)} ${r1(top + 1)}`;
  const ey = v.hy - 2, ex1 = 50 - v.eyeGap / 2, ex2 = 50 + v.eyeGap / 2;
  const eyes: Record<EyeStyle, string> = {
    focus: `<path ${face} d="M${r1(ex1 - 3)} ${r1(ey - 1)} l6 1"/><path ${face} d="M${r1(ex2 + 3)} ${r1(ey - 1)} l-6 1"/>`,
    dots: `<circle class="eye" ${dot} cx="${r1(ex1)}" cy="${r1(ey)}" r="${v.eyeR}"/><circle class="eye" ${dot} cx="${r1(ex2)}" cy="${r1(ey)}" r="${v.eyeR}"/>`,
    wide: `<circle ${face} cx="${r1(ex1)}" cy="${r1(ey)}" r="3.2"/><circle ${face} cx="${r1(ex2)}" cy="${r1(ey)}" r="3.2"/><circle ${dot} cx="${r1(ex1)}" cy="${r1(ey)}" r="1.2"/><circle ${dot} cx="${r1(ex2)}" cy="${r1(ey)}" r="1.2"/>`,
    happy: `<path ${face} d="M${r1(ex1 - 3)} ${r1(ey + 1)} q3 -4 6 0"/><path ${face} d="M${r1(ex2 - 3)} ${r1(ey + 1)} q3 -4 6 0"/>`,
    slits: `<path ${face} d="M${r1(ex1)} ${r1(ey - 2.5)} l0 5"/><path ${face} d="M${r1(ex2)} ${r1(ey - 2.5)} l0 5"/>`,
    think: `<circle class="eye" ${dot} cx="${r1(ex1 + 1)}" cy="${r1(ey - 1)}" r="${v.eyeR}"/><circle class="eye" ${dot} cx="${r1(ex2 + 1)}" cy="${r1(ey - 1)}" r="${v.eyeR}"/><path ${face} d="M${r1(ex1 - 3)} ${r1(ey - 5)} l5 -1.5"/><path ${face} d="M${r1(ex2 + 3)} ${r1(ey - 5)} l-5 -1.5"/>`,
    worry: `<circle class="eye" ${dot} cx="${r1(ex1)}" cy="${r1(ey + 1)}" r="${v.eyeR}"/><circle class="eye" ${dot} cx="${r1(ex2)}" cy="${r1(ey + 1)}" r="${v.eyeR}"/><path ${face} d="M${r1(ex1 - 3)} ${r1(ey - 4)} l5 1.5"/><path ${face} d="M${r1(ex2 + 3)} ${r1(ey - 4)} l-5 1.5"/>`,
    sleepy: `<path ${face} d="M${r1(ex1 - 3)} ${r1(ey + 1)} q3 2 6 0"/><path ${face} d="M${r1(ex2 - 3)} ${r1(ey + 1)} q3 2 6 0"/>`,
    wink: `<circle class="eye" ${dot} cx="${r1(ex1)}" cy="${r1(ey)}" r="${v.eyeR}"/><path ${face} d="M${r1(ex2 - 3)} ${r1(ey)} l6 0"/>`,
    dizzy: `<path ${face} d="M${r1(ex1 - 2)} ${r1(ey - 2)} l4 4 M${r1(ex1 + 2)} ${r1(ey - 2)} l-4 4"/><path ${face} d="M${r1(ex2 - 2)} ${r1(ey - 2)} l4 4 M${r1(ex2 + 2)} ${r1(ey - 2)} l-4 4"/>`,
  };
  const ny = v.hy + 4, n = v.noseSize;
  const noseTri = `<path ${dot} d="M${r1(50 - n)} ${r1(ny)} L${r1(50 + n)} ${r1(ny)} L50 ${r1(ny + n * 1.4)} Z"/>`;
  const mouthSmile = `<path ${face} d="M47 ${r1(ny + 4)} q3 2.5 6 0"/>`;
  const noses: Record<NoseStyle, string> = {
    small: noseTri + (v.mouth ? mouthSmile : ""),
    smile: noseTri + mouthSmile,
    frown: noseTri + `<path ${face} d="M47 ${r1(ny + 5)} q3 -2.5 6 0"/>`,
    o: noseTri + `<circle ${face} cx="50" cy="${r1(ny + 5.5)}" r="1.8"/>`,
    tongue: noseTri + mouthSmile + `<path ${face} d="M50 ${r1(ny + 5)} q0 3 2 3"/>`,
    zzz: noseTri + `<path ${stroke} d="M68 24 h6 l-6 6 h6"/><path ${stroke} d="M74 14 h4 l-4 4 h4"/>`,
  };
  const wx1 = 50 - v.hr + 1, wx2 = 50 + v.hr - 1, wy = v.hy + 3;
  let wh = "";
  for (let i = 0; i < v.whiskN; i++) {
    const dy = (i - (v.whiskN - 1) / 2) * 3.2;
    const tilt = (i - (v.whiskN - 1) / 2) * v.whiskAngle + m.whisk * 0.4;
    wh += `<path ${stroke} d="M${r1(wx1)} ${r1(wy + dy)} L${r1(wx1 - v.whiskLen)} ${r1(wy + dy + tilt)}"/><path ${stroke} d="M${r1(wx2)} ${r1(wy + dy)} L${r1(wx2 + v.whiskLen)} ${r1(wy + dy + tilt)}"/>`;
  }
  const tx = 50 + v.br - 2, ty = v.by + 8;
  const tails: Record<CatParams["tail"], string> = {
    swish: `M${tx} ${ty} C ${tx + 14} ${ty + 2}, ${tx + 22} ${ty - 8}, ${tx + 18} ${ty - 20}`,
    curl: `M${tx} ${ty} C ${tx + 16} ${ty + 4}, ${tx + 20} ${ty - 14}, ${tx + 8} ${ty - 12} C ${tx + 2} ${ty - 11}, ${tx + 4} ${ty - 4}, ${tx + 9} ${ty - 5}`,
    up: `M${tx} ${ty} C ${tx + 10} ${ty - 4}, ${tx + 10} ${ty - 18}, ${tx + 4} ${ty - 26} C ${tx + 1} ${ty - 30}, ${tx + 8} ${ty - 32}, ${tx + 9} ${ty - 28}`,
    stub: `M${tx} ${ty} C ${tx + 8} ${ty + 1}, ${tx + 10} ${ty - 6}, ${tx + 7} ${ty - 9}`,
    long: `M${tx} ${ty} C ${tx + 18} ${ty + 6}, ${tx + 30} ${ty - 6}, ${tx + 26} ${ty - 26}`,
  };
  const bodyFill = v.fill ? `fill="${ink}" stroke="${ink}"` : stroke;
  const collar = v.collar ? `<path ${face} d="M${r1(50 - v.br * 0.55)} ${r1(v.by - v.br + 4)} q${r1(v.br * 0.55)} 5 ${r1(v.br * 1.1)} 0"/>` : "";
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : "";
  const title = opts.title ? `<title>${opts.title.replace(/[<>&]/g, "")}</title>` : "";
  return `<svg class="bot-cat ${mood}" viewBox="0 0 100 100" role="img"${size} data-variant="${def.id}">${title}`
    + `<path class="tail" ${stroke} style="transform-origin:${tx}px ${ty}px" d="${tails[v.tail]}"/>`
    + `<g class="body">`
    + `<circle ${bodyFill} cx="50" cy="${r1(v.by + v.gap)}" r="${v.br}"/>`
    + `<circle ${bodyFill} cx="50" cy="${v.hy}" r="${v.hr}"/>`
    + `<path class="ear ear-l" ${bodyFill} style="transform-origin:${r1(L)}px ${r1(top + 2)}px" d="${earL}"/><path class="ear ear-r" ${bodyFill} style="transform-origin:${r1(R)}px ${r1(top + 2)}px" d="${earR}"/>`
    + `${collar}${eyes[eyeStyle]}${noses[m.nose]}<g class="whiskers">${wh}</g>`
    + `</g></svg>`;
}
