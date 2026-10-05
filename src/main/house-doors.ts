/**
 * house-doors.ts — `app.call { app, tool, args }`: THE HOUSE APPS' READ DOOR
 * over the attach socket (his order, 2026-10-05: "selecting Apps → Design
 * should open the web panel in the web but pull through the relay").
 *
 * The web hosts the house panels itself (Design, Slides, Images, Video,
 * Audio, Drive — renderer/help/house-relay.ts) and fills them from THIS
 * machine: the member's designs, decks and media live in its app-data
 * (media-local.ts, office-store.ts). Every tool here is the SAME store call
 * the panel's own IPC runs on (design.ts, gpoints.ts, media-panel.ts,
 * office-docs.ts) — one behavior, two transports, the relay-fs.ts precedent.
 *
 * FENCES (read-only, house only; the server fences the same — attach.py
 * HOUSE_APPS):
 *   · `app` must be a house slug, `tool` one of that app's reads; anything
 *     else is refused before any disk access — a write never rides this door
 *     (the web says "Make changes on your desktop").
 *   · a media id is fenced to the calling app's OWN library (`images` reads
 *     `image/…` only; media-local.ts pathOf never follows a name back out);
 *     a design / deck name goes through the same file-name scrubber the IPC
 *     uses; an asset id is a plain token.
 *   · bytes ride the relay as a data URL — the socket is JSON (sdk
 *     runtime/attach.ts sends JSON frames; the server's websocket takes
 *     ~16 MB) — so a read is capped at HOUSE_MEDIA_BYTES_CAP and a bigger
 *     file answers the one line instead.
 *
 * Pure over `deps` (house-deps.ts wires the real stores); test/main/
 * house-doors.test.ts runs it bare.
 */

export type HouseMediaKind = "image" | "audio" | "video";

/** The house apps the door reaches, each with its library. */
export const HOUSE_APPS: Readonly<Record<string, { media?: HouseMediaKind }>> = Object.freeze({
  design: {}, slides: {}, drive: {}, images: { media: "image" }, video: { media: "video" }, audio: { media: "audio" },
});

/** 8 MB of raw bytes → ~10.7 MB of base64 in one JSON frame, under the socket's ceiling. */
export const HOUSE_MEDIA_BYTES_CAP = 8 * 1024 * 1024;
export const HOUSE_TOO_LARGE = "too large to show on the web (over 8 MB) — open it on your desktop";

export interface HouseDesignMeta { file: string; title: string; size: number; mtime: number }
/** The slice of media-local.ts's LocalAsset the door reads; the full row rides through untouched. */
export interface HouseAsset { id: string; kind: HouseMediaKind; title: string; mime: string; sizeBytes: number; updatedAt: string; status: string }

/** The stores behind the door — exactly what the panels' IPC calls. */
export interface HouseDeps {
  listDesigns(): Promise<HouseDesignMeta[]>;
  readDesign(file: string): Promise<{ title: string; document: unknown }>;
  /** The scrubbed `<stem>.json` a name resolves to (design.ts designFileName). */
  designFileName(name: unknown): string;
  readDesignAsset(file: string, assetId: string): Promise<{ contentType: string; bytes: Buffer } | null>;
  listDecks(): Promise<unknown[]>;
  readDeck(name: unknown): Promise<string>;
  listMedia(kind: HouseMediaKind, q?: string): HouseAsset[];
  getMedia(id: string): HouseAsset;
  mediaBytes(id: string): Buffer;
  listDrive(q?: string): Promise<{ folders: unknown[]; files: unknown[] }>;
}

const str = (p: Record<string, unknown>, key: string): string => (typeof p[key] === "string" ? (p[key] as string) : "");
const ASSET_ID = /^[\w.-]{1,120}$/;

/** A file's bytes as the data URL the panel's <img> / <video> renders, or the cap line. */
function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime || "application/octet-stream"};base64,${bytes.toString("base64")}`;
}

/** The one door: refuses before touching the disk; every answer is a plain JSON shape. */
export async function houseCall(params: unknown, deps: HouseDeps): Promise<unknown> {
  const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
  const app = str(p, "app");
  const tool = str(p, "tool");
  const args = (p.args && typeof p.args === "object" ? p.args : {}) as Record<string, unknown>;
  const house = Object.prototype.hasOwnProperty.call(HOUSE_APPS, app) ? HOUSE_APPS[app] : undefined;
  if (!house) throw new Error(`app.call reaches the house apps only (${Object.keys(HOUSE_APPS).join(", ")}), not "${app || "?"}"`);
  const refuse = (): never => { throw new Error(`app.call is read-only: "${app}" has no "${tool || "?"}" read over the relay`); };

  if (house.media) {
    const kind = house.media;
    if (tool === "list") return { assets: deps.listMedia(kind, str(args, "q") || undefined) };
    if (tool === "read") {
      const id = str(args, "id");
      // The id names the calling app's OWN library, never another's.
      if (!id.startsWith(`${kind}/`)) throw new Error(`"${id}" is not in the ${app} library`);
      const asset = deps.getMedia(id);
      if (asset.sizeBytes > HOUSE_MEDIA_BYTES_CAP) throw new Error(HOUSE_TOO_LARGE);
      return { url: dataUrl(asset.mime, deps.mediaBytes(id)), mime: asset.mime, sizeBytes: asset.sizeBytes };
    }
    return refuse();
  }
  if (app === "design") {
    if (tool === "list") return { designs: await deps.listDesigns() };
    if (tool === "read") {
      const d = await deps.readDesign(deps.designFileName(args.name));
      return { title: d.title, document: d.document };
    }
    if (tool === "asset") {
      const file = deps.designFileName(args.name);
      const id = str(args, "id");
      if (!ASSET_ID.test(id)) throw new Error("an asset id is a plain token");
      const a = await deps.readDesignAsset(file, id);
      if (!a) throw new Error("asset not found");
      if (a.bytes.byteLength > HOUSE_MEDIA_BYTES_CAP) throw new Error(HOUSE_TOO_LARGE);
      return { url: dataUrl(a.contentType, a.bytes) };
    }
    return refuse();
  }
  if (app === "slides") {
    if (tool === "list") return { decks: await deps.listDecks() };
    if (tool === "read") return { content: await deps.readDeck(args.name) };
    return refuse();
  }
  // drive
  if (tool === "list") return await deps.listDrive(str(args, "q") || undefined);
  return refuse();
}
