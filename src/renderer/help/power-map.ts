/**
 * power-map.ts — A SUPER POWER, AS A MAP (his order, 2026-10-09: "the top
 * portion of the page needs a new sick sick react flow esc view of a super
 * power. Connectors with images, powers -> powers with task flows if any,
 * models with logos, folders with an icon, connections etc... the super power
 * icon in the center with a white or theme aligned border circle").
 *
 * React Flow's grammar, hand-drawn (the renderer has no React): a dotted
 * canvas you can pan and zoom, the super power in a ringed circle at the
 * centre, its connections and folders on the left, its powers and models on
 * the right, curved animated edges from the centre to every node, and a power
 * that runs on its own trailing its flow — its schedule, then each slot it
 * hands work to. `layoutPowerMap` is pure (the tests pin it); `mountPowerMap`
 * paints it and repaints on `update`.
 */

export type MapGroupKind = "connections" | "folders" | "superPowers" | "skills" | "models";

export interface MapNode {
  /** The value the page stores (a slug, a path, a power id, a model name). */
  stored: string;
  name: string;
  sub: string;
  /** Trusted markup: an <img> logo or an inline SVG. */
  icon: string;
  /** A power that runs on its own: its flow, left to right. */
  flow?: Array<{ name: string; sub: string; icon: string }>;
  /** Dimmed: a connection not connected yet. */
  muted?: boolean;
}
export interface MapGroup { kind: MapGroupKind; label: string; nodes: MapNode[] }
export interface PowerMapModel {
  center: { name: string; face: string };
  groups: MapGroup[];
}

/** Where each group sits. */
export const MAP_SIDES: Readonly<Record<MapGroupKind, "left" | "right">> = Object.freeze({
  connections: "left", folders: "left", superPowers: "left", skills: "right", models: "right",
});
const ORDER: ReadonlyArray<MapGroupKind> = ["connections", "folders", "superPowers", "skills", "models"];

export const NODE_W = 196;
export const NODE_H = 46;
export const FLOW_W = 150;
export const FLOW_H = 38;
const GAP_Y = 10;
const GROUP_GAP = 26;
const LABEL_H = 22;
const CENTER_R = 54;
const COL_GAP = 120;
const FLOW_GAP = 34;
const PAD = 28;

export interface PlacedNode {
  id: string;
  /** Stable across edits: what it stands for, not where it sits in a list — the saved layout's key. */
  key: string;
  kind: MapGroupKind | "flow"; x: number; y: number; w: number; h: number; node: MapNode | null;
  flow?: { name: string; sub: string; icon: string };
  /** A flow step's power: a click on the step opens it. */
  parent?: { kind: MapGroupKind; stored: string };
}
/** The centre's key in a saved layout. */
export const CENTER_KEY = "center";
export interface PlacedLabel { kind: MapGroupKind; label: string; x: number; y: number; count: number }
export interface PlacedEdge { from: string; to: string; kind: MapGroupKind | "flow" }
export interface PowerMapLayout {
  width: number; height: number;
  center: { x: number; y: number; r: number };
  nodes: PlacedNode[]; labels: PlacedLabel[]; edges: PlacedEdge[];
}

/** One side's column: groups stacked, each under its label; empty groups skipped. */
function stack(groups: MapGroup[]): { height: number; rows: Array<{ group: MapGroup; y: number }> } {
  let y = 0;
  const rows: Array<{ group: MapGroup; y: number }> = [];
  for (const g of groups) {
    if (!g.nodes.length) continue;
    if (rows.length) y += GROUP_GAP;
    rows.push({ group: g, y });
    y += LABEL_H + g.nodes.length * NODE_H + (g.nodes.length - 1) * GAP_Y;
  }
  return { height: y, rows };
}

/** THE LAYOUT, pure: canvas coordinates for every node, label and edge. */
export function layoutPowerMap(model: PowerMapModel): PowerMapLayout {
  const byKind = new Map(model.groups.map((g) => [g.kind, g]));
  const side = (s: "left" | "right"): MapGroup[] => ORDER.filter((k) => MAP_SIDES[k] === s).map((k) => byKind.get(k)).filter((g): g is MapGroup => !!g);
  const left = stack(side("left"));
  const right = stack(side("right"));
  const maxFlow = Math.max(0, ...side("right").flatMap((g) => g.nodes.map((n) => n.flow?.length ?? 0)));
  const height = Math.max(left.height, right.height, CENTER_R * 2 + 40) + PAD * 2;
  const leftX = PAD;
  const cx = leftX + (left.rows.length ? NODE_W + COL_GAP : 0) + CENTER_R;
  const rightX = cx + CENTER_R + COL_GAP;
  const width = rightX + (right.rows.length ? NODE_W : 0) + maxFlow * (FLOW_W + FLOW_GAP) + PAD;
  const cy = height / 2;
  const nodes: PlacedNode[] = [];
  const labels: PlacedLabel[] = [];
  const edges: PlacedEdge[] = [];
  const place = (col: { height: number; rows: Array<{ group: MapGroup; y: number }> }, x: number): void => {
    const top = cy - col.height / 2;
    for (const { group, y } of col.rows) {
      labels.push({ kind: group.kind, label: group.label, x, y: top + y, count: group.nodes.length });
      group.nodes.forEach((n, i) => {
        const ny = top + y + LABEL_H + i * (NODE_H + GAP_Y);
        const id = `${group.kind}:${i}`;
        const key = `${group.kind}:${n.stored}`;
        nodes.push({ id, key, kind: group.kind, x, y: ny, w: NODE_W, h: NODE_H, node: n });
        edges.push({ from: "center", to: id, kind: group.kind });
        let prev = id;
        (n.flow ?? []).forEach((f, j) => {
          const fid = `${id}:flow:${j}`;
          nodes.push({ id: fid, key: `${key}:flow:${j}`, kind: "flow", x: x + NODE_W + FLOW_GAP + j * (FLOW_W + FLOW_GAP), y: ny + (NODE_H - FLOW_H) / 2, w: FLOW_W, h: FLOW_H, node: null, flow: f, parent: { kind: group.kind, stored: n.stored } });
          edges.push({ from: prev, to: fid, kind: "flow" });
          prev = fid;
        });
      });
    }
  };
  place(left, leftX);
  place(right, rightX);
  return { width, height, center: { x: cx, y: cy, r: CENTER_R }, nodes, labels, edges };
}

/** THE MEMBER'S OWN ARRANGEMENT (his order, 2026-10-09: "drag things around
 *  and have it save"): saved positions override the automatic layout, card by
 *  card; the canvas grows to hold whatever was dragged out. Pure. */
export function applyLayout(L: PowerMapLayout, saved: Readonly<Record<string, { x: number; y: number }>> | null | undefined): PowerMapLayout {
  if (!saved || !Object.keys(saved).length) return L;
  const center = saved[CENTER_KEY] ? { ...L.center, x: saved[CENTER_KEY]!.x, y: saved[CENTER_KEY]!.y } : L.center;
  const nodes = L.nodes.map((n) => (saved[n.key] ? { ...n, x: saved[n.key]!.x, y: saved[n.key]!.y } : n));
  const labels = L.labels;
  const width = Math.max(L.width, center.x + center.r + PAD, ...nodes.map((n) => n.x + n.w + PAD));
  const height = Math.max(L.height, center.y + center.r + 40 + PAD, ...nodes.map((n) => n.y + n.h + PAD));
  return { ...L, width, height, center, nodes, labels };
}

/** An edge's path: a smooth horizontal S from one handle to the other. */
export function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  const s = x2 >= x1 ? 1 : -1;
  return `M${x1},${y1} C${x1 + dx * s},${y1} ${x2 - dx * s},${y2} ${x2},${y2}`;
}

// ── THE PAINTER ─────────────────────────────────────────────────────────────

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.8;

const EXPAND_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`;
const SHRINK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>`;

export interface PowerMapHandle { update: (model: PowerMapModel, layout?: Record<string, { x: number; y: number }> | null) => void; destroy: () => void }

export function mountPowerMap(host: HTMLElement, opts: {
  onOpen?: (kind: MapGroupKind, stored: string) => void;
  onAdd?: () => void;
  /** The member moved a card, or reset: the whole saved layout ({} = automatic). */
  onLayout?: (layout: Record<string, { x: number; y: number }>) => void;
} = {}): PowerMapHandle {
  const root = document.createElement("div");
  root.className = "pmap";
  root.innerHTML = `
    <div class="pmap-viewport"><div class="pmap-stage"><svg class="pmap-edges" aria-hidden="true"></svg><div class="pmap-nodes"></div></div></div>
    <div class="pmap-controls" role="toolbar" aria-label="Map">
      <button type="button" class="pmap-ctl" data-z="in" title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" class="pmap-ctl" data-z="out" title="Zoom out" aria-label="Zoom out">−</button>
      <button type="button" class="pmap-ctl" data-z="fit" title="Fit" aria-label="Fit the map"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
      <button type="button" class="pmap-ctl" data-z="reset" title="Reset the layout" aria-label="Reset the layout"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg></button>
    </div>
    <button type="button" class="pmap-full-btn" title="Full screen" aria-label="Full screen" aria-pressed="false">${EXPAND_SVG}</button>
    <div class="pmap-hint">Drag a card to move it · drag the canvas to pan · ⌘ scroll to zoom</div>`;
  host.appendChild(root);
  const viewport = root.querySelector<HTMLElement>(".pmap-viewport")!;
  const stage = root.querySelector<HTMLElement>(".pmap-stage")!;
  const svg = root.querySelector<SVGSVGElement>(".pmap-edges")!;
  const layer = root.querySelector<HTMLElement>(".pmap-nodes")!;
  let view = { x: 0, y: 0, k: 1 };
  let layout: PowerMapLayout | null = null;
  let model: PowerMapModel | null = null;
  /** The saved arrangement, card key → position. */
  let saved: Record<string, { x: number; y: number }> = {};
  let fitted = false;
  /** The member panned or zoomed: a resize no longer refits over their view. */
  let userMoved = false;

  const apply = (): void => {
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    root.style.setProperty("--pmap-grid", `${18 * view.k}px`);
    root.style.backgroundPosition = `${view.x}px ${view.y}px`;
  };
  const fit = (): void => {
    if (!layout) return;
    const w = viewport.clientWidth || 800;
    const h = viewport.clientHeight || 320;
    const k = Math.max(ZOOM_MIN, Math.min(1.1, (w - 24) / layout.width, (h - 24) / layout.height));
    view = { k, x: (w - layout.width * k) / 2, y: (h - layout.height * k) / 2 };
    apply();
  };
  const zoomAt = (factor: number, px: number, py: number): void => {
    userMoved = true;
    const k = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.k * factor));
    view = { k, x: px - ((px - view.x) / view.k) * k, y: py - ((py - view.y) / view.k) * k };
    apply();
  };
  root.querySelectorAll<HTMLButtonElement>(".pmap-ctl").forEach((b) => b.addEventListener("click", () => {
    const z = b.dataset.z;
    if (z === "fit") { userMoved = false; fit(); }
    else if (z === "reset") {
      // RESET (his order, 2026-10-09): back to the automatic layout, saved as such.
      saved = {};
      opts.onLayout?.({});
      userMoved = false;
      if (model) paint(model);
      requestAnimationFrame(fit);
    }
    else zoomAt(z === "in" ? 1.2 : 1 / 1.2, viewport.clientWidth / 2, viewport.clientHeight / 2);
  }));
  // FULL SCREEN (his order, 2026-10-09: "make the canvas expandable full
  // screen"): the map lifts over the page; Esc or the button brings it back.
  const fullBtn = root.querySelector<HTMLButtonElement>(".pmap-full-btn")!;
  const setFull = (on: boolean): void => {
    root.classList.toggle("pmap-full", on);
    fullBtn.innerHTML = on ? SHRINK_SVG : EXPAND_SVG;
    fullBtn.title = on ? "Exit full screen" : "Full screen";
    fullBtn.setAttribute("aria-label", fullBtn.title);
    fullBtn.setAttribute("aria-pressed", String(on));
    userMoved = false;
    requestAnimationFrame(fit);
  };
  fullBtn.addEventListener("click", () => setFull(!root.classList.contains("pmap-full")));
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && root.classList.contains("pmap-full")) { e.preventDefault(); e.stopPropagation(); setFull(false); }
  };
  document.addEventListener("keydown", onKey, true);
  viewport.addEventListener("wheel", (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  // PAN: drag anywhere that isn't a node.
  let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
  viewport.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".pmap-node, .pmap-center, .pmap-ctl, .pmap-full-btn")) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add("grabbing");
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) { drag.moved = true; userMoved = true; }
    view = { ...view, x: drag.vx + dx, y: drag.vy + dy };
    apply();
  });
  const endDrag = (): void => { drag = null; viewport.classList.remove("grabbing"); };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);
  const ro = new ResizeObserver(() => { if (!userMoved) fit(); });
  ro.observe(viewport);

  /** The edges, drawn from wherever the cards are now. */
  function drawEdges(L: PowerMapLayout): void {
    const at = new Map(L.nodes.map((n) => [n.id, n]));
    svg.innerHTML = L.edges.map((e) => {
      const to = at.get(e.to)!;
      let d: string;
      if (e.from === "center") {
        const leftSide = to.x + to.w / 2 < L.center.x;
        const x1 = L.center.x + (leftSide ? -L.center.r : L.center.r);
        const x2 = leftSide ? to.x + to.w : to.x;
        d = edgePath(x1, L.center.y, x2, to.y + to.h / 2);
      } else {
        const from = at.get(e.from)!;
        d = edgePath(from.x + from.w, from.y + from.h / 2, to.x, to.y + to.h / 2);
      }
      return `<path class="pmap-edge pmap-edge-${e.kind}" d="${d}"/>`;
    }).join("");
  }
  /** A card (or the centre) follows the pointer; a drag saves, a click opens. */
  function makeDraggable(el: HTMLElement, key: string, place: (x: number, y: number) => void, read: () => { x: number; y: number }, onClick: (() => void) | null): void {
    let start: { px: number; py: number; x: number; y: number } | null = null;
    let moved = false;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const at = read();
      start = { px: e.clientX, py: e.clientY, x: at.x, y: at.y };
      moved = false;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = (e.clientX - start.px) / view.k;
      const dy = (e.clientY - start.py) / view.k;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      el.classList.add("dragging");
      place(Math.round(start.x + dx), Math.round(start.y + dy));
      if (layout) drawEdges(layout);
    });
    const end = (): void => {
      if (!start) return;
      start = null;
      el.classList.remove("dragging");
      if (moved) {
        saved = { ...saved, [key]: read() };
        opts.onLayout?.(saved);
      } else onClick?.();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", () => { start = null; el.classList.remove("dragging"); });
  }

  function paint(next: PowerMapModel): void {
    model = next;
    layout = applyLayout(layoutPowerMap(next), saved);
    const L = layout;
    stage.style.width = `${L.width}px`;
    stage.style.height = `${L.height}px`;
    svg.setAttribute("width", String(L.width));
    svg.setAttribute("height", String(L.height));
    svg.setAttribute("viewBox", `0 0 ${L.width} ${L.height}`);
    drawEdges(L);
    layer.textContent = "";
    for (const lb of L.labels) {
      const t = document.createElement("div");
      t.className = `pmap-label pmap-k-${lb.kind}`;
      t.style.left = `${lb.x}px`;
      t.style.top = `${lb.y}px`;
      t.innerHTML = `<span class="pmap-label-dot"></span>${esc(lb.label)}<span class="pmap-label-count">${lb.count}</span>`;
      layer.appendChild(t);
    }
    const center = document.createElement("div");
    center.className = "pmap-center";
    center.setAttribute("role", "button");
    center.tabIndex = 0;
    const placeCenter = (): void => {
      center.style.left = `${L.center.x - L.center.r}px`;
      center.style.top = `${L.center.y - L.center.r}px`;
    };
    placeCenter();
    center.style.width = center.style.height = `${L.center.r * 2}px`;
    center.title = opts.onAdd ? "Add a power · drag to move" : next.center.name;
    center.innerHTML = `<span class="pmap-center-face">${next.center.face}</span><span class="pmap-center-name">${esc(next.center.name)}</span>`;
    makeDraggable(center, CENTER_KEY,
      (x, y) => { L.center = { ...L.center, x, y }; placeCenter(); },
      () => ({ x: L.center.x, y: L.center.y }),
      opts.onAdd ? () => opts.onAdd!() : null);
    layer.appendChild(center);
    for (const n of L.nodes) {
      const card = document.createElement("div");
      card.className = `pmap-node pmap-k-${n.kind}${n.node?.muted ? " muted" : ""}`;
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      const place = (): void => { card.style.left = `${n.x}px`; card.style.top = `${n.y}px`; };
      place();
      card.style.width = `${n.w}px`;
      card.style.height = `${n.h}px`;
      const it = n.node ?? n.flow!;
      card.innerHTML = `<span class="pmap-handle pmap-handle-in"></span><span class="pmap-node-icon">${it.icon}</span><span class="pmap-node-text"><span class="pmap-node-name">${esc(it.name)}</span>${it.sub ? `<span class="pmap-node-sub">${esc(it.sub)}</span>` : ""}</span><span class="pmap-handle pmap-handle-out"></span>`;
      // A CLICK OPENS WHAT IT IS (his order, 2026-10-09): the card's own thing;
      // a flow step opens the power it belongs to.
      const target = n.node ? { kind: n.kind as MapGroupKind, stored: n.node.stored } : n.parent ?? null;
      const open = target && opts.onOpen ? () => opts.onOpen!(target.kind, target.stored) : null;
      card.title = `${n.node ? `Open ${n.node.name}` : n.flow ? `Open its power` : ""} · drag to move`;
      makeDraggable(card, n.key, (x, y) => { n.x = x; n.y = y; place(); }, () => ({ x: n.x, y: n.y }), open);
      card.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && open) { e.preventDefault(); open(); } });
      layer.appendChild(card);
    }
    if (!L.nodes.length) {
      const empty = document.createElement("div");
      empty.className = "pmap-empty";
      empty.style.left = `${L.center.x + L.center.r + 24}px`;
      empty.style.top = `${L.center.y - 12}px`;
      empty.textContent = "No powers yet: click the circle to add one.";
      layer.appendChild(empty);
    }
    if (!fitted) { fitted = true; requestAnimationFrame(fit); }
  }

  return {
    update: (next: PowerMapModel, layoutSaved?: Record<string, { x: number; y: number }> | null) => {
      if (layoutSaved !== undefined) saved = { ...(layoutSaved ?? {}) };
      paint(next);
    },
    destroy: () => { ro.disconnect(); document.removeEventListener("keydown", onKey, true); root.remove(); },
  };
}
