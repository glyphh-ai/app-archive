/**
 * house-relay.test.ts — the house panels on the web, as rules
 * (src/renderer/help/house-relay.ts; his order, 2026-10-05: Apps → Design
 * opens the web's own panel, its files pulled through the relay). The slug →
 * view table, the connect lines, the read-only line and the not-attached
 * answer the panels paint bare.
 */
import { describe, expect, it } from "vitest";
import {
  HOUSE_VIEW_OF_APP, HOUSE_TOOL_VIEWS, HOUSE_APPS, houseViewOf, connectDesktopLine, isNotAttached, houseEmptyText,
  HOUSE_READ_ONLY_LINE, HOUSE_TOO_LARGE_LINE,
} from "../../src/renderer/help/house-relay.js";
import { webToolReachable } from "../../src/renderer/help/web-cut.js";

describe("the house apps on the web (his order, 2026-10-05)", () => {
  it("six house apps, each a built-in work panel the web hosts itself", () => {
    expect(HOUSE_VIEW_OF_APP).toEqual({ design: "gdesign", slides: "gpoint", images: "gimage", video: "gvideo", audio: "gsound", drive: "gdrive" });
    expect([...HOUSE_APPS].sort()).toEqual(["audio", "design", "drive", "images", "slides", "video"]);
    expect([...HOUSE_TOOL_VIEWS].sort()).toEqual(["gdesign", "gdrive", "gimage", "gpoint", "gsound", "gvideo"]);
    // Every house view is one the web's door (__wbOpenTool) lets through.
    for (const v of HOUSE_TOOL_VIEWS) expect(webToolReachable(v)).toBe(true);
  });

  it("houseViewOf answers a house tool and nothing else", () => {
    expect(houseViewOf("gdesign")).toBe("gdesign");
    expect(houseViewOf("gimage")).toBe("gimage");
    for (const bad of ["preview", "files", "terminal", "", undefined, null, 42, "GDESIGN"]) expect(houseViewOf(bad)).toBeNull();
  });

  it("the empty line names what the panel shows — the cloud's, never the desktop's (two worlds, 2026-10-06)", () => {
    expect(connectDesktopLine("gdesign")).toBe("No designs in the cloud yet");
    expect(connectDesktopLine("gimage")).toBe("No images in the cloud yet");
    expect(connectDesktopLine("gpoint")).toBe("No decks in the cloud yet");
    expect(connectDesktopLine("gdrive")).toBe("No Drive in the cloud yet");
    expect(connectDesktopLine("nope")).toBe("No files in the cloud yet");
  });

  it("a not-attached answer paints bare; any other failure keeps the panel's own wording", () => {
    const off = { ok: false, notAttached: true, error: connectDesktopLine("gdrive") };
    expect(isNotAttached(off)).toBe(true);
    expect(isNotAttached({ ok: false, error: "boom" })).toBe(false);
    expect(isNotAttached({ ok: true, notAttached: true, error: "x" })).toBe(false);
    expect(isNotAttached(null)).toBe(false);
    expect(houseEmptyText(off, "Couldn't load Drive:")).toBe("No Drive in the cloud yet");
    expect(houseEmptyText({ ok: false, error: "boom" }, "Couldn't load Drive:")).toBe("Couldn't load Drive: boom");
    expect(houseEmptyText(undefined, "Couldn't load Drive:")).toBe("Couldn't load Drive: Unknown error.");
  });

  it("the two lines the web says instead of pretending", () => {
    expect(HOUSE_READ_ONLY_LINE).toMatch(/^Make changes on your desktop/);
    expect(HOUSE_TOO_LARGE_LINE).toMatch(/open it on your desktop$/);
  });
});
