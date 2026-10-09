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

export type MapGroupKind = "connections" | "folders" | "skills" | "models";

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
  connections: "left", folders: "left", skills: "right", models: "right",
});
const ORDER: ReadonlyArray<MapGroupKind> = ["connections", "folders", "skills", "models"];

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

export interface PlacedNode { id: string; kind: MapGroupKind | "flow"; x: number; y: number; w: number; h: number; node: MapNode | null; flow?: { name: string; sub: string; icon: string } }
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
        nodes.push({ id, kind: group.kind, x, y: ny, w: NODE_W, h: NODE_H, node: n });
        edges.push({ from: "center", to: id, kind: group.kind });
        let prev = id;
        (n.flow ?? []).forEach((f, j) => {
          const fid = `${id}:flow:${j}`;
          nodes.push({ id: fid, kind: "flow", x: x + NODE_W + FLOW_GAP + j * (FLOW_W + FLOW_GAP), y: ny + (NODE_H - FLOW_H) / 2, w: FLOW_W, h: FLOW_H, node: null, flow: f });
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

export interface PowerMapHandle { update: (model: PowerMapModel) => void; destroy: () => void }

export function mountPowerMap(host: HTMLElement, opts: { onOpen?: (kind: MapGroupKind, stored: string) => void; onAdd?: () => void } = {}): PowerMapHandle {
  const root = document.createElement("div");
  root.className = "pmap";
  root.innerHTML = `
    <div class="pmap-viewport"><div class="pmap-stage"><svg class="pmap-edges" aria-hidden="true"></svg><div class="pmap-nodes"></div></div></div>
    <div class="pmap-controls" role="toolbar" aria-label="Map">
      <button type="button" class="pmap-ctl" data-z="in" title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" class="pmap-ctl" data-z="out" title="Zoom out" aria-label="Zoom out">−</button>
      <button type="button" class="pmap-ctl" data-z="fit" title="Fit" aria-label="Fit the map"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
    </div>
    <div class="pmap-hint">Drag to pan · ⌘ scroll to zoom</div>`;
  host.appendChild(root);
  const viewport = root.querySelector<HTMLElement>(".pmap-viewport")!;
  const stage = root.querySelector<HTMLElement>(".pmap-stage")!;
  const svg = root.querySelector<SVGSVGElement>(".pmap-edges")!;
  const layer = root.querySelector<HTMLElement>(".pmap-nodes")!;
  let view = { x: 0, y: 0, k: 1 };
  let layout: PowerMapLayout | null = null;
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
    else zoomAt(z === "in" ? 1.2 : 1 / 1.2, viewport.clientWidth / 2, viewport.clientHeight / 2);
  }));
  viewport.addEventListener("wheel", (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  // PAN: drag anywhere that isn't a node.
  let drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;
  viewport.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".pmap-node, .pmap-center")) return;
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

  function paint(model: PowerMapModel): void {
    layout = layoutPowerMap(model);
    const L = layout;
    stage.style.width = `${L.width}px`;
    stage.style.height = `${L.height}px`;
    svg.setAttribute("width", String(L.width));
    svg.setAttribute("height", String(L.height));
    svg.setAttribute("viewBox", `0 0 ${L.width} ${L.height}`);
    const at = new Map(L.nodes.map((n) => [n.id, n]));
    svg.innerHTML = L.edges.map((e) => {
      const to = at.get(e.to)!;
      let d: string;
      if (e.from === "center") {
        const leftSide = to.x < L.center.x;
        const x1 = L.center.x + (leftSide ? -L.center.r : L.center.r);
        const x2 = leftSide ? to.x + to.w : to.x;
        d = edgePath(x1, L.center.y, x2, to.y + to.h / 2);
      } else {
        const from = at.get(e.from)!;
        d = edgePath(from.x + from.w, from.y + from.h / 2, to.x, to.y + to.h / 2);
      }
      return `<path class="pmap-edge pmap-edge-${e.kind}" d="${d}"/>`;
    }).join("");
    layer.textContent = "";
    for (const lb of L.labels) {
      const t = document.createElement("div");
      t.className = `pmap-label pmap-k-${lb.kind}`;
      t.style.left = `${lb.x}px`;
      t.style.top = `${lb.y}px`;
      t.innerHTML = `<span class="pmap-label-dot"></span>${esc(lb.label)}<span class="pmap-label-count">${lb.count}</span>`;
      layer.appendChild(t);
    }
    const center = document.createElement("button");
    center.type = "button";
    center.className = "pmap-center";
    center.style.left = `${L.center.x - L.center.r}px`;
    center.style.top = `${L.center.y - L.center.r}px`;
    center.style.width = center.style.height = `${L.center.r * 2}px`;
    center.title = opts.onAdd ? "Add a power" : model.center.name;
    center.innerHTML = `<span class="pmap-center-face">${model.center.face}</span><span class="pmap-center-name">${esc(model.center.name)}</span>`;
    if (opts.onAdd) center.addEventListener("click", () => opts.onAdd!());
    layer.appendChild(center);
    for (const n of L.nodes) {
      const card = document.createElement(n.node ? "button" : "div");
      card.className = `pmap-node pmap-k-${n.kind}${n.node?.muted ? " muted" : ""}`;
      card.style.left = `${n.x}px`;
      card.style.top = `${n.y}px`;
      card.style.width = `${n.w}px`;
      card.style.height = `${n.h}px`;
      const it = n.node ?? n.flow!;
      card.innerHTML = `<span class="pmap-handle pmap-handle-in"></span><span class="pmap-node-icon">${it.icon}</span><span class="pmap-node-text"><span class="pmap-node-name">${esc(it.name)}</span>${it.sub ? `<span class="pmap-node-sub">${esc(it.sub)}</span>` : ""}</span><span class="pmap-handle pmap-handle-out"></span>`;
      if (n.node && opts.onOpen) {
        const kind = n.kind as MapGroupKind;
        const stored = n.node.stored;
        (card as HTMLButtonElement).type = "button";
        card.title = `Open ${n.node.name}`;
        card.addEventListener("click", () => opts.onOpen!(kind, stored));
      }
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
    update: paint,
    destroy: () => { ro.disconnect(); root.remove(); },
  };
}
