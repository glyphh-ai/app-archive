/**
 * avatar-gen.test.ts — a super power's generated avatar (his order,
 * 2026-10-09): the hard word screen, the prompt it is made from, and the
 * cutout that puts the figure exactly where a drawn face sits.
 */
import { describe, expect, it } from "vitest";
import { AVATAR_ASK_MAX, avatarAskProblem, foldForScreen, guardPassed } from "../../src/shared/avatar-guard.js";
import { AVATAR_STYLE, avatarImagePrompt, avatarStarterAsk } from "../../src/shared/avatar-style.js";
import { MASCOT_H, MASCOT_W, figureTooSmall, keyOutGreen, mascotFit, placeFigure } from "../../src/shared/avatar-cutout.js";
import { cleanAvatar } from "../../src/shared/member-library.js";

describe("the word screen", () => {
  it("lets a friendly ask through, and ordinary job words", () => {
    for (const ok of ["Code & Systems Bot. It glyphh Bot worker for code synthesis, architecture, debugging and technical execution; picks up queue tasks assigned to code-builder.", "wearing goggles, holding a tiny wrench", "a cat with a laptop and headphones", "troubleshoots servers", "skills and deadlines", "a button on its chest", "dead simple", "kill switch"]) {
      expect(avatarAskProblem(ok)).toBeNull();
    }
  });
  it("refuses every kind, through case, leetspeak and separators", () => {
    for (const bad of ["a NAKED cat", "n.u.d.e cat", "s3xy cat", "cat with a gun", "bloody claws", "smoking weed", "nazi armband", "looks like Pikachu", "holding a pistol", "with text saying hello", "p0rn"]) {
      expect(avatarAskProblem(bad)).not.toBeNull();
    }
  });
  it("refuses links and anything too long", () => {
    expect(avatarAskProblem("like https://example.com/cat.png")).not.toBeNull();
    expect(avatarAskProblem("a".repeat(AVATAR_ASK_MAX + 1))).not.toBeNull();
  });
  it("folds the tricks a screen would miss", () => {
    expect(foldForScreen("N4K3D")).toBe("naked");
  });
  it("passes a model's answer only when it is exactly SAFE", () => {
    expect(guardPassed("SAFE")).toBe(true);
    expect(guardPassed(" safe. ")).toBe(true);
    expect(guardPassed("**SAFE**")).toBe(true);
    for (const no of ["UNSAFE", "", "Probably SAFE", "I think it is safe", "SAFE but", "SAFE UNSAFE", "**UNSAFE**"]) expect(guardPassed(no)).toBe(false);
  });
});

describe("the prompt", () => {
  it("always leads with the mascot's style and asks for the green background", () => {
    const p = avatarImagePrompt({ name: "Scout", description: "reads the web", ask: "wearing a tiny backpack" });
    expect(p.startsWith(AVATAR_STYLE)).toBe(true);
    expect(p).toContain("wearing a tiny backpack");
    expect(p).toContain("#00FF00");
    expect(avatarImagePrompt({ name: "Scout", description: "Reads the web." })).toContain('"Scout"');
  });
  it("starts the modal's box from the name and description", () => {
    expect(avatarStarterAsk("Scout", "Reads the web")).toBe("Scout. It reads the web. Give it one prop or feature that shows what it does.");
    expect(avatarStarterAsk("", "")).toBe("");
  });
});

describe("the cutout", () => {
  /** A w×h green picture with a black square figure. */
  function picture(w: number, h: number, fig: { x: number; y: number; w: number; h: number }): Uint8Array {
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inFig = x >= fig.x && x < fig.x + fig.w && y >= fig.y && y < fig.y + fig.h;
      px[i] = inFig ? 10 : 0; px[i + 1] = inFig ? 10 : 255; px[i + 2] = inFig ? 10 : 0; px[i + 3] = 255;
    }
    return px;
  }
  it("keys the green out and finds the figure", () => {
    const px = picture(40, 40, { x: 10, y: 5, w: 12, h: 30 });
    const box = keyOutGreen(px, 40, 40);
    expect(box).toEqual({ x: 10, y: 5, w: 12, h: 30 });
    expect(px[3]).toBe(0);                     // a corner is transparent
    expect(px[(20 * 40 + 15) * 4 + 3]).toBe(255);   // the figure is solid
  });
  it("answers null when only background is left, and calls a speck too small", () => {
    expect(keyOutGreen(picture(10, 10, { x: 0, y: 0, w: 0, h: 0 }), 10, 10)).toBeNull();
    expect(figureTooSmall({ x: 0, y: 0, w: 2, h: 2 }, 100, 100)).toBe(true);
    expect(figureTooSmall({ x: 0, y: 0, w: 60, h: 80 }, 100, 100)).toBe(false);
  });
  it("fits the figure into the mascot's own box: full height, centred", () => {
    const tall = mascotFit({ w: 50, h: 100 }, 256);
    expect(tall.h).toBe(256);
    expect(tall.y).toBe(0);
    expect(tall.x + tall.w / 2).toBeCloseTo(128, 0);
    const wide = mascotFit({ w: 200, h: 100 }, 256);
    expect(wide.w).toBe(Math.round(256 * MASCOT_W / MASCOT_H));
    expect(wide.y + wide.h / 2).toBeCloseTo(128, 0);
  });
  it("places the figure into a transparent square of the asked size", () => {
    const px = picture(40, 40, { x: 10, y: 5, w: 12, h: 30 });
    const box = keyOutGreen(px, 40, 40)!;
    const to = mascotFit(box, 64);
    const out = placeFigure(px, 40, box, 64, to);
    expect(out.length).toBe(64 * 64 * 4);
    expect(out[3]).toBe(0);
    expect(out[((to.y + 2) * 64 + to.x + 2) * 4 + 3]).toBe(255);
  });
});

describe("the stored avatar", () => {
  it("keeps a small picture and drops anything that is not one", () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    expect(cleanAvatar({ variant: 2, color: "#0b0a0f", image })).toEqual({ variant: 2, color: "#0b0a0f", image });
    expect(cleanAvatar({ variant: 2, color: "#0b0a0f", image: "https://x.test/a.png" })).toEqual({ variant: 2, color: "#0b0a0f" });
    expect(cleanAvatar({ variant: 2, color: "#0b0a0f", image: "data:image/svg+xml;base64,PHN2Zz4=" })).toEqual({ variant: 2, color: "#0b0a0f" });
    expect(cleanAvatar({ variant: 2, color: "#0b0a0f", image: `data:image/png;base64,${"A".repeat(500_000)}` })).toEqual({ variant: 2, color: "#0b0a0f" });
  });
});
