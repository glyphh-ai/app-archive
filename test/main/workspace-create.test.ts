import { describe, it, expect } from "vitest";
import { INHERIT, agentStartOf, editedWorkspaceGrid, isAgentCell, withAgentStart, workspaceFormError, type WorkspaceRow } from "../../src/renderer/help/workspace-form.js";

describe("the Create workspace modal's check (his order, 2026-10-08)", () => {
  it("needs a name", () => {
    expect(workspaceFormError("", [])).toMatch(/name/i);
    expect(workspaceFormError("   ", [])).toMatch(/name/i);
  });
  it("refuses a name that exists, whatever its case", () => {
    expect(workspaceFormError("Dev", ["dev"])).toMatch(/already exists/);
  });
  it("takes a new name", () => {
    expect(workspaceFormError("Mail", ["dev"])).toBeNull();
  });
});

describe("how a workspace's agents start (loop, face, route), at the workspace and per agent cell", () => {
  const row: WorkspaceRow = {
    name: "Dev", cols: 2, rows: 1, colWidths: [0.5, 0.5], rowHeights: [1], target: "glyphh", type: "code",
    loop: "claude", view: "cli", gateway: null, modelSelections: { default: "anthropic::claude-opus-5-5", writer: "x" },
    sessionMode: "keep", folder: "/w", space: null,
    splits: [
      { panelId: "tool:coding", col: 0, row: 0, colSpan: 1, rowSpan: 1, sticky: true, config: { folder: "/w/app", loop: "codex" } },
      { panelId: "tool:terminal", col: 1, row: 0, colSpan: 1, rowSpan: 1, config: { cmd: "npm test" } },
      { panelId: "agent:gemini", col: 1, row: 0, colSpan: 1, rowSpan: 1 },
    ],
  };

  it("reads stored answers, and anything unknown is an inherit", () => {
    expect(agentStartOf(row)).toEqual({ loop: "claude", view: "cli", gateway: "" });
    expect(agentStartOf({ view: "chat", gateway: "maybe" })).toEqual(INHERIT);
    expect(agentStartOf(null)).toEqual(INHERIT);
  });

  it("writes a cell's answers over its config: an inherit removes the key, the rest of the config stays", () => {
    expect(withAgentStart({ folder: "/w", loop: "codex", view: "cli" }, { loop: "", view: "glyphh", gateway: "on" }))
      .toEqual({ folder: "/w", view: "glyphh", gateway: "on" });
    expect(withAgentStart(undefined, INHERIT)).toEqual({});
  });

  it("knows an agent cell: the Glyphh agent or a loop's own", () => {
    expect(isAgentCell("tool:coding")).toBe(true);
    expect(isAgentCell("agent:codex")).toBe(true);
    expect(isAgentCell("tool:terminal")).toBe(false);
    expect(isAgentCell(undefined)).toBe(false);
  });

  it("an edit keeps the arrangement and every field it does not show, and writes the answers", () => {
    const grid = editedWorkspaceGrid(row, {
      model: "", session: "new", folder: " /w2 ", agent: { loop: "", view: "glyphh", gateway: "on" },
      cells: { 0: { loop: "gemini", view: "", gateway: "off" }, 1: { loop: "claude", view: "cli", gateway: "" } },
    });
    expect(grid).toMatchObject({
      name: "Dev", cols: 2, rows: 1, target: "glyphh", type: "code", sessionMode: "new", folder: "/w2",
      loop: null, view: "glyphh", gateway: "on", modelSelections: { writer: "x" },
    });
    const cells = grid.cells as Array<{ panelId: string; sticky?: boolean; config?: Record<string, unknown> }>;
    expect(cells[0]).toEqual({ panelId: "tool:coding", col: 0, row: 0, colSpan: 1, rowSpan: 1, sticky: true, config: { folder: "/w/app", loop: "gemini", gateway: "off" } });
    // Not an agent cell: its config is never touched, whatever the edit names.
    expect(cells[1]!.config).toEqual({ cmd: "npm test" });
    // An agent cell the edit does not name keeps what it had (here, nothing).
    expect(cells[2]).toEqual({ panelId: "agent:gemini", col: 1, row: 0, colSpan: 1, rowSpan: 1 });
  });

  it("a model pick replaces the default slot; clearing it drops the selections when nothing else is left", () => {
    const one = { ...row, modelSelections: { default: "a::b" } };
    expect(editedWorkspaceGrid(one, { model: "c::d", session: "keep", folder: "", agent: INHERIT, cells: {} }).modelSelections).toEqual({ default: "c::d" });
    const cleared = editedWorkspaceGrid(one, { model: "", session: "keep", folder: "", agent: INHERIT, cells: {} });
    expect(cleared.modelSelections).toBeUndefined();
    expect(cleared).toMatchObject({ folder: null, loop: null, view: null, gateway: null });
  });
});
