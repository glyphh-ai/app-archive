/**
 * team-board.ts — THE WORK BOARD's rules (phase 2 of swarm mode, his order
 * 2026-10-09: "Tasks get delegated, threads traverse as each agent works.
 * There can be delegation even between them… The task and work management
 * needs to be fucking stellar").
 *
 * A team thread carries one board: its tasks (each with an owner, a status,
 * what it waits on, its parent when it is a sub-task, and a timeline of
 * notes) and the board's log, newest last. Glyphh plans with board_add,
 * hands tasks out with hand_off, reviews with board_update; a member at work
 * splits its own task into sub-tasks. Pure: the panel applies these to the
 * thread it owns (help/code.ts), the tests pin them.
 */

export type TaskStatus = "queued" | "working" | "review" | "blocked" | "done";
export const TASK_STATUSES: ReadonlyArray<TaskStatus> = ["queued", "working", "review", "blocked", "done"];
export const STATUS_LABEL: Readonly<Record<TaskStatus, string>> = {
  queued: "Queued", working: "Working", review: "Needs review", blocked: "Blocked", done: "Done",
};

export interface TaskNote { at: number; by: string; text: string }
export interface TeamTask {
  id: string;
  title: string;
  detail: string;
  /** A member's slug, "glyphh", or null (not decided yet). */
  owner: string | null;
  status: TaskStatus;
  /** The task this one was split from, or null. */
  parent: string | null;
  /** Task ids that must be done first. */
  waitsOn: string[];
  notes: TaskNote[];
  createdAt: number;
  updatedAt: number;
}
export interface BoardEvent { at: number; by: string; task: string; text: string }
export interface Board { tasks: TeamTask[]; log: BoardEvent[] }

export const emptyBoard = (): Board => ({ tasks: [], log: [] });

const clean = (v: unknown, max: number): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** A task by its id ("t3" or "#t3"), else by its title (case aside). */
export function findTask(board: Board, ref: unknown): TeamTask | undefined {
  const r = clean(ref, 200).replace(/^#/, "");
  if (!r) return undefined;
  return board.tasks.find((t) => t.id === r) ?? board.tasks.find((t) => t.title.toLowerCase() === r.toLowerCase());
}

/** The next free id: t1, t2, … */
function nextId(board: Board): string {
  let n = board.tasks.length + 1;
  while (board.tasks.some((t) => t.id === `t${n}`)) n++;
  return `t${n}`;
}

function log(board: Board, by: string, task: TeamTask, text: string, at: number): void {
  board.log.push({ at, by, task: task.id, text });
  if (board.log.length > 500) board.log.splice(0, board.log.length - 500);
}

export interface NewTask { title?: unknown; detail?: unknown; owner?: unknown; waits_on?: unknown }

/** PUT TASKS ON THE BOARD. `parent` makes them sub-tasks (a member splitting
 *  its own task). waits_on names tasks by id or title — earlier in this same
 *  batch included. An owner must be on `owners` (the team, or "glyphh"). */
export function addTasks(board: Board, input: readonly NewTask[], by: string, parent: string | null, owners: ReadonlySet<string>, now: number): TeamTask[] {
  if (!input.length) throw new Error("no tasks to add");
  if (parent && !findTask(board, parent)) throw new Error(`no task "${parent}" to add sub-tasks to`);
  const parentId = parent ? findTask(board, parent)!.id : null;
  const added: TeamTask[] = [];
  for (const raw of input) {
    const title = clean(raw.title, 140);
    if (!title) throw new Error("every task needs a title");
    const owner = clean(raw.owner, 80) || null;
    if (owner && !owners.has(owner)) throw new Error(`"${owner}" isn't on this team — owners are ${[...owners].join(", ")}`);
    const t: TeamTask = {
      id: nextId(board), title, detail: clean(raw.detail, 2000), owner, status: "queued",
      parent: parentId, waitsOn: [], notes: [], createdAt: now, updatedAt: now,
    };
    board.tasks.push(t);
    added.push(t);
  }
  // Waits are resolved once every new task exists, so a batch can point at itself.
  input.forEach((raw, i) => {
    const refs = Array.isArray(raw.waits_on) ? raw.waits_on : [];
    const t = added[i]!;
    for (const ref of refs) {
      const w = findTask(board, ref);
      if (!w) throw new Error(`"${t.title}" waits on "${String(ref)}", which isn't on the board`);
      if (w.id !== t.id && !t.waitsOn.includes(w.id)) t.waitsOn.push(w.id);
    }
  });
  for (const t of added) log(board, by, t, parentId ? `added sub-task of ${parentId}` : "added", now);
  return added;
}

export interface TaskPatch { status?: unknown; owner?: unknown; note?: unknown }

/** CHANGE ONE TASK: its status, its owner, a note. Each change lands on the
 *  task's timeline and the board's log. A task can't be done while something
 *  it waits on isn't. */
export function updateTask(board: Board, ref: unknown, patch: TaskPatch, by: string, owners: ReadonlySet<string>, now: number): TeamTask {
  const t = findTask(board, ref);
  if (!t) throw new Error(`no task "${String(ref ?? "")}" on the board — board_list names them`);
  const status = clean(patch.status, 20) as TaskStatus;
  if (patch.status !== undefined && !TASK_STATUSES.includes(status)) throw new Error(`status is one of ${TASK_STATUSES.join(", ")}`);
  if (status === "done") {
    const open = t.waitsOn.map((w) => findTask(board, w)).filter((w) => w && w.status !== "done") as TeamTask[];
    if (open.length) throw new Error(`"${t.title}" waits on ${open.map((w) => `${w.id} "${w.title}"`).join(", ")}, not done yet`);
  }
  const owner = patch.owner === undefined ? undefined : clean(patch.owner, 80) || null;
  if (owner && !owners.has(owner)) throw new Error(`"${owner}" isn't on this team`);
  const note = clean(patch.note, 2000);
  if (patch.status !== undefined && status !== t.status) { log(board, by, t, `${STATUS_LABEL[t.status]} → ${STATUS_LABEL[status]}`, now); t.status = status; }
  if (owner !== undefined && owner !== t.owner) { log(board, by, t, owner ? `owner → ${owner}` : "owner cleared", now); t.owner = owner; }
  if (note) { t.notes.push({ at: now, by, text: note }); log(board, by, t, `note: ${note}`, now); }
  t.updatedAt = now;
  return t;
}

/** Tasks per status. */
export function boardCounts(board: Board): Record<TaskStatus, number> {
  const out = { queued: 0, working: 0, review: 0, blocked: 0, done: 0 } as Record<TaskStatus, number>;
  for (const t of board.tasks) out[t.status]++;
  return out;
}

/** What can start now: queued, with everything it waits on done. */
export function readyTasks(board: Board): TeamTask[] {
  return board.tasks.filter((t) => t.status === "queued" && t.waitsOn.every((w) => findTask(board, w)?.status === "done"));
}

/** THE BOARD AS THE MODEL READS IT: one line a task, sub-tasks under their parent. */
export function boardText(board: Board, nameOf: (slug: string) => string): string {
  if (!board.tasks.length) return "The board is empty. Plan the job with board_add.";
  const c = boardCounts(board);
  const lines: string[] = [`Board: ${TASK_STATUSES.map((s) => `${c[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(", ")}.`];
  const line = (t: TeamTask, depth: number): void => {
    const owner = t.owner ? nameOf(t.owner) : "unassigned";
    const waits = t.waitsOn.length ? ` · waits on ${t.waitsOn.join(", ")}` : "";
    const last = t.notes.length ? ` · last note: ${t.notes[t.notes.length - 1]!.text.slice(0, 160)}` : "";
    lines.push(`${"  ".repeat(depth)}- ${t.id} [${STATUS_LABEL[t.status]}] ${t.title} — ${owner}${waits}${last}`);
    for (const s of board.tasks.filter((x) => x.parent === t.id)) line(s, depth + 1);
  };
  for (const t of board.tasks.filter((x) => !x.parent)) line(t, 0);
  const ready = readyTasks(board);
  if (ready.length) lines.push(`Ready to start: ${ready.map((t) => t.id).join(", ")}.`);
  return lines.join("\n");
}
