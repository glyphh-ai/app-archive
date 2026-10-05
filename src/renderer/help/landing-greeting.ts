/**
 * landing-greeting.ts — THE WORK LANDING'S GREETING (his order, 2026-10-05:
 * replicate Claude's new-chat screen on web and app, "with a cute glyphh
 * message on load, Ada Lovelace themed of course").
 *
 * One pure table: five time-of-day buckets (the mascots' buckets), three or
 * four lines each, every line short and charming and drawn on Ada — the
 * Analytical Engine, poetical science, Note G, the loom, Babbage. No
 * exclamation marks, no emoji, under forty characters. The pick is
 * deterministic per seed (the session id) so a repaint never flickers to
 * another line. Nothing here touches the DOM; the test pins the rules.
 */

export type GreetingBucket = "morning" | "lunch" | "afternoon" | "evening" | "latenight";

/** The longest a line may be (the display face at 34px over the composer). */
export const GREETING_MAX_CHARS = 40;

export const GREETINGS: Readonly<Record<GreetingBucket, readonly string[]>> = {
  morning: [
    "Good morning — the Engine is warm",
    "Hey, early bird — Babbage would approve",
    "Morning, poetical scientist — cards are punched",
    "The loom is threaded for the day",
  ],
  lunch: [
    "Midday, and the Engine hums",
    "A little poetical science with lunch",
    "Note G is open — what shall we compute",
    "The loom weaves on through lunch",
  ],
  afternoon: [
    "Afternoon — the patterns are weaving",
    "The Engine weaves algebraic patterns",
    "Tea, then algebra, dear Analyst",
    "Still weaving — the loom never tires",
  ],
  evening: [
    "Good evening — the Engine keeps time",
    "The lamps are lit in the Engine room",
    "Evening, poetical scientist — one more pattern",
    "Poetical science, by lamplight",
  ],
  latenight: [
    "Burning the midnight oil, dear Analyst?",
    "Late — the Engine never sleeps",
    "The night shift at the Engine",
    "Babbage is asleep; we are not",
  ],
};

/** Local hour → bucket: 5–10 morning, 10–14 lunch, 14–17 afternoon, 17–22
 *  evening, else late night (the same edges mascots.ts draws its cousins on). */
export function greetingBucket(hour: number): GreetingBucket {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 10) return "morning";
  if (h >= 10 && h < 14) return "lunch";
  if (h >= 14 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "latenight";
}

/** A small stable hash (FNV-1a, 32-bit) — the seed is a session id, so the
 *  same thread always greets with the same line. */
export function greetingHash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The line for this seed at this hour. Deterministic: same seed + same
 *  bucket → same line, whatever the repaint count. */
export function pickGreeting(seed: string, hour: number = new Date().getHours()): string {
  const lines = GREETINGS[greetingBucket(hour)];
  return lines[greetingHash(seed) % lines.length];
}
