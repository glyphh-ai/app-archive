/**
 * avatar-style.ts — A SUPER POWER'S GENERATED AVATAR (his order, 2026-10-09:
 * "+ add new… a prompt to generate an avatar for the super power… use our
 * image generation model"). One style, written once: the edit page's modal,
 * the `super_power_avatar` tool and the Glyphh skill all send this prompt to
 * the Images power, so every avatar reads as one family with the mascot.
 */

/** The Glyphh mascot's look, as the image model is told it. */
export const AVATAR_STYLE = [
  "A square app-icon avatar in the exact style of the Glyphh mascot:",
  "a small alien cat drawn as a flat, bold sticker.",
  "Solid black body, two pointed ears, one large white-ringed eye with a white pupil,",
  "a short tail, a thick white sticker outline around the whole figure.",
  "Pure flat shapes, no gradients, no shading, no texture, no text, no letters.",
  "Black and white only. One friendly character, centered, the whole figure visible with a margin around it.",
  "The background is ONE flat solid pure green (#00FF00) colour edge to edge, nothing else in it, and no green anywhere on the character.",
].join(" ");

/** The prompt the Images power gets: the style, then what makes this one its own. */
export function avatarImagePrompt(input: { name?: string; description?: string; ask?: string }): string {
  const ask = String(input.ask ?? "").trim();
  const name = String(input.name ?? "").trim();
  const desc = String(input.description ?? "").trim();
  const about = ask || [name && `It is "${name}".`, desc].filter(Boolean).join(" ");
  return [AVATAR_STYLE, about && `Make this one its own: ${about}`, "Keep it a single character, readable at 32 pixels."].filter(Boolean).join("\n\n");
}

/** What the modal's prompt box starts with for a super power. */
export function avatarStarterAsk(name: string, description: string): string {
  const n = String(name ?? "").trim();
  const d = String(description ?? "").trim();
  if (!n && !d) return "";
  return [n && `${n}.`, d && `It ${d.charAt(0).toLowerCase()}${d.slice(1).replace(/\.?$/, ".")}`].filter(Boolean).join(" ")
    + " Give it one prop or feature that shows what it does.";
}
