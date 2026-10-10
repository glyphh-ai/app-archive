/**
 * Glyphh holds everything (his order, 2026-10-09): every connection, power,
 * super power and model, and the folders granted under Settings → System. Its
 * record keeps only what the member took away.
 */
import { describe, expect, it } from "vitest";
import { buildAgentRow, cleanWithheld, glyphhHolds } from "../../src/shared/member-library.js";
import { glyphhPatch, glyphhView, withheldFor, type Everything } from "../../src/renderer/help/glyphh-holds.js";

const all: Everything = {
  folders: ["/Users/me/code"], connections: ["gmail", "slack"], models: ["claude-sonnet-5", "gpt-image-2"],
  skills: ["skill:notes"], superPowers: ["writer", "video"],
};
const row = { slug: "glyphh", name: "Glyphh", model: "" };

describe("Glyphh's page", () => {
  it("shows everything until something is taken away", () => {
    const v = glyphhView(row, all, {});
    expect(v.connections).toEqual(["gmail", "slack"]);
    expect(v.superPowers).toEqual(["writer", "video"]);
    expect(v.folders).toEqual(["/Users/me/code"]);
    expect(v.models).toEqual(["claude-sonnet-5", "gpt-image-2"]);
  });

  it("keeps only what was withheld, and a new connection is held the moment it exists", () => {
    const w = withheldFor(all, { ...all, connections: ["gmail"] });
    expect(w).toEqual({ connections: ["slack"] });
    expect(glyphhPatch(w)).toMatchObject({ withheld: { connections: ["slack"] }, connections: [], superPowers: [] });
    const later = { ...all, connections: [...all.connections, "notion"] };
    expect(glyphhView(row, later, w).connections).toEqual(["gmail", "notion"]);
  });
});

describe("Glyphh's record", () => {
  it("stores withheld on Glyphh's row only, cleaned", () => {
    const g = buildAgentRow({ slug: "glyphh", name: "Glyphh", withheld: { connections: ["slack", "slack", ""], bogus: ["x"] } as never }, null, "2026-10-09T00:00:00.000Z");
    expect(g.withheld).toEqual({ connections: ["slack"] });
    const bot = buildAgentRow({ name: "Writer", withheld: { connections: ["slack"] } }, null, "2026-10-09T00:00:00.000Z");
    expect(bot.withheld).toBeUndefined();
    expect(cleanWithheld(null)).toEqual({});
  });

  it("holds every super power but the ones withheld", () => {
    expect(glyphhHolds(["writer", "video"], { superPowers: ["video"] }, "superPowers")).toEqual(["writer"]);
    expect(glyphhHolds(["writer", "video"], undefined, "superPowers")).toEqual(["writer", "video"]);
  });
});
