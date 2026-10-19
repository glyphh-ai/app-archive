/**
 * embeddings-local.test.ts — memory, search and app data embed on this
 * machine with one built-in model: no server, no key, the same on every run.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: () => undefined } }));
vi.mock("../../src/main/memory.js", () => ({ registerMemoryIpc: () => undefined }));

const cfg = await import("../../src/main/embeddings-config.js");

const dot = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + v * b[i]!, 0);

describe("the local embedder", () => {
  it("offers one local model and always resolves to it", async () => {
    expect(await cfg.orgEmbedModels()).toEqual([cfg.LOCAL_EMBED_MODEL]);
    expect(await cfg.resolveEmbedModel()).toBe(cfg.LOCAL_EMBED_MODEL.id);
    expect(cfg.selectedEmbedModel()).toBe(cfg.LOCAL_EMBED_MODEL.id);
  });

  it("knows a model by its id or its bare name, and nothing else", () => {
    const models = [cfg.LOCAL_EMBED_MODEL];
    expect(cfg.offers(models, "local::hashed-words-512")).toBe(true);
    expect(cfg.offers(models, "hashed-words-512")).toBe(true);
    expect(cfg.offers(models, "openai::text-embedding-3-large")).toBe(false);
    expect(cfg.routeName("openai::text-embedding-3-large")).toBe("text-embedding-3-large");
    expect(cfg.routeName("bare")).toBe("bare");
  });

  it("splits words in any script, lowercased", () => {
    expect(cfg.words("Deploy the API, v2 — café 東京!")).toEqual(["deploy", "the", "api", "v2", "café", "東京"]);
    expect(cfg.words("  ")).toEqual([]);
  });

  it("returns unit vectors that are stable across calls", async () => {
    const [a, b] = await cfg.localEmbed(["deploy the service with a canary", "deploy the service with a canary"], "any");
    expect(a).toHaveLength(512);
    expect(dot(a!, a!)).toBeCloseTo(1, 6);
    expect(b).toEqual(a);
  });

  it("scores text that shares words above text that does not", () => {
    const q = cfg.embedOne("how do we deploy the service");
    const near = cfg.embedOne("deploy the service with a canary release");
    const far = cfg.embedOne("the budget is tracked in dollars");
    expect(dot(q, near)).toBeGreaterThan(dot(q, far));
  });

  it("counts repeats sublinearly and embeds empty text as the zero vector", () => {
    const once = cfg.embedOne("alpha beta");
    const many = cfg.embedOne("alpha alpha alpha alpha beta");
    expect(dot(once, many)).toBeLessThan(1);
    expect(dot(once, many)).toBeGreaterThan(0.5);
    expect(cfg.embedOne("").every((v) => v === 0)).toBe(true);
  });

  it("answers the settings IPC with the local model", async () => {
    const handlers = new Map<string, (...a: unknown[]) => unknown>();
    const electron = await import("electron");
    (electron.ipcMain as unknown as { handle: (c: string, f: (...a: unknown[]) => unknown) => void }).handle = (c, f) => { handlers.set(c, f); };
    cfg.registerEmbeddingsIpc();
    expect(await handlers.get("embeddings-config-get")!()).toEqual({ ok: true, model: cfg.LOCAL_EMBED_MODEL.id, models: [cfg.LOCAL_EMBED_MODEL] });
    expect(await handlers.get("embeddings-config-set")!()).toEqual({ ok: true, model: cfg.LOCAL_EMBED_MODEL.id });
  });
});
