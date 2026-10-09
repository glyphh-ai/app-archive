/**
 * The work board's rules (phase 2 of swarm mode, 2026-10-09): plan, split,
 * wait, review, done — and the board as the model reads it.
 */
import { describe, it, expect } from "vitest";
import { addTasks, boardCounts, boardText, emptyBoard, findTask, readyTasks, updateTask } from "../../src/renderer/help/team-board";

const TEAM = new Set(["glyphh", "ui-builder", "video"]);
const name = (s: string): string => ({ glyphh: "Glyphh", "ui-builder": "UI Builder", video: "Video" }[s] ?? s);

describe("planning", () => {
  it("adds tasks with ids, owners and waits — a batch may point at itself", () => {
    const b = emptyBoard();
    const added = addTasks(b, [
      { title: "Scaffold the app", owner: "glyphh" },
      { title: "Build the upload page", owner: "ui-builder", waits_on: ["Scaffold the app"] },
    ], "glyphh", null, TEAM, 1);
    expect(added.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(findTask(b, "t2")!.waitsOn).toEqual(["t1"]);
    expect(readyTasks(b).map((t) => t.id)).toEqual(["t1"]);
    expect(b.log.map((e) => e.text)).toEqual(["added", "added"]);
  });

  it("refuses an owner off the team, a missing wait and a blank title", () => {
    expect(() => addTasks(emptyBoard(), [{ title: "x", owner: "ghost" }], "glyphh", null, TEAM, 1)).toThrow(/isn't on this team/);
    expect(() => addTasks(emptyBoard(), [{ title: "x", waits_on: ["nope"] }], "glyphh", null, TEAM, 1)).toThrow(/isn't on the board/);
    expect(() => addTasks(emptyBoard(), [{ title: "  " }], "glyphh", null, TEAM, 1)).toThrow(/needs a title/);
  });

  it("a member splits its own task into sub-tasks", () => {
    const b = emptyBoard();
    addTasks(b, [{ title: "Clips", owner: "video" }], "glyphh", null, TEAM, 1);
    const subs = addTasks(b, [{ title: "Transcript" }, { title: "Pick moments", waits_on: ["Transcript"] }], "video", "t1", TEAM, 2);
    expect(subs.every((t) => t.parent === "t1")).toBe(true);
    expect(boardText(b, name)).toContain("  - t2 [Queued] Transcript");
  });
});

describe("working the board", () => {
  it("moves status and owner, keeps notes on a timeline, and logs each change", () => {
    const b = emptyBoard();
    addTasks(b, [{ title: "Header" }], "glyphh", null, TEAM, 1);
    updateTask(b, "Header", { status: "working", owner: "ui-builder", note: "Keep it accessible" }, "glyphh", TEAM, 2);
    const t = findTask(b, "#t1")!;
    expect([t.status, t.owner, t.notes[0]!.text]).toEqual(["working", "ui-builder", "Keep it accessible"]);
    expect(b.log.slice(1).map((e) => e.text)).toEqual(["Queued → Working", "owner → ui-builder", "note: Keep it accessible"]);
    expect(boardCounts(b).working).toBe(1);
  });

  it("can't be done while something it waits on isn't", () => {
    const b = emptyBoard();
    addTasks(b, [{ title: "A" }, { title: "B", waits_on: ["A"] }], "glyphh", null, TEAM, 1);
    expect(() => updateTask(b, "B", { status: "done" }, "glyphh", TEAM, 2)).toThrow(/waits on t1 "A", not done yet/);
    updateTask(b, "A", { status: "done" }, "glyphh", TEAM, 3);
    expect(updateTask(b, "B", { status: "done" }, "glyphh", TEAM, 4).status).toBe("done");
  });

  it("refuses an unknown status or task", () => {
    const b = emptyBoard();
    addTasks(b, [{ title: "A" }], "glyphh", null, TEAM, 1);
    expect(() => updateTask(b, "A", { status: "finished" }, "glyphh", TEAM, 2)).toThrow(/status is one of/);
    expect(() => updateTask(b, "Z", { note: "x" }, "glyphh", TEAM, 2)).toThrow(/no task "Z"/);
  });

  it("reads back for the model: counts, owners, waits, the last note, what's ready", () => {
    const b = emptyBoard();
    addTasks(b, [{ title: "A", owner: "glyphh" }, { title: "B", owner: "video", waits_on: ["A"] }], "glyphh", null, TEAM, 1);
    updateTask(b, "A", { status: "done", note: "Scaffolded in /app" }, "glyphh", TEAM, 2);
    const txt = boardText(b, name);
    expect(txt).toMatch(/^Board: 1 queued, 0 working, 0 needs review, 0 blocked, 1 done\./);
    expect(txt).toContain("- t1 [Done] A — Glyphh · last note: Scaffolded in /app");
    expect(txt).toContain("- t2 [Queued] B — Video · waits on t1");
    expect(txt).toContain("Ready to start: t2.");
    expect(boardText(emptyBoard(), name)).toMatch(/empty/);
  });
});
