/**
 * bot-avatar.test.ts — the bots' cats (help/bot-avatar.ts): a stable default
 * per slug, the twelve bodies, the mood on the root, the colour as the ink.
 */
import { describe, it, expect } from "vitest";
import { AVATAR_COLORS, AVATAR_VARIANTS, avatarOf, botAvatarSvg, defaultAvatar, moodOf } from "../../src/renderer/help/bot-avatar.js";

describe("bot-avatar — the bots' cats (his order, 2026-10-08)", () => {
  it("twelve bodies, every one drawable, each tagged with its id and the mood", () => {
    expect(AVATAR_VARIANTS.map((v) => v.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const v of AVATAR_VARIANTS) {
      const svg = botAvatarSvg({ variant: v.id, color: "#af5fff" }, "generating");
      expect(svg.startsWith('<svg class="bot-cat generating"')).toBe(true);
      expect(svg).toContain(`data-variant="${v.id}"`);
      expect(svg).toContain('class="tail"');
      expect(svg).toContain("#af5fff");
      expect(svg.endsWith("</svg>")).toBe(true);
    }
  });

  it("a bot with no avatar wears the same cat every time, from its slug", () => {
    const a = defaultAvatar("research-specialist");
    expect(a).toEqual(defaultAvatar("research-specialist"));
    expect(a.variant).toBeGreaterThanOrEqual(1);
    expect(a.variant).toBeLessThanOrEqual(12);
    expect(AVATAR_COLORS).toContain(a.color);
    expect(defaultAvatar("code-builder")).not.toEqual(a);
  });

  it("a record's avatar wins when it is whole; a broken one falls back to the slug's", () => {
    expect(avatarOf({ slug: "x", avatar: { variant: 7, color: "#fb7185" } })).toEqual({ variant: 7, color: "#fb7185" });
    expect(avatarOf({ slug: "x", avatar: { variant: 99, color: "#fb7185" } })).toEqual(defaultAvatar("x"));
    expect(avatarOf({ slug: "x", avatar: { variant: 3, color: "red" } })).toEqual(defaultAvatar("x"));
    expect(avatarOf({ slug: "x", avatar: null })).toEqual(defaultAvatar("x"));
  });

  it("a swarm status reads as a mood; the moods change the face, not the body", () => {
    expect(moodOf("working")).toBe("generating");
    expect(moodOf("waiting")).toBe("curious");
    expect(moodOf("done")).toBe("done");
    expect(moodOf("failed")).toBe("error");
    expect(moodOf(undefined)).toBe("idle");
    const idle = botAvatarSvg({ variant: 1, color: "#000" }, "idle");
    const sad = botAvatarSvg({ variant: 1, color: "#000" }, "error");
    expect(idle).not.toEqual(sad);
    // the body circles are the same in both
    const body = (s: string): string[] => s.match(/<circle [^>]*cx="50"[^>]*>/g) ?? [];
    expect(body(idle)).toEqual(body(sad));
  });

  it("a silhouette cuts its face in the page colour; a title rides when given", () => {
    const s = botAvatarSvg({ variant: 6, color: "#2dd4bf" }, "idle", { size: 40, title: "Scout <b>" });
    expect(s).toContain('fill="currentColor"');
    expect(s).not.toContain('class="eye" class=');
    expect(s).toContain('width="40" height="40"');
    expect(s).toContain("<title>Scout b</title>");
  });
});
