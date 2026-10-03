/** The member's embedding pick follows what the org publishes (his report, 2026-10-03). */

import { describe, expect, it, vi } from "vitest";

let pick: unknown = "openai::text-embedding-3-large";
let rows: unknown = [];
let fail = false;

vi.mock("electron", () => ({ ipcMain: { handle: () => undefined } }));
vi.mock("../../src/main/stores/preferences-db.js", () => ({
  getPreference: () => pick, setPreference: (_k: string, v: unknown) => { pick = v; },
}));
vi.mock("../../src/main/glyphh-client.js", () => ({
  getClient: () => ({ http: { get: async () => { if (fail) throw new Error("offline"); return rows; } } }),
}));
vi.mock("../../src/main/gateway-token.js", () => ({ mcpCreds: async () => null }));
vi.mock("../../src/main/memory.js", () => ({ registerMemoryIpc: () => undefined }));

const cfg = await import("../../src/main/embeddings-config.js");
const nomic = { id: "nomic::nomic-embed-text-v1.5", name: "nomic-embed-text-v1.5", providerSlug: "nomic", modality: "embedding" };
const chat = { id: "anthropic::claude-fable-5-1", name: "claude-fable-5-1", providerSlug: "anthropic", modality: "chat" };

describe("resolveEmbedModel", () => {
  it("keeps a pick the org still publishes", async () => {
    rows = [chat, nomic, { ...nomic, id: "openai::text-embedding-3-large", name: "text-embedding-3-large" }];
    expect(await cfg.resolveEmbedModel()).toBe("openai::text-embedding-3-large");
    expect(pick).toBe("openai::text-embedding-3-large");
  });

  it("moves a pick the org no longer publishes to the first model it does, and keeps that as the pick", async () => {
    rows = [chat, nomic];
    await cfg.orgEmbedModels(true);
    expect(await cfg.resolveEmbedModel()).toBe("nomic::nomic-embed-text-v1.5");
    expect(pick).toBe("nomic::nomic-embed-text-v1.5");
  });

  it("answers nothing when the org publishes no embedding model", async () => {
    rows = [chat];
    await cfg.orgEmbedModels(true);
    expect(await cfg.resolveEmbedModel()).toBe("");
  });

  it("keeps the pick as it stands when the server cannot be asked and nothing is cached", async () => {
    vi.resetModules();
    pick = "nomic::nomic-embed-text-v1.5";
    fail = true;
    const fresh = await import("../../src/main/embeddings-config.js");
    expect(await fresh.resolveEmbedModel()).toBe("nomic::nomic-embed-text-v1.5");
    fail = false;
  });
});
