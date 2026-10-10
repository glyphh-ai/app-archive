/**
 * A project's rules live in its folder (his order, 2026-10-10): GLYPHH.md at
 * the folder's root, else AGENTS.md, else CLAUDE.md, rides every turn there;
 * the server is told when it changes, not on every turn.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/main/glyphh-client.js", () => ({ getClient: () => ({ http: { post: async () => ({}) } }) }));
const { readProjectNotes, projectBlock, reportProject, PROJECT_NOTES } = await import("../../src/main/project-notes");

const folder = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "proj-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
};

describe("the project's rules file", () => {
  it("is GLYPHH.md first, then the files other agents keep", () => {
    expect(PROJECT_NOTES).toEqual(["GLYPHH.md", "AGENTS.md", "CLAUDE.md"]);
    expect(readProjectNotes(folder({ "CLAUDE.md": "c", "AGENTS.md": "a", "GLYPHH.md": "g" }))).toEqual({ name: "GLYPHH.md", text: "g" });
    expect(readProjectNotes(folder({ "CLAUDE.md": "c", "AGENTS.md": "a" }))?.name).toBe("AGENTS.md");
    expect(readProjectNotes(folder({ "CLAUDE.md": "c" }))?.name).toBe("CLAUDE.md");
    expect(readProjectNotes(folder({}))).toBeNull();
  });

  it("rides the turn as the project's rules; a folder without one is told where rules go", () => {
    const block = projectBlock({ name: "GLYPHH.md", text: "use pnpm\n" });
    expect(block).toContain('<glyphh_project file="GLYPHH.md">');
    expect(block).toContain("use pnpm");
    expect(projectBlock(null)).toMatch(/no GLYPHH\.md/);
    expect(projectBlock({ name: "GLYPHH.md", text: "   " })).toMatch(/no GLYPHH\.md/);
  });

  it("is reported when it changes, and now and then, never every turn", () => {
    const post = vi.fn(async () => ({}));
    const dir = folder({ "GLYPHH.md": "use pnpm" });
    const notes = readProjectNotes(dir);
    expect(reportProject(dir, notes, post, 1_000)).toBe(true);
    expect(reportProject(dir, notes, post, 2_000)).toBe(false);
    expect(reportProject(dir, { name: "GLYPHH.md", text: "use npm" }, post, 3_000)).toBe(true);
    expect(reportProject(dir, { name: "GLYPHH.md", text: "use npm" }, post, 3_000 + 11 * 60_000)).toBe(true);
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[0]![0]).toMatchObject({ folder: dir, notes: "use pnpm" });
  });
});
