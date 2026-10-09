/**
 * powers.ts — GLYPHH'S POWERS, as pure rules (his order, 2026-10-09: "Powers
 * are singular things, super powers are bots with under them skills, tasks,
 * schedules… every thing you need to deterministically get done becomes that
 * power's mcp tools you can interact with directly or Glyphh can combine").
 *
 * A POWER is one capability, named by the job, not the model: Images, Video,
 * Audio. It owns one MCP tool (local-mcp-server.ts) and the catalog models
 * that can do that job; the member's plan decides which are there, and a
 * power with no model on the plan is not offered. A member can talk to a
 * power directly (its own thread, `powers/<id>`), and Glyphh — or a super
 * power's workflow — calls its tool like any other.
 *
 * Kept free of electron and the network so the rules can be tested.
 */

export type PowerId = "images" | "video" | "audio";

export interface PowerDef {
  id: PowerId;
  name: string;
  /** One line: what the power is for, in the member's words. */
  blurb: string;
  /** The MCP tool the power owns. */
  tool: string;
  /** The catalog modalities whose models can do the job. */
  modalities: ReadonlyArray<string>;
  /** The mascot it wears on the rail (help/bot-avatar.ts variant + colour). */
  avatar: { variant: number; color: string };
  /** The standing brief a direct chat with the power carries. */
  brief: string;
}

export const POWERS: ReadonlyArray<PowerDef> = Object.freeze([
  {
    id: "images", name: "Images", blurb: "Make pictures: logos, photos, illustrations, mockups.",
    tool: "image_generate", modalities: Object.freeze(["image", "image_generation"]),
    avatar: { variant: 3, color: "#f59e0b" },
    brief: "You are Images, one of Glyphh's powers. You make pictures with the image_generate tool. Ask at most one short question when the request is truly unclear; otherwise make it. When the member wants options or a comparison, make the same prompt with two or three different models (powers_list names them) and say which model made which. Give each result's link. Save into the member's folder with saveAs when they are working on a project.",
  },
  {
    id: "video", name: "Video", blurb: "Make short clips from a prompt or a picture.",
    tool: "video_generate", modalities: Object.freeze(["video", "video_generation"]),
    avatar: { variant: 7, color: "#ef4444" },
    brief: "You are Video, one of Glyphh's powers. You make short clips with the video_generate tool, from a prompt or from a picture (imageUrl). Clips take a while: say so, then deliver the link. Save into the member's folder with saveAs when they are working on a project.",
  },
  {
    id: "audio", name: "Audio", blurb: "Make music, sound and voice.",
    tool: "audio_generate", modalities: Object.freeze(["audio", "music", "voice", "audio_speech"]),
    avatar: { variant: 10, color: "#38bdf8" },
    brief: "You are Audio, one of Glyphh's powers. You make music, sound effects and spoken voice with the audio_generate tool. Deliver the link, and save into the member's folder with saveAs when they are working on a project.",
  },
] satisfies PowerDef[]);

export function powerById(id: string): PowerDef | null {
  return POWERS.find((p) => p.id === id) ?? null;
}

export const POWER_THREAD_PREFIX = "powers/";
export const powerChatId = (id: PowerId): string => `${POWER_THREAD_PREFIX}${id}`;
export function powerOfChat(chatId: string): PowerDef | null {
  return chatId.startsWith(POWER_THREAD_PREFIX) ? powerById(chatId.slice(POWER_THREAD_PREFIX.length)) : null;
}

export interface CatalogModelLike { id?: string; name?: string; modality?: string; providerSlug?: string }

/** The catalog models a power can use, in the catalog's order. */
export function modelsForPower(power: PowerDef, catalog: ReadonlyArray<CatalogModelLike>): string[] {
  const out: string[] = [];
  for (const m of catalog) {
    const id = String(m.id ?? m.name ?? "").trim();
    if (id && power.modalities.includes(String(m.modality ?? "").toLowerCase()) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The model a call runs on: the one asked for, when the power has it (matched
 *  on the full id or its bare name), else the power's first. Null = none. */
export function pickPowerModel(available: ReadonlyArray<string>, asked?: string): string | null {
  const want = String(asked ?? "").trim().toLowerCase();
  if (want) {
    const hit = available.find((m) => m.toLowerCase() === want || m.toLowerCase().split("::").pop() === want.split("::").pop());
    if (hit) return hit;
  }
  return available[0] ?? null;
}

/** A file name the power may write inside the member's folder — no paths out of it. */
export function safeSaveName(name: unknown): string | null {
  const n = String(name ?? "").trim();
  if (!n || n.length > 160 || n.includes("..") || n.startsWith("/") || n.startsWith("\\") || /[\x00:*?"<>|]/.test(n)) return null;
  return n;
}
