/**
 * workspace-create.ts — THE WORKSPACE MODAL (his order, 2026-10-08:
 * "a + to the far right next to workspaces then open a modal with name, and
 * the desired agent state… model, session re: start new, continue aka what we had before, and
 * directory. and of course name. No layout or overrides or any of that. very
 * simple modal. same with the agent -> dropdown -> Create Workspace").
 *
 * Create: the arrangement is whatever is on screen — the workbench saves it
 * and makes it the open workspace in place (code-workbench.ts
 * __wbSaveWorkspace), so nothing reloads. Edit (a workspace tile's menu):
 * the same questions about a saved workspace, its arrangement untouched.
 *
 * Both also ask how the workspace's agent starts: on which loop, in which
 * face (the chat or the loop's terminal) and on which route for a CLI (its
 * own login, or the user's providers). Edit asks it per agent cell too, each
 * cell inheriting the workspace unless it says otherwise. The rules are pure
 * (workspace-form.ts); this module asks the questions. It runs in the SHELL
 * document; an agent panel asks the shell through main
 * (agent-panel-create-workspace).
 */

import { guardWebviewsForModal } from "./shared.js";
import { toastOk } from "./toast.js";
import {
  INHERIT, agentStartOf, editedWorkspaceGrid, isAgentCell, workspaceFormError,
  type AgentStart, type WorkspaceRow,
} from "./workspace-form.js";
import { LOOP_IDS, LOOP_NAMES, settle } from "./cli-loops.js";
import type { CliAgentRow } from "./cli-types.js";

type SessionChoice = "keep" | "new" | "last";
type SaveWorkspace = (o: { name: string; model?: string; session: SessionChoice; folder?: string; loop?: string | null; view?: "glyphh" | "cli" | null; gateway?: "on" | "off" | null }) => Promise<{ ok: boolean; error?: string }>;
interface Api {
  loopModels?: (loopId: string, force?: boolean) => Promise<{ ok: boolean; models: Array<{ id: string; name: string; utility?: boolean }> }>;
  layoutsPickFolder?: () => Promise<string | null>;
  layoutsList?: () => Promise<Array<{ name: string }>>;
  layoutsSaveGrid?: (grid: unknown) => Promise<boolean | { error: string }>;
  cliAgentsList?: () => Promise<{ ok: boolean; agents: CliAgentRow[]; gatewayReady?: boolean }>;
}

let openOverlay: HTMLElement | null = null;

/** The three agent selects, filled: the loops the member has on (and any
 *  loop the stored answer names, so an edit never silently drops it). */
function agentSelectsHtml(cls: string, inheritLabel: string): string {
  return `
    <label class="wsc-row"><span class="wsc-label">Loop</span>
      <select class="settings-input ${cls}-loop"><option value="">${inheritLabel}</option></select></label>
    <label class="wsc-row"><span class="wsc-label">Opens as</span>
      <select class="settings-input ${cls}-view">
        <option value="">${inheritLabel}</option>
        <option value="glyphh">Chat</option>
        <option value="cli">Terminal</option>
      </select></label>
    <label class="wsc-row"><span class="wsc-label">CLI route</span>
      <select class="settings-input ${cls}-gateway">
        <option value="">${inheritLabel}</option>
        <option value="off">Direct — the CLI's own login</option>
        <option value="on">Gateway — my providers</option>
      </select></label>`;
}

function fillLoops(sel: HTMLSelectElement, loops: ReadonlyArray<{ id: string; name: string }>, keep: string): void {
  const ids = new Set(loops.map((l) => l.id));
  for (const l of loops) {
    const o = document.createElement("option");
    o.value = l.id;
    o.textContent = l.name;
    sel.appendChild(o);
  }
  if (keep && !ids.has(keep)) {
    const o = document.createElement("option");
    o.value = keep;
    o.textContent = `${LOOP_NAMES[keep as keyof typeof LOOP_NAMES] ?? keep} (turned off)`;
    sel.appendChild(o);
  }
}

function readAgent(scope: HTMLElement, cls: string): AgentStart {
  const v = (s: string): string => scope.querySelector<HTMLSelectElement>(`.${cls}-${s}`)?.value ?? "";
  const view = v("view");
  const gateway = v("gateway");
  return {
    loop: v("loop"),
    view: view === "glyphh" || view === "cli" ? view : "",
    gateway: gateway === "on" || gateway === "off" ? gateway : "",
  };
}

function setAgent(scope: HTMLElement, cls: string, a: AgentStart): void {
  const set = (s: string, val: string): void => { const el = scope.querySelector<HTMLSelectElement>(`.${cls}-${s}`); if (el) el.value = val; };
  set("loop", a.loop);
  set("view", a.view);
  set("gateway", a.gateway);
}

/** Create a workspace from what is on screen. */
export function openCreateWorkspaceModal(): Promise<void> { return openWorkspaceModal(null); }

/** Edit a saved workspace's setup (its arrangement stays as it is). */
export async function openEditWorkspaceModal(name: string): Promise<void> {
  const api = (window.glyphh ?? {}) as unknown as Api;
  const rows = ((await api.layoutsList?.().catch(() => [])) ?? []) as unknown as WorkspaceRow[];
  const row = rows.find((r) => r.name === name);
  if (!row) return;
  return openWorkspaceModal(row);
}

async function openWorkspaceModal(editing: WorkspaceRow | null): Promise<void> {
  if (openOverlay?.isConnected) { openOverlay.querySelector<HTMLInputElement>(".wsc-name")?.focus(); return; }
  const api = (window.glyphh ?? {}) as unknown as Api;
  const save = (window as unknown as { __wbSaveWorkspace?: SaveWorkspace }).__wbSaveWorkspace;
  const folderNow = editing ? editing.folder ?? "" : (window as unknown as { __glyphhCurrentFolder?: () => string | null }).__glyphhCurrentFolder?.() || "";
  // The agent cells an edit can set one by one; a create's cells are the
  // arrangement on screen and inherit the workspace.
  const agentCells = editing ? editing.splits.map((c, i) => ({ c, i })).filter(({ c }) => isAgentCell(c.panelId)) : [];

  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay wsc-overlay";
  overlay.innerHTML = `
    <div class="confirm-box wsc-box" role="dialog" aria-modal="true" aria-labelledby="wsc-title">
      <div class="confirm-head"><h3 id="wsc-title"></h3></div>
      <div class="confirm-body wsc-body">
        <label class="wsc-row"><span class="wsc-label">Name</span>
          <input class="settings-input wsc-name" type="text" spellcheck="false" autocomplete="off" placeholder="My workspace" /></label>
        <label class="wsc-row"><span class="wsc-label">Model</span>
          <select class="settings-input wsc-model"><option value="">Default model</option></select></label>
        <label class="wsc-row"><span class="wsc-label">Session</span>
          <select class="settings-input wsc-session">
            <option value="keep">Keep the current session</option>
            <option value="new">Start a new session</option>
            <option value="last">Resume this workspace&rsquo;s last session</option>
          </select></label>
        <div class="wsc-row"><span class="wsc-label">Directory</span>
          <div class="wsc-dir">
            <input class="settings-input wsc-folder" type="text" spellcheck="false" autocomplete="off" placeholder="No folder" />
            <button class="action-btn secondary wsc-browse" type="button">Browse…</button>
          </div></div>
        <div class="wsc-group wsc-agent">
          <div class="wsc-group-head">Agent</div>
          ${agentSelectsHtml("wsc-a", "My default")}
        </div>
        <div class="wsc-cells"></div>
        <div class="wsc-error hidden"></div>
      </div>
      <div class="confirm-foot">
        <button class="action-btn secondary wsc-cancel" type="button">Cancel</button>
        <button class="action-btn primary wsc-create" type="button"></button>
      </div>
    </div>`;
  const q = <T extends HTMLElement>(sel: string): T => overlay.querySelector<T>(sel)!;
  q("#wsc-title").textContent = editing ? `Edit ${editing.name}` : "Create workspace";
  const nameIn = q<HTMLInputElement>(".wsc-name");
  const modelSel = q<HTMLSelectElement>(".wsc-model");
  const sessSel = q<HTMLSelectElement>(".wsc-session");
  const folderIn = q<HTMLInputElement>(".wsc-folder");
  const errEl = q<HTMLElement>(".wsc-error");
  const createBtn = q<HTMLButtonElement>(".wsc-create");
  const cellsHost = q<HTMLElement>(".wsc-cells");
  createBtn.textContent = editing ? "Save" : "Create";
  folderIn.value = folderNow;
  if (editing) {
    nameIn.value = editing.name;
    nameIn.readOnly = true;
    sessSel.value = editing.sessionMode ?? "keep";
  }
  // One block per agent cell: Agent 1, Agent 2, … in reading order.
  agentCells.forEach(({ i }, n) => {
    const block = document.createElement("div");
    block.className = "wsc-group wsc-cell";
    block.dataset.cell = String(i);
    block.innerHTML = `<div class="wsc-group-head"></div>${agentSelectsHtml("wsc-c", "Workspace's")}`;
    (block.querySelector(".wsc-group-head") as HTMLElement).textContent = agentCells.length > 1 ? `Agent panel ${n + 1}` : "Agent panel";
    cellsHost.appendChild(block);
  });

  const showError = (msg: string | null): void => {
    errEl.textContent = msg ?? "";
    errEl.classList.toggle("hidden", !msg);
  };
  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    openOverlay = null;
    guardWebviewsForModal(false);
  };
  const submit = async (): Promise<void> => {
    if (createBtn.disabled) return;
    const agent = readAgent(q(".wsc-agent"), "wsc-a");
    if (editing) {
      const cells: Record<number, AgentStart> = {};
      cellsHost.querySelectorAll<HTMLElement>(".wsc-cell").forEach((b) => { cells[Number(b.dataset.cell)] = readAgent(b, "wsc-c"); });
      createBtn.disabled = true;
      const grid = editedWorkspaceGrid(editing, {
        model: modelSel.value,
        session: sessSel.value === "new" || sessSel.value === "last" ? sessSel.value : "keep",
        folder: folderIn.value,
        agent,
        cells,
      });
      const res = await api.layoutsSaveGrid?.(grid).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
      createBtn.disabled = false;
      if (!res || (typeof res === "object" && res.error)) { showError((typeof res === "object" && res.error) || "The workspace could not be saved."); return; }
      document.dispatchEvent(new CustomEvent("glyphh:apps-changed"));
      toastOk(`${editing.name} saved — it opens this way next time`);
      close();
      return;
    }
    const existing = ((await api.layoutsList?.().catch(() => [])) ?? []).map((l) => String(l?.name ?? ""));
    const err = workspaceFormError(nameIn.value, existing);
    if (err) { showError(err); nameIn.focus(); return; }
    if (!save) { showError("The workbench has not finished loading. Try again in a moment."); return; }
    createBtn.disabled = true;
    const res = await save({
      name: nameIn.value.trim(),
      ...(modelSel.value ? { model: modelSel.value } : {}),
      session: sessSel.value === "new" || sessSel.value === "last" ? sessSel.value : "keep",
      ...(folderIn.value.trim() ? { folder: folderIn.value.trim() } : {}),
      loop: agent.loop || null,
      view: agent.view || null,
      gateway: agent.gateway || null,
    }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    createBtn.disabled = false;
    if (!res.ok) { showError(res.error || "The workspace could not be saved."); return; }
    close();
  };
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Enter" && (e.target as HTMLElement)?.tagName !== "SELECT") { e.preventDefault(); void submit(); }
  }
  q(".wsc-cancel").addEventListener("click", close);
  createBtn.addEventListener("click", () => { void submit(); });
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  q(".wsc-browse").addEventListener("click", () => {
    void api.layoutsPickFolder?.().then((dir) => { if (dir) folderIn.value = dir; });
  });
  nameIn.addEventListener("input", () => showError(null));
  document.addEventListener("keydown", onKey, true);

  guardWebviewsForModal(true);
  document.body.appendChild(overlay);
  openOverlay = overlay;
  if (editing) modelSel.focus(); else nameIn.focus();

  // The lists fill in after the modal is up — never block it on main.
  const wantModel = editing?.modelSelections?.default ?? "";
  void api.loopModels?.("glyphh").then((r) => {
    if (!r?.ok || !overlay.isConnected) return;
    for (const m of r.models.filter((x) => !x.utility)) {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.name || m.id;
      modelSel.appendChild(o);
    }
    if (wantModel) modelSel.value = wantModel;
  }).catch(() => { /* the default model stands */ });
  void settle(api.cliAgentsList?.(), null).then((r) => {
    if (!overlay.isConnected) return;
    const on = r?.ok ? r.agents.filter((a) => a.enabled) : [];
    const loops = LOOP_IDS
      .filter((id) => id === "glyphh" || on.some((a) => a.id === id))
      .map((id) => ({ id: id as string, name: on.find((a) => a.id === id)?.name ?? LOOP_NAMES[id] }));
    const ws = editing ? agentStartOf(editing) : INHERIT;
    fillLoops(q<HTMLSelectElement>(".wsc-a-loop"), loops, ws.loop);
    setAgent(q(".wsc-agent"), "wsc-a", ws);
    cellsHost.querySelectorAll<HTMLElement>(".wsc-cell").forEach((b) => {
      const cell = editing!.splits[Number(b.dataset.cell)];
      // An agent:<cli> cell names its loop in its id; its config may refine the rest.
      const fromId = (cell?.panelId ?? "").toLowerCase().startsWith("agent:") ? cell!.panelId.slice(6) : "";
      const a = agentStartOf(cell?.config);
      const start = { ...a, loop: a.loop || fromId };
      fillLoops(b.querySelector<HTMLSelectElement>(".wsc-c-loop")!, loops, start.loop);
      setAgent(b, "wsc-c", start);
    });
  });
}
