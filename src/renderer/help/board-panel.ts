/**
 * board-panel.ts — THE WORK BOARD, on screen (phase 2 of swarm mode, his order
 * 2026-10-09: "The task and work management needs to be fucking stellar").
 *
 * The powers modal's frame, wider. Two tabs:
 *   Board     five columns (Queued, Working, Needs review, Blocked, Done); a
 *             card is the owner's face, the title, what it waits on, its
 *             sub-tasks and notes. A click opens the task: its status (move
 *             it), its owner (open their thread, live), its detail, what it
 *             waits on, its sub-tasks, its notes, and a note of your own.
 *   Timeline  the board's log, newest first: who did what to which task.
 * It repaints live as the team works (refreshBoard, from help/code.ts).
 * The rules are help/team-board.ts.
 */

import { escapeHtml, guardWebviewsForModal } from "./shared.js";
import { STATUS_LABEL, TASK_STATUSES, findTask, boardCounts, type Board, type TaskStatus, type TeamTask } from "./team-board.js";

export interface BoardPanelOptions {
  title: string;
  board: () => Board;
  nameOf: (slug: string) => string;
  /** Trusted markup: the owner's face. */
  faceOf: (slug: string) => string;
  openThread: (slug: string) => void;
  /** The member changed a task by hand (status, note): the panel saves and repaints. */
  update: (taskId: string, patch: { status?: TaskStatus; note?: string }) => string | null;
}

const S = 'viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
const CLOSE_SVG = `<svg ${S} stroke-width="2.4"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
const BACK_SVG = `<svg ${S} stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const when = (at: number): string => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

let openOne: { repaint: () => void; close: () => void } | null = null;
/** Repaint the open board, if any (the team just changed it). */
export function refreshBoard(): void { openOne?.repaint(); }

export function openBoardPanel(o: BoardPanelOptions): void {
  openOne?.close();
  let tab: "board" | "timeline" = "board";
  let detail: string | null = null;
  let closed = false;
  const overlay = el("div", "confirm-overlay powm board");
  overlay.innerHTML = `
    <div class="confirm-box powm-box board-box" role="dialog" aria-modal="true">
      <div class="confirm-head powm-head"><h3></h3>
        <button class="ws-icon-btn powm-x" type="button" title="Close" aria-label="Close">${CLOSE_SVG}</button></div>
      <div class="skills-tabs powm-tabs" role="tablist"></div>
      <div class="confirm-body powm-body board-body"></div>
    </div>`;
  const q = <T extends HTMLElement>(s: string): T => overlay.querySelector<T>(s)!;
  q<HTMLElement>(".powm-head h3").textContent = o.title;
  const tabs = q<HTMLElement>(".powm-tabs");
  const body = q<HTMLElement>(".board-body");
  for (const [key, label] of [["board", "Board"], ["timeline", "Timeline"]] as const) {
    const b = el("button", "skills-tab", label);
    b.type = "button"; b.dataset.tab = key;
    b.addEventListener("click", () => { tab = key; detail = null; paint(); });
    tabs.appendChild(b);
  }
  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    guardWebviewsForModal(false);
    document.removeEventListener("keydown", onKey, true);
    if (openOne?.close === close) openOne = null;
  };
  function onKey(e: KeyboardEvent): void { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (detail) { detail = null; paint(); } else close(); } }
  q(".powm-x").addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });

  const ownerChip = (slug: string | null): HTMLElement => {
    const c = el("span", "board-owner");
    if (!slug) { c.textContent = "Unassigned"; c.classList.add("none"); return c; }
    c.innerHTML = `<span class="board-owner-face">${o.faceOf(slug)}</span><span>${escapeHtml(o.nameOf(slug))}</span>`;
    return c;
  };

  function card(t: TeamTask, b: Board): HTMLElement {
    const c = el("button", `board-card st-${t.status}`);
    c.type = "button";
    const top = el("div", "board-card-top");
    top.appendChild(ownerChip(t.owner));
    top.appendChild(el("span", "board-card-id", t.id));
    c.appendChild(top);
    c.appendChild(el("div", "board-card-title", t.title));
    const meta: string[] = [];
    if (t.parent) meta.push(`part of ${t.parent}`);
    const subs = b.tasks.filter((x) => x.parent === t.id);
    if (subs.length) meta.push(`${subs.filter((x) => x.status === "done").length}/${subs.length} sub-tasks`);
    const open = t.waitsOn.filter((w) => findTask(b, w)?.status !== "done");
    if (open.length) meta.push(`waits on ${open.join(", ")}`);
    if (t.notes.length) meta.push(`${t.notes.length} note${t.notes.length === 1 ? "" : "s"}`);
    if (meta.length) c.appendChild(el("div", "board-card-meta", meta.join(" · ")));
    c.addEventListener("click", () => { detail = t.id; paint(); });
    return c;
  }

  function paintBoard(b: Board): void {
    if (!b.tasks.length) { body.appendChild(el("div", "botp-empty", "No tasks yet. Glyphh plans the job here when the team starts work.")); return; }
    const cols = el("div", "board-cols");
    for (const s of TASK_STATUSES) {
      const col = el("div", `board-col st-${s}`);
      const list = b.tasks.filter((t) => t.status === s);
      const head = el("div", "board-col-head");
      head.innerHTML = `<span class="board-col-dot"></span><span>${STATUS_LABEL[s]}</span><span class="board-col-count">${list.length}</span>`;
      col.appendChild(head);
      for (const t of list) col.appendChild(card(t, b));
      cols.appendChild(col);
    }
    body.appendChild(cols);
  }

  function paintDetail(b: Board, t: TeamTask): void {
    const back = el("button", "skills-back powm-back");
    back.type = "button";
    back.innerHTML = `${BACK_SVG}<span>Board</span>`;
    back.addEventListener("click", () => { detail = null; paint(); });
    body.appendChild(back);
    const head = el("div", "board-detail-head");
    head.append(el("span", "board-card-id", t.id), el("div", "board-detail-title", t.title));
    body.appendChild(head);
    // Status: one click moves it (his board, his call).
    const moves = el("div", "board-status-row");
    for (const s of TASK_STATUSES) {
      const m = el("button", `board-status st-${s}${s === t.status ? " on" : ""}`, STATUS_LABEL[s]);
      m.type = "button";
      m.addEventListener("click", () => { if (s === t.status) return; const err = o.update(t.id, { status: s }); if (err) alertLine.textContent = err; });
      moves.appendChild(m);
    }
    body.appendChild(moves);
    const alertLine = el("div", "crud-form-error board-error");
    body.appendChild(alertLine);
    const who = el("div", "board-detail-owner");
    who.appendChild(ownerChip(t.owner));
    if (t.owner) {
      const open = el("button", "action-btn secondary", "Open thread");
      open.type = "button";
      const owner = t.owner;
      open.addEventListener("click", () => { close(); o.openThread(owner); });
      who.appendChild(open);
    }
    body.appendChild(who);
    if (t.detail) body.appendChild(el("p", "board-detail-text", t.detail));
    const section = (label: string): HTMLElement => { body.appendChild(el("div", "conn2-h3 board-sec", label)); const box = el("div", "board-sec-list"); body.appendChild(box); return box; };
    if (t.waitsOn.length) {
      const box = section("Waits on");
      for (const w of t.waitsOn) { const x = findTask(b, w); if (x) box.appendChild(card(x, b)); }
    }
    const subs = b.tasks.filter((x) => x.parent === t.id);
    if (subs.length) { const box = section("Sub-tasks"); for (const x of subs) box.appendChild(card(x, b)); }
    const notes = section("Notes");
    if (!t.notes.length) notes.appendChild(el("div", "powm-note", "No notes yet."));
    for (const n of t.notes) {
      const row = el("div", "board-note");
      row.innerHTML = `<span class="board-note-face">${n.by === "you" ? "" : o.faceOf(n.by)}</span><span class="board-note-main"><span class="board-note-by">${escapeHtml(n.by === "you" ? "You" : o.nameOf(n.by))} · ${when(n.at)}</span><span class="board-note-text"></span></span>`;
      row.querySelector(".board-note-text")!.textContent = n.text;
      notes.appendChild(row);
    }
    const add = el("div", "board-note-add");
    const field = el("input", "settings-input");
    field.type = "text"; field.placeholder = "Add a note for the team…"; field.maxLength = 2000;
    const go = el("button", "action-btn primary", "Add");
    go.type = "button";
    const send = (): void => { const v = field.value.trim(); if (!v) return; const err = o.update(t.id, { note: v }); if (err) alertLine.textContent = err; };
    go.addEventListener("click", send);
    field.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
    add.append(field, go);
    body.appendChild(add);
  }

  function paintTimeline(b: Board): void {
    if (!b.log.length) { body.appendChild(el("div", "botp-empty", "Nothing has happened on this board yet.")); return; }
    for (const e of [...b.log].reverse()) {
      const t = findTask(b, e.task);
      const row = el("div", "board-event");
      row.innerHTML = `<span class="board-note-face">${e.by === "you" ? "" : o.faceOf(e.by)}</span><span class="board-note-main"><span class="board-note-by">${escapeHtml(e.by === "you" ? "You" : o.nameOf(e.by))} · ${when(e.at)} · ${escapeHtml(e.task)}${t ? ` ${escapeHtml(t.title)}` : ""}</span><span class="board-note-text"></span></span>`;
      row.querySelector(".board-note-text")!.textContent = e.text;
      row.addEventListener("click", () => { if (t) { tab = "board"; detail = t.id; paint(); } });
      body.appendChild(row);
    }
  }

  function paint(): void {
    if (closed) return;
    const b = o.board();
    const c = boardCounts(b);
    tabs.querySelectorAll<HTMLElement>(".skills-tab").forEach((x) => {
      x.classList.toggle("active", x.dataset.tab === tab);
      if (x.dataset.tab === "board") x.textContent = `Board · ${b.tasks.length - c.done} open`;
    });
    body.textContent = "";
    const t = detail ? findTask(b, detail) : null;
    if (t) paintDetail(b, t);
    else if (tab === "board") paintBoard(b);
    else paintTimeline(b);
  }

  document.addEventListener("keydown", onKey, true);
  guardWebviewsForModal(true);
  document.body.appendChild(overlay);
  openOne = { repaint: paint, close };
  paint();
}
