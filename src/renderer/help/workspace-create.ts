/**
 * workspace-create.ts — THE CREATE WORKSPACE MODAL (his order, 2026-10-08:
 * "a + to the far right next to workspaces then open a modal with name, and
 * the desired agent state… model, session re: start new, continue aka what we had before, and
 * directory. and of course name. No layout or overrides or any of that. very
 * simple modal. same with the agent -> dropdown -> Create Workspace").
 *
 * The arrangement is whatever is on screen: the workbench saves it and makes
 * it the open workspace in place (code-workbench.ts __wbSaveWorkspace), so
 * nothing reloads. This module only asks the four questions. It runs in the
 * SHELL document; an agent panel asks the shell through main
 * (agent-panel-create-workspace).
 */

import { guardWebviewsForModal } from "./shared.js";
import { workspaceFormError } from "./workspace-form.js";

type SessionChoice = "keep" | "new" | "last";
type SaveWorkspace = (o: { name: string; model?: string; session: SessionChoice; folder?: string }) => Promise<{ ok: boolean; error?: string }>;
interface Api {
  loopModels?: (loopId: string, force?: boolean) => Promise<{ ok: boolean; models: Array<{ id: string; name: string; utility?: boolean }> }>;
  layoutsPickFolder?: () => Promise<string | null>;
  layoutsList?: () => Promise<Array<{ name: string }>>;
}

let openOverlay: HTMLElement | null = null;

export async function openCreateWorkspaceModal(): Promise<void> {
  if (openOverlay?.isConnected) { openOverlay.querySelector<HTMLInputElement>(".wsc-name")?.focus(); return; }
  const api = (window.glyphh ?? {}) as unknown as Api;
  const save = (window as unknown as { __wbSaveWorkspace?: SaveWorkspace }).__wbSaveWorkspace;
  const folderNow = (window as unknown as { __glyphhCurrentFolder?: () => string | null }).__glyphhCurrentFolder?.() || "";

  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay wsc-overlay";
  overlay.innerHTML = `
    <div class="confirm-box wsc-box" role="dialog" aria-modal="true" aria-labelledby="wsc-title">
      <div class="confirm-head"><h3 id="wsc-title">Create workspace</h3></div>
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
        <div class="wsc-error hidden"></div>
      </div>
      <div class="confirm-foot">
        <button class="action-btn secondary wsc-cancel" type="button">Cancel</button>
        <button class="action-btn primary wsc-create" type="button">Create</button>
      </div>
    </div>`;
  const q = <T extends HTMLElement>(sel: string): T => overlay.querySelector<T>(sel)!;
  const nameIn = q<HTMLInputElement>(".wsc-name");
  const modelSel = q<HTMLSelectElement>(".wsc-model");
  const sessSel = q<HTMLSelectElement>(".wsc-session");
  const folderIn = q<HTMLInputElement>(".wsc-folder");
  const errEl = q<HTMLElement>(".wsc-error");
  const createBtn = q<HTMLButtonElement>(".wsc-create");
  folderIn.value = folderNow;

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
  nameIn.focus();

  // The models fill in after the modal is up — never block it on the gateway.
  void api.loopModels?.("glyphh").then((r) => {
    if (!r?.ok || !overlay.isConnected) return;
    for (const m of r.models.filter((x) => !x.utility)) {
      const o = document.createElement("option");
      o.value = m.id;
      o.textContent = m.name || m.id;
      modelSel.appendChild(o);
    }
  }).catch(() => { /* the default model stands */ });
}
