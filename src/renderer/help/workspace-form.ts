/** workspace-form.ts — the workspace modal's rules, pure (help/workspace-create.ts). */

/** The modal's answers, checked: null when they can be saved. */
export function workspaceFormError(name: string, existing: ReadonlyArray<string>): string | null {
  const n = name.trim();
  if (!n) return "Give the workspace a name.";
  if (n.length > 60) return "Keep the name under 60 characters.";
  if (existing.some((e) => e.trim().toLowerCase() === n.toLowerCase())) return `A workspace named "${n}" already exists.`;
  return null;
}

// ── How the workspace's agents start ─────────────────────────────────────────

/** The three answers a workspace (and each of its agent cells) gives about
 *  its agent: the loop, the face (chat | terminal, stored "glyphh" | "cli")
 *  and the CLI route (stored "on" | "off"). "" = inherit: the cell from the
 *  workspace, the workspace from the member's defaults. */
export interface AgentStart { loop: string; view: "" | "glyphh" | "cli"; gateway: "" | "on" | "off" }

export const INHERIT: AgentStart = { loop: "", view: "", gateway: "" };

/** Read a stored config (a workspace row, or a cell's config) as the modal's answers. */
export function agentStartOf(cfg: { loop?: unknown; view?: unknown; gateway?: unknown } | null | undefined): AgentStart {
  return {
    loop: typeof cfg?.loop === "string" ? cfg.loop : "",
    view: cfg?.view === "glyphh" || cfg?.view === "cli" ? cfg.view : "",
    gateway: cfg?.gateway === "on" || cfg?.gateway === "off" ? cfg.gateway : "",
  };
}

/** A cell config with the agent answers written in: an inherit removes the
 *  key, so the next level decides; every other key is kept as it was. */
export function withAgentStart<T extends Record<string, unknown>>(cfg: T | undefined, a: AgentStart): T {
  const out: Record<string, unknown> = { ...(cfg ?? {}) };
  for (const k of ["loop", "view", "gateway"] as const) {
    if (a[k]) out[k] = a[k];
    else delete out[k];
  }
  return out as T;
}

/** A workspace cell that seats an agent: the Glyphh agent (tool:coding) or a loop's own cell (agent:<cli>). */
export const isAgentCell = (panelId: string | undefined): boolean => {
  const p = String(panelId ?? "").trim().toLowerCase();
  return p === "tool:coding" || p.startsWith("agent:");
};

/** One cell as layouts-list serves it. */
export interface CellRow { panelId: string; col: number; row: number; colSpan: number; rowSpan: number; sticky?: boolean; config?: Record<string, unknown> }
/** One workspace as layouts-list serves it (what an edit needs to write it back whole). */
export interface WorkspaceRow {
  name: string; cols: number; rows: number; colWidths: number[]; rowHeights: number[];
  target?: "glyphh" | "desktop"; loop?: string | null; view?: "glyphh" | "cli" | null; gateway?: "on" | "off" | null;
  modelSelections?: Record<string, string>; sessionMode?: "keep" | "new" | "last"; type?: "work" | "code" | null;
  folder?: string | null; space?: "chat" | "cowork" | "code" | null; splits: CellRow[];
}

/** What the edit modal changes. `cells` is keyed by the cell's index in `splits`. */
export interface WorkspaceEdit {
  model: string;
  session: "keep" | "new" | "last";
  folder: string;
  agent: AgentStart;
  cells: Record<number, AgentStart>;
}

/**
 * The `layouts-save-grid` payload for an edited workspace: the arrangement
 * exactly as it was, every field the modal does not show carried through,
 * the modal's answers written over the rest. An agent cell the modal names
 * gets its answers; every other cell keeps its config untouched.
 */
export function editedWorkspaceGrid(row: WorkspaceRow, e: WorkspaceEdit): Record<string, unknown> {
  const models = { ...(row.modelSelections ?? {}) };
  if (e.model) models.default = e.model;
  else delete models.default;
  return {
    name: row.name, cols: row.cols, rows: row.rows, colWidths: row.colWidths, rowHeights: row.rowHeights,
    cells: row.splits.map((c, i) => {
      const cfg = e.cells[i] && isAgentCell(c.panelId) ? withAgentStart(c.config, e.cells[i]!) : c.config;
      return {
        panelId: c.panelId, col: c.col, row: c.row, colSpan: c.colSpan, rowSpan: c.rowSpan,
        ...(c.sticky ? { sticky: true } : {}),
        ...(cfg && Object.keys(cfg).length ? { config: cfg } : {}),
      };
    }),
    ...(row.target ? { target: row.target } : {}),
    ...(row.type ? { type: row.type } : {}),
    ...(row.space ? { space: row.space } : {}),
    sessionMode: e.session,
    folder: e.folder.trim() || null,
    loop: e.agent.loop || null,
    view: e.agent.view || null,
    gateway: e.agent.gateway || null,
    ...(Object.keys(models).length ? { modelSelections: models } : {}),
  };
}
