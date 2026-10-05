/**
 * house-deps.ts — the REAL stores behind `app.call` (house-doors.ts): the
 * exact calls the house panels' own IPC runs on (design.ts, gpoints.ts,
 * media-panel.ts, office-docs.ts), so the web's panel over the relay and the
 * desktop's panel over IPC read one library (his order, 2026-10-05).
 *
 * Kept apart from house-doors.ts so the door stays pure and the attach
 * handlers' test never loads the office store or the deck cache.
 */

import { designFileName } from "./design.js";
import { listGPoints, readGPoint } from "./gpoints.js";
import * as mediaLocal from "./media-local.js";
import * as office from "./office-store.js";
import type { HouseDeps } from "./house-doors.js";

export function realHouseDeps(): HouseDeps {
  return {
    listDesigns: async () => (await office.listDesigns()).map((m) => ({
      file: m.file, title: m.title, size: m.sizeBytes, mtime: Date.parse(m.updatedAt) || 0,
    })),
    readDesign: async (file) => {
      const d = await office.readDesign(file);
      return { title: d.title, document: d.document };
    },
    designFileName,
    readDesignAsset: async (file, assetId) => {
      const d = await office.readDesign(file);
      const entry = (d.document.assets ?? []).find((x) => x.id === assetId);
      if (!entry) return null;
      return { contentType: entry.contentType, bytes: await office.readDesignAssetBytes(file, entry.id) };
    },
    listDecks: () => listGPoints(),
    readDeck: (name) => readGPoint(name),
    listMedia: (kind, q) => mediaLocal.list(kind, q),
    getMedia: (id) => mediaLocal.get(id),
    mediaBytes: (id) => mediaLocal.bytes(id),
    listDrive: (q) => office.listDrive(q),
  };
}
