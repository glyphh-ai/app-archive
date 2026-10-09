/**
 * bot-avatar.test.ts — the super powers' faces (help/bot-avatar.ts): the
 * Glyphh mascot in sixteen variants, a stable default per slug, the mood on
 * the root and in the eye, the colour as the body.
 */
import { describe, it, expect } from "vitest";
import { AVATAR_COLORS, AVATAR_VARIANTS, avatarOf, botAvatarSvg, defaultAvatar, moodOf } from "../../src/renderer/help/bot-avatar.js";

describe("bot-avatar — the super powers' faces are the Glyphh mascot (his orders, 2026-10-08/09)", () => {
  it("sixteen variants, every one the mascot: sticker border, body in the colour, the leg gap, tagged with its id and mood", () => {
    expect(AVATAR_VARIANTS.map((v) => v.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(AVATAR_VARIANTS[0]!.name).toBe("Glyphh");
    for (const v of AVATAR_VARIANTS) {
      const svg = botAvatarSvg({ variant: v.id, color: "#af5fff" }, "generating");
      expect(svg.startsWith('<svg class="bot-cat generating" viewBox="0 0 165 200"')).toBe(true);
      expect(svg).toContain(`data-variant="${v.id}"`);
      expect(svg).toContain('stroke-width="16"');                 // the sticker border
      expect(svg).toContain('fill="#0b0a0f"');                     // the body: Glyphh black for now
      expect(svg).not.toContain("#af5fff");                         // a stored colour is kept, not drawn
      expect(svg).toContain('d="M61 138 L99 150 L100 172 L51 171 Z"');   // the leg gap
      expect(svg.endsWith("</svg>")).toBe(true);
    }
  });

  it("a bot with no avatar wears the same face every time, from its slug", () => {
    const a = defaultAvatar("research-specialist");
    expect(a).toEqual(defaultAvatar("research-specialist"));
    expect(a.variant).toBe(2);   // "Default to look" (his order, 2026-10-09): Side-eye
    expect(AVATAR_COLORS).toContain(a.color);
    // Black for now (2026-10-09): every bot without a pick wears the same Side-eye.
    expect(defaultAvatar("code-builder")).toEqual({ variant: 2, color: "#0b0a0f" });
  });

  it("a record's avatar wins when it is whole; a broken one falls back to the slug's", () => {
    expect(avatarOf({ slug: "x", avatar: { variant: 7, color: "#fb7185" } })).toEqual({ variant: 7, color: "#fb7185" });
    expect(avatarOf({ slug: "x", avatar: { variant: 99, color: "#fb7185" } })).toEqual(defaultAvatar("x"));
    expect(avatarOf({ slug: "x", avatar: { variant: 3, color: "red" } })).toEqual(defaultAvatar("x"));
    expect(avatarOf({ slug: "x", avatar: null })).toEqual(defaultAvatar("x"));
  });

  it("a swarm status reads as a mood; a mood changes the eye, never the body", () => {
    expect(moodOf("working")).toBe("generating");
    expect(moodOf("waiting")).toBe("curious");
    expect(moodOf("done")).toBe("done");
    expect(moodOf("failed")).toBe("error");
    expect(moodOf(undefined)).toBe("idle");
    const idle = botAvatarSvg({ variant: 1, color: "#0b0a0f" }, "idle");
    const done = botAvatarSvg({ variant: 1, color: "#0b0a0f" }, "done");
    expect(idle).not.toEqual(done);
    const silhouette = (s: string): string => s.match(/<path d="M40 62 [^"]*" fill="#0b0a0f"/)?.[0] ?? "";
    expect(silhouette(idle)).not.toBe("");
    expect(silhouette(idle)).toEqual(silhouette(done));
  });

  it("a size and a title ride when given", () => {
    const s = botAvatarSvg({ variant: 15, color: "#2dd4bf" }, "idle", { size: 40, title: "Scout <b>" });
    expect(s).toContain('width="40" height="40"');
    expect(s).toContain("<title>Scout b</title>");
  });
});
