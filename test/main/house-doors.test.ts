/**
 * house-doors.test.ts — `app.call`, the house apps' read door over the attach
 * socket (src/main/house-doors.ts; his order, 2026-10-05: Apps → Design opens
 * the web's own panel, its files pulled through the relay). Pinned bare over
 * fake stores: house apps only, reads only, a media id fenced to the calling
 * app's own library, names scrubbed, bytes as a capped data URL.
 */
import { describe, expect, it, vi } from "vitest";
import { houseCall, HOUSE_APPS, HOUSE_MEDIA_BYTES_CAP, HOUSE_TOO_LARGE, type HouseDeps } from "../../src/main/house-doors.js";

const asset = (id: string, sizeBytes = 3) => ({ id, kind: id.split("/")[0] as "image" | "video" | "audio", title: id.split("/")[1]!.replace(/\..*$/, ""), mime: id.endsWith(".mp4") ? "video/mp4" : "image/png", sizeBytes, updatedAt: "2026-10-05T00:00:00.000Z", status: "ready" });

function deps(): HouseDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listDesigns: async () => { calls.push("listDesigns"); return [{ file: "brand.json", title: "Brand", size: 10, mtime: 5 }]; },
    readDesign: async (file) => { calls.push(`readDesign:${file}`); return { title: "Brand", document: { name: "Brand", assets: [{ id: "logo", kind: "logo", title: "Logo", contentType: "image/svg+xml", sizeBytes: 3 }] } }; },
    designFileName: (name) => { const s = String(name ?? "").split(/[\\/]/).pop()!.replace(/\.json$/i, ""); if (!s) throw new Error("a design needs a name"); return `${s}.json`; },
    readDesignAsset: async (file, id) => { calls.push(`asset:${file}:${id}`); return id === "logo" ? { contentType: "image/svg+xml", bytes: Buffer.from("<svg/>") } : null; },
    listDecks: async () => { calls.push("listDecks"); return [{ file: "q3.html", title: "Q3", slides: 4 }]; },
    readDeck: async (name) => { calls.push(`readDeck:${String(name)}`); return "<html>deck</html>"; },
    listMedia: (kind, q) => { calls.push(`listMedia:${kind}:${q ?? ""}`); return kind === "image" ? [asset("image/sunset.png")] : []; },
    getMedia: (id) => { calls.push(`getMedia:${id}`); return id.endsWith("big.mp4") ? asset(id, HOUSE_MEDIA_BYTES_CAP + 1) : asset(id); },
    mediaBytes: (id) => { calls.push(`bytes:${id}`); return Buffer.from("PNG"); },
    listDrive: async (q) => { calls.push(`listDrive:${q ?? ""}`); return { folders: [{ id: "f1", name: "Brand", parentId: null }], files: [{ kind: "design", ref: "brand.json" }] }; },
  };
}

describe("app.call — the house apps' read door (his order, 2026-10-05)", () => {
  it("reaches the six house apps and nothing else — before any store call", async () => {
    expect(Object.keys(HOUSE_APPS).sort()).toEqual(["audio", "design", "drive", "images", "slides", "video"]);
    const d = deps();
    for (const bad of [{}, { app: "crm", tool: "list" }, { app: "Design", tool: "list" }, { app: "__proto__", tool: "list" }, "nope", null]) {
      await expect(houseCall(bad, d)).rejects.toThrow(/house apps only/);
    }
    expect(d.calls).toEqual([]);
  });

  it("is read-only: a write-shaped tool is refused, for every app", async () => {
    const d = deps();
    for (const app of Object.keys(HOUSE_APPS)) {
      for (const tool of ["save", "write", "delete", "mkdir", "move", "", "list_images"]) {
        await expect(houseCall({ app, tool, args: {} }, d)).rejects.toThrow(/read-only/);
      }
    }
    expect(d.calls).toEqual([]);
  });

  it("design: list / read / asset — the panel's own shapes, the name scrubbed, the asset a data URL", async () => {
    const d = deps();
    expect(await houseCall({ app: "design", tool: "list" }, d)).toEqual({ designs: [{ file: "brand.json", title: "Brand", size: 10, mtime: 5 }] });
    expect(await houseCall({ app: "design", tool: "read", args: { name: "../../etc/brand" } }, d)).toEqual({ title: "Brand", document: { name: "Brand", assets: [expect.objectContaining({ id: "logo" })] } });
    expect(d.calls).toContain("readDesign:brand.json");
    expect(await houseCall({ app: "design", tool: "asset", args: { name: "brand", id: "logo" } }, d)).toEqual({ url: `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}` });
    await expect(houseCall({ app: "design", tool: "asset", args: { name: "brand", id: "../logo" } }, d)).rejects.toThrow(/plain token/);
    await expect(houseCall({ app: "design", tool: "asset", args: { name: "brand", id: "missing" } }, d)).rejects.toThrow(/asset not found/);
    await expect(houseCall({ app: "design", tool: "read", args: {} }, d)).rejects.toThrow(/needs a name/);
  });

  it("slides: list / read", async () => {
    const d = deps();
    expect(await houseCall({ app: "slides", tool: "list" }, d)).toEqual({ decks: [{ file: "q3.html", title: "Q3", slides: 4 }] });
    expect(await houseCall({ app: "slides", tool: "read", args: { name: "q3" } }, d)).toEqual({ content: "<html>deck</html>" });
  });

  it("images / video / audio: list is the app's OWN kind; read is a data URL fenced to that library", async () => {
    const d = deps();
    expect(await houseCall({ app: "images", tool: "list", args: { q: "sun" } }, d)).toEqual({ assets: [asset("image/sunset.png")] });
    expect(await houseCall({ app: "video", tool: "list" }, d)).toEqual({ assets: [] });
    expect(d.calls).toEqual(["listMedia:image:sun", "listMedia:video:"]);
    expect(await houseCall({ app: "images", tool: "read", args: { id: "image/sunset.png" } }, d)).toEqual({ url: `data:image/png;base64,${Buffer.from("PNG").toString("base64")}`, mime: "image/png", sizeBytes: 3 });
    // The Images app never reads the Video library, whatever the id says.
    await expect(houseCall({ app: "images", tool: "read", args: { id: "video/clip.mp4" } }, d)).rejects.toThrow(/not in the images library/);
    await expect(houseCall({ app: "audio", tool: "read", args: { id: "" } }, d)).rejects.toThrow(/not in the audio library/);
    expect(d.calls.filter((c) => c.startsWith("bytes:"))).toEqual(["bytes:image/sunset.png"]);
  });

  it("caps a read at 8 MB and says so — the socket is JSON", async () => {
    const d = deps();
    await expect(houseCall({ app: "video", tool: "read", args: { id: "video/big.mp4" } }, d)).rejects.toThrow(HOUSE_TOO_LARGE);
    expect(d.calls).not.toContain("bytes:video/big.mp4");
    expect(HOUSE_MEDIA_BYTES_CAP).toBe(8 * 1024 * 1024);
  });

  it("drive: list, with the search", async () => {
    const d = deps();
    expect(await houseCall({ app: "drive", tool: "list", args: { q: "br" } }, d)).toEqual({ folders: [{ id: "f1", name: "Brand", parentId: null }], files: [{ kind: "design", ref: "brand.json" }] });
    expect(d.calls).toEqual(["listDrive:br"]);
    vi.restoreAllMocks();
  });
});
