/**
 * avatar-cutout.ts — A GENERATED AVATAR SITS EXACTLY WHERE A FACE SITS (his
 * order, 2026-10-09: "it must maintain the exact same dimensions for the ui /
 * left rail"). The image model paints the character on flat green
 * (shared/avatar-style.ts); this keys the green out, finds the figure, and
 * fits it into the box the mascot's own SVG fills — its 165×200 viewBox,
 * height-filling and centred in a square — so a picture and a drawn face
 * line up row for row. Pure over 4-byte pixels (green at 1, alpha at 3), so
 * BGRA and RGBA both work.
 */

/** The mascot's viewBox (help/bot-avatar.ts). */
export const MASCOT_W = 165;
export const MASCOT_H = 200;

export interface Box { x: number; y: number; w: number; h: number }

/** How green a pixel is over its other two channels (0 = not at all). */
function greenness(r: number, g: number, b: number): number {
  return g - Math.max(r, b);
}

/**
 * Makes the green background transparent in place, with a soft edge and the
 * green spill taken out of the edge pixels. Returns the figure's bounding box,
 * or null when nothing but background is left.
 */
export function keyOutGreen(px: Uint8Array, w: number, h: number): Box | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const c0 = px[i]!, g = px[i + 1]!, c2 = px[i + 2]!;
      const gn = greenness(c0, g, c2);
      let a = 255;
      if (gn > 90 && g > 120) a = 0;                       // the background
      else if (gn > 30) a = Math.round(255 * (1 - (gn - 30) / 60));   // the edge
      if (a < 255 && a > 0) px[i + 1] = Math.max(c0, c2);  // no green fringe
      const keep = a / 255;
      px[i] = Math.round(px[i]! * keep);
      px[i + 1] = Math.round(px[i + 1]! * keep);
      px[i + 2] = Math.round(px[i + 2]! * keep);
      px[i + 3] = a;
      if (a > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Where the figure lands in an out×out square: inside the mascot's box, aspect kept, centred. */
export function mascotFit(fig: { w: number; h: number }, out: number): Box {
  const boxH = out;
  const boxW = Math.round(out * MASCOT_W / MASCOT_H);
  const scale = Math.min(boxW / fig.w, boxH / fig.h);
  const w = Math.max(1, Math.round(fig.w * scale));
  const h = Math.max(1, Math.round(fig.h * scale));
  return { x: Math.round((out - w) / 2), y: Math.round((out - h) / 2), w, h };
}

/** The figure in `box` of src, area-averaged into `to` of a fresh out×out transparent square. */
export function placeFigure(src: Uint8Array, sw: number, box: Box, out: number, to: Box): Uint8Array {
  const dst = new Uint8Array(out * out * 4);
  const sx = box.w / to.w, sy = box.h / to.h;
  for (let y = 0; y < to.h; y++) {
    const fy0 = box.y + y * sy, fy1 = fy0 + sy;
    for (let x = 0; x < to.w; x++) {
      const fx0 = box.x + x * sx, fx1 = fx0 + sx;
      let c0 = 0, c1 = 0, c2 = 0, c3 = 0, n = 0;
      for (let yy = Math.floor(fy0); yy < Math.max(Math.floor(fy0) + 1, Math.ceil(fy1)); yy++) {
        for (let xx = Math.floor(fx0); xx < Math.max(Math.floor(fx0) + 1, Math.ceil(fx1)); xx++) {
          const i = (yy * sw + xx) * 4;
          c0 += src[i]!; c1 += src[i + 1]!; c2 += src[i + 2]!; c3 += src[i + 3]!; n++;
        }
      }
      const o = ((to.y + y) * out + (to.x + x)) * 4;
      dst[o] = Math.round(c0 / n); dst[o + 1] = Math.round(c1 / n); dst[o + 2] = Math.round(c2 / n); dst[o + 3] = Math.round(c3 / n);
    }
  }
  return dst;
}

/** Too little figure left after the key: a background-only or broken picture. */
export function figureTooSmall(fig: Box, w: number, h: number): boolean {
  return fig.w * fig.h < w * h * 0.02;
}
