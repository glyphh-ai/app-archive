/**
 * house-store.ts — THE HOUSE APPS' STORE ON THE DESKTOP: shared/house-store.ts
 * over the app-wide SDK client (his order, 2026-10-06: cloud is the one home;
 * every surface pulls from it). The panels' IPC (design.ts, gpoints.ts,
 * media-panel.ts, drive.ts, office-export.ts) and the one-time migration
 * (house-migration.ts) all go through here; nothing of theirs is on this disk.
 *
 * Built per client instance: a sign-out resets the client (glyphh-client.ts),
 * so the next call builds a store over the new one and never a stale bearer.
 */

import { createHash } from "crypto";
import type { Client } from "@glyphh/sdk";
import { getClient, SERVER_URL } from "./glyphh-client.js";
import { createHouseStore, serverLaneBytes, type HouseStore } from "../shared/house-store.js";

let built: { client: Client; store: HouseStore } | null = null;

export function houseStore(): HouseStore {
  const client = getClient();
  if (!built || built.client !== client) {
    built = {
      client,
      store: createHouseStore({
        lib: client.memberLibrary,
        bytes: serverLaneBytes({ apiUrl: SERVER_URL, token: () => client.token(), fetchImpl: (url, init) => fetch(url, init as RequestInit) }),
        sha256: async (b) => createHash("sha256").update(b).digest("hex"),
      }),
    };
  }
  return built.store;
}
