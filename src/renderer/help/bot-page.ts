/**
 * bot-page.ts — EDIT A BOT, ONE PAGE (his order, 2026-10-09: "editing a bot
 * should be a page just like customize… the page in one simple page left hand
 * is the current form right hand of the page is the list of powers this bot
 * has: folder(s), connections, models -> + add a new power. Modal with
 * folders, connections, models, etc. super super simple.").
 *
 * Opens full screen from the rail's ⋮ → Edit (code-workbench.ts
 * __wbOpenBotPage). Left: the Agents form as it was (name, icon, when to use
 * it, model, brief and its wand; Delete · Cancel · Save). Right: the bot's
 * powers by kind, each with a remove, and "+ Add a power", which opens the
 * modal. A power added or removed saves at once; the form saves on Save.
 *
 * What the powers do to a turn is main's (shared/bot-powers.ts): the first
 * folder is where the bot works and the rest it can read; connections,
 * extra models and your powers are named to it in its brief.
 */

import { clearInvalid, confirmAction, guardWebviewsForModal } from "./shared.js";
import { AVATAR_COLORS, AVATAR_VARIANTS, DEFAULT_VARIANT, avatarOf, botAvatarSvg, type BotAvatar } from "./bot-avatar.js";
import { PLUS_ICONS, readConnectorRows, type PlusApi, type PlusConnectorRow } from "./composer-plus.js";
import { primeConnectedIcons } from "./app-icon.js";

export interface BotRow {
  slug: string; name: string; description: string; prompt: string; model: string;
  avatar: BotAvatar | null;
  folders?: string[]; connections?: string[]; models?: string[]; skills?: string[];
}
interface Envelope { ok: boolean; data?: unknown; error?: string }
interface LoopModel { id: string; name: string; utility?: boolean }
interface Api extends PlusApi {
  libraryAgentGet?: (ref: string) => Promise<Envelope>;
  libraryAgentUpdate?: (ref: string, patch: unknown) => Promise<Envelope>;
  libraryAgentDelete?: (ref: string) => Promise<Envelope>;
  loopModels?: (loopId: string, force?: boolean) => Promise<{ ok: boolean; models: LoopModel[] }>;
  agentBriefGenerate?: (input: { name?: string; description?: string; model?: string; draft?: string }) =>
    Promise<{ ok: true; brief: string; model: string } | { ok: false; error: string }>;
  pickDirectory?: () => Promise<string | null>;
  getWorkingDirRecents?: () => Promise<string[]>;
}
export interface BotPageHandle { back(): boolean; destroy(): void }
export type PowerKind = "folders" | "connections" | "models" | "skills";

const api = (): Api => ((window as unknown as { glyphh?: Api }).glyphh ?? {});
const SAME_AS_MAIN = "";
const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
const WAND_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M12.2 6.2 11 5"/><path d="m15 9-12 12"/></svg>`;
const MODEL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>`;
const POWER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>`;

/** The kinds, in the order the page and the modal show them. */
export const POWER_KINDS: ReadonlyArray<{ kind: PowerKind; label: string }> = Object.freeze([
  { kind: "folders", label: "Folders" },
  { kind: "connections", label: "Connections" },
  { kind: "models", label: "Models" },
  { kind: "skills", label: "Your powers" },
]);

/** A bot's list of one kind, as stored (blank and repeated names dropped). */
export function powersOf(bot: Pick<BotRow, PowerKind>, kind: PowerKind): string[] {
  const v = bot[kind];
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : []) { const t = String(x ?? "").trim(); if (t && !out.includes(t)) out.push(t); }
  return out;
}

/** The patch that adds (on) or removes (off) one power. A model added to a bot
 *  with no model of its own becomes the one it runs on. */
export function powerPatch(bot: Pick<BotRow, PowerKind | "model">, kind: PowerKind, name: string, on: boolean): Record<string, unknown> {
  if (kind === "models" && on && !String(bot.model ?? "").trim()) return { model: name };
  const cur = powersOf(bot, kind).filter((x) => x !== name);
  return { [kind]: on ? [...cur, name] : cur };
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const baseName = (p: string): string => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
const onWeb = (): boolean => !api().pickDirectory;

export function mountBotPage(host: HTMLElement, opts: { slug: string; onClose: () => void }): BotPageHandle {
  host.classList.add("botp-host");
  const root = el("div", "botp");
  host.appendChild(root);
  let bot: BotRow | null = null;
  let models: LoopModel[] = [];
  let conns: PlusConnectorRow[] = [];
  let skills: Array<{ id: string; name: string; type?: string }> = [];
  let picked: BotAvatar = { variant: DEFAULT_VARIANT, color: AVATAR_COLORS[0]! };
  let destroyed = false;
  let modal: HTMLElement | null = null;

  // ── The title row: Customize's (46px, the rule, the ✕). ──
  const titlebar = el("div", "settings-group-titlebar");
  // "Edit", the size of the agent header's title (his order, 2026-10-09).
  const title = el("h1", "settings-group-title botp-title", "Edit");
  const x = el("button", "ws-icon-btn settings-group-close");
  x.type = "button"; x.title = "Close"; x.innerHTML = CLOSE_SVG;
  x.addEventListener("click", () => opts.onClose());
  titlebar.append(title, x);
  root.appendChild(titlebar);

  const grid = el("div", "botp-grid");
  root.appendChild(grid);
  const form = el("div", "botp-form");
  const side = el("div", "botp-powers");
  grid.append(form, side);

  // ── LEFT: the form as it was ──
  form.innerHTML = `
    <div class="crud-form-error botp-error hidden"></div>
    <div class="edit-head botp-head"></div>
    <label class="settings-label">Name</label>
    <input type="text" class="settings-input botp-name" placeholder="Researcher" maxlength="80" spellcheck="false" autocomplete="off" />
    <label class="settings-label">Icon</label>
    <div class="agents2-faces botp-faces" role="group" aria-label="Face"></div>
    <label class="settings-label">When to use it</label>
    <input type="text" class="settings-input botp-desc" placeholder="Reads the web and reports facts with sources — the main agent reads this to decide what to hand over" maxlength="300" autocomplete="off" />
    <label class="settings-label">Model</label>
    <div class="settings-inline"><select class="settings-input botp-model" style="width:auto;"></select></div>
    <div class="agents2-brief-head">
      <label class="settings-label">Brief</label>
      <button class="agents2-wand botp-wand" type="button" title="Write the brief with AI" aria-label="Write the brief with AI">${WAND_SVG}</button>
    </div>
    <div class="agents2-brief-error botp-brief-error hidden" role="alert"></div>
    <textarea class="settings-input agents2-brief botp-brief" rows="9" placeholder="What this super power always knows and how it works."></textarea>
    <div class="settings-actions" style="margin-top:28px;">
      <button class="action-btn danger botp-delete" type="button">Delete</button>
      <div style="flex:1;"></div>
      <button class="action-btn botp-cancel" type="button">Cancel</button>
      <button class="action-btn primary botp-save" type="button">Save</button>
    </div>`;
  const q = <T extends HTMLElement>(sel: string): T => form.querySelector<T>(sel)!;
  const nameIn = q<HTMLInputElement>(".botp-name");
  const descIn = q<HTMLInputElement>(".botp-desc");
  const modelSel = q<HTMLSelectElement>(".botp-model");
  const briefIn = q<HTMLTextAreaElement>(".botp-brief");
  const wand = q<HTMLButtonElement>(".botp-wand");
  const saveBtn = q<HTMLButtonElement>(".botp-save");
  const errEl = q<HTMLElement>(".botp-error");
  const briefErr = q<HTMLElement>(".botp-brief-error");
  const showErr = (node: HTMLElement, msg: string): void => { node.textContent = msg; node.classList.toggle("hidden", !msg); };

  const modelName = (id: string): string => models.find((m) => m.id === id)?.name ?? id;
  function paintHead(): void {
    const head = q<HTMLElement>(".botp-head");
    head.textContent = "";
    const icons = el("div", "edit-head-icons");
    icons.innerHTML = botAvatarSvg(picked, "idle", { size: 44 });
    head.append(icons, el("div", "edit-head-name", nameIn.value.trim() || bot?.name || "Super power"));
  }
  function paintFaces(): void {
    const faces = q<HTMLElement>(".botp-faces");
    faces.textContent = "";
    for (const v of AVATAR_VARIANTS) {
      const b = el("button", "agents2-face" + (v.id === picked.variant ? " on" : ""));
      b.type = "button"; b.title = v.name; b.setAttribute("aria-label", v.name);
      b.innerHTML = botAvatarSvg({ variant: v.id, color: picked.color }, "idle", { size: 40 });
      b.addEventListener("click", () => { picked = { ...picked, variant: v.id }; paintFaces(); paintHead(); });
      faces.appendChild(b);
    }
  }
  function fillModels(keep: string): void {
    modelSel.textContent = "";
    const opt = (value: string, label: string): void => { const o = el("option", "", label); o.value = value; modelSel.appendChild(o); };
    opt(SAME_AS_MAIN, "Same as the main agent");
    for (const m of models) opt(m.id, m.name);
    // A model the team no longer lists stays visible rather than silently flipping.
    if (keep && !models.some((m) => m.id === keep)) opt(keep, keep);
    modelSel.value = keep;
  }
  function fillForm(): void {
    if (!bot) return;
    nameIn.value = bot.name;
    descIn.value = bot.description ?? "";
    briefIn.value = bot.prompt ?? "";
    picked = avatarOf({ slug: bot.slug, avatar: bot.avatar });
    fillModels(bot.model ?? SAME_AS_MAIN);
    paintFaces();
    paintHead();
  }

  async function save(): Promise<void> {
    if (!bot) return;
    const input = { name: nameIn.value.trim(), description: descIn.value.trim(), prompt: briefIn.value.trim(), model: modelSel.value, avatar: picked };
    if (!input.name) { nameIn.classList.add("invalid"); clearInvalid(nameIn); showErr(errEl, "A super power needs a name."); return; }
    if (!input.prompt) { briefIn.classList.add("invalid"); clearInvalid(briefIn); showErr(errEl, "A super power needs a brief — without one it can't be handed work."); return; }
    saveBtn.disabled = true;
    const r = await api().libraryAgentUpdate?.(bot.slug, input).catch((e: unknown): Envelope => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    saveBtn.disabled = false;
    if (!r?.ok) { showErr(errEl, r?.error || "The super power could not be saved."); return; }
    opts.onClose();
  }
  async function remove(): Promise<void> {
    if (!bot) return;
    const sure = await confirmAction({
      title: `Delete “${bot.name}”?`,
      body: "Glyphh won't be able to hand work to it any more. Its scheduled tasks go with it.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!sure) return;
    const r = await api().libraryAgentDelete?.(bot.slug);
    if (!r?.ok) { showErr(errEl, r?.error || "The super power could not be deleted."); return; }
    opts.onClose();
  }
  async function writeBrief(): Promise<void> {
    if (wand.disabled) return;
    const input = { name: nameIn.value.trim(), description: descIn.value.trim(), model: modelSel.value, draft: briefIn.value.trim() };
    if (!input.name && !input.description && !input.draft) { showErr(briefErr, "Give the super power a name and say when to use it first — the brief is written from those."); return; }
    showErr(briefErr, "");
    wand.disabled = true;
    wand.classList.add("generating");
    wand.innerHTML = `<span class="agents2-wand-spin" aria-hidden="true"></span><span>Generating…</span>`;
    briefIn.readOnly = true;
    const r = await api().agentBriefGenerate?.(input).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    wand.disabled = false;
    wand.classList.remove("generating");
    wand.innerHTML = WAND_SVG;
    briefIn.readOnly = false;
    if (!r) { showErr(briefErr, "Writing a brief isn't available here."); return; }
    if (!r.ok) { showErr(briefErr, r.error); return; }
    briefIn.focus();
    briefIn.select();
    if (!document.execCommand("insertText", false, r.brief)) briefIn.value = r.brief;
    briefIn.setSelectionRange(0, 0);
    briefIn.scrollTop = 0;
  }
  nameIn.addEventListener("input", () => { paintHead(); showErr(briefErr, ""); });
  descIn.addEventListener("input", () => showErr(briefErr, ""));
  q(".botp-cancel").addEventListener("click", () => opts.onClose());
  saveBtn.addEventListener("click", () => { void save(); });
  q(".botp-delete").addEventListener("click", () => { void remove(); });
  wand.addEventListener("click", () => { void writeBrief(); });

  // ── RIGHT: the powers — one collapsible section per kind, each with its
  //    own + and its own search (his order, 2026-10-09: "the right rail should
  //    be more pronounced… collapsable sections for each Power with a + by
  //    each also and a search under each section header"). ──
  const sideHead = el("div", "botp-powers-head");
  sideHead.appendChild(el("h2", "botp-powers-title", "Powers"));
  const addBtn = el("button", "action-btn primary botp-add", "+ Add a power");
  addBtn.type = "button";
  addBtn.addEventListener("click", () => openModal());
  sideHead.appendChild(addBtn);
  const sideErr = el("div", "crud-form-error botp-error hidden");
  const sideList = el("div", "botp-power-list");
  side.append(sideHead, sideErr, sideList);

  const SEARCH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;
  const CHEVRON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
  const EMPTY_TEXT: Record<PowerKind, string> = {
    folders: "No folders yet.",
    connections: "No connections yet.",
    models: "No models yet. It runs on the main agent's.",
    skills: "None yet.",
  };
  interface PowerItem { icon: string; name: string; sub: string; tag?: string; stored?: string }
  const collapsed = new Set<PowerKind>();
  const sections = new Map<PowerKind, { root: HTMLElement; count: HTMLElement; list: HTMLElement; search: HTMLInputElement }>();

  function connOf(slug: string): PlusConnectorRow | undefined { return conns.find((c) => c.slug === slug); }
  function skillOf(id: string): { id: string; name: string; type?: string } | undefined { return skills.find((s) => s.id === id); }

  /** What one section lists for the bot as saved. */
  function itemsOf(kind: PowerKind): PowerItem[] {
    if (!bot) return [];
    if (kind === "folders") return powersOf(bot, "folders").map((f, i) => ({ icon: PLUS_ICONS.folder, name: baseName(f), sub: f, stored: f, ...(i === 0 ? { tag: "Works here" } : {}) }));
    if (kind === "connections") return powersOf(bot, "connections").map((c) => { const k = connOf(c); return { icon: k?.icon ?? PLUS_ICONS.connectors, name: k?.name ?? c, sub: k?.on ? "Connected" : "Not connected", stored: c }; });
    if (kind === "models") {
      const main = String(bot.model ?? "").trim();
      const out: PowerItem[] = main ? [{ icon: MODEL_SVG, name: modelName(main), sub: "Change it in the form", tag: "Runs on" }] : [];
      for (const m of powersOf(bot, "models").filter((m) => m !== main)) out.push({ icon: MODEL_SVG, name: modelName(m), sub: "", stored: m });
      return out;
    }
    return powersOf(bot, "skills").map((s) => { const k = skillOf(s); return { icon: POWER_SVG, name: k?.name ?? s, sub: k?.type === "task" ? "Task" : "Skill", stored: s }; });
  }

  function powerRow(kind: PowerKind, it: PowerItem): HTMLElement {
    const row = el("div", "botp-power");
    const ic = el("div", "botp-power-icon");
    ic.innerHTML = it.icon;
    const main = el("div", "botp-power-main");
    main.appendChild(el("div", "botp-power-name", it.name));
    if (it.sub) main.appendChild(el("div", "botp-power-sub", it.sub));
    row.append(ic, main);
    if (it.tag) row.appendChild(el("span", "botp-power-tag", it.tag));
    if (it.stored !== undefined) {
      const stored = it.stored;
      const rm = el("button", "ws-icon-btn botp-power-remove");
      rm.type = "button"; rm.title = "Remove"; rm.setAttribute("aria-label", `Remove ${it.name}`);
      rm.innerHTML = CLOSE_SVG;
      rm.addEventListener("click", () => { void setPower(kind, stored, false); });
      row.appendChild(rm);
    }
    return row;
  }

  /** The sections are built once; a repaint fills their lists (a search keeps its focus). */
  function buildSections(): void {
    for (const { kind, label } of POWER_KINDS) {
      const sec = el("section", "botp-sec");
      sec.dataset.kind = kind;
      const head = el("div", "botp-sec-head");
      const toggle = el("button", "botp-sec-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", "true");
      toggle.innerHTML = `<span class="botp-sec-chev">${CHEVRON_SVG}</span>`;
      toggle.appendChild(el("span", "botp-sec-label", label));
      const count = el("span", "tab-count botp-sec-count", "");
      toggle.appendChild(count);
      toggle.addEventListener("click", () => {
        if (collapsed.has(kind)) collapsed.delete(kind); else collapsed.add(kind);
        sec.classList.toggle("collapsed", collapsed.has(kind));
        toggle.setAttribute("aria-expanded", String(!collapsed.has(kind)));
      });
      const plus = el("button", "ws-icon-btn botp-sec-add");
      plus.type = "button"; plus.title = `Add to ${label}`; plus.setAttribute("aria-label", `Add to ${label}`);
      plus.innerHTML = PLUS_SVG;
      plus.addEventListener("click", () => openModal(kind));
      head.append(toggle, plus);
      const body = el("div", "botp-sec-body");
      const search = el("div", "skills-search botp-sec-search", SEARCH_SVG);
      const input = el("input");
      input.type = "text"; input.placeholder = `Search ${label.toLowerCase()}`; input.spellcheck = false; input.autocomplete = "off";
      input.addEventListener("input", () => paintSection(kind));
      search.appendChild(input);
      const list = el("div", "botp-sec-list");
      body.append(search, list);
      sec.append(head, body);
      sideList.appendChild(sec);
      sections.set(kind, { root: sec, count, list, search: input });
    }
  }
  function paintSection(kind: PowerKind): void {
    const s = sections.get(kind);
    if (!s) return;
    const all = itemsOf(kind);
    s.count.textContent = all.length ? String(all.length) : "";
    const needle = s.search.value.trim().toLowerCase();
    const shown = needle ? all.filter((it) => `${it.name} ${it.sub}`.toLowerCase().includes(needle)) : all;
    s.list.textContent = "";
    if (!shown.length) { s.list.appendChild(el("div", "botp-empty", all.length ? "Nothing matches." : EMPTY_TEXT[kind])); return; }
    for (const it of shown) s.list.appendChild(powerRow(kind, it));
  }
  function paintPowers(): void {
    if (!sections.size) buildSections();
    for (const { kind } of POWER_KINDS) paintSection(kind);
  }

  /** Remove one power from the list, saved at once. */
  async function setPower(kind: PowerKind, name: string, on: boolean): Promise<void> {
    if (!bot) return;
    const patch = powerPatch(bot, kind, name, on);
    const r = await api().libraryAgentUpdate?.(bot.slug, patch).catch((e: unknown): Envelope => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r?.ok) { showErr(sideErr, r?.error || "The power could not be saved."); return; }
    showErr(sideErr, "");
    bot = { ...bot, ...(patch as Partial<BotRow>) };
    if ("model" in patch) fillModels(String(patch.model));
    paintPowers();
  }

  // ── THE MODAL: + Add a power. One fixed size whatever the tab; picks are a
  //    draft until Save, and Cancel, ✕ or Escape drop them. ──
  let modalKind: PowerKind = "folders";
  let recents: string[] = [];
  let draft: Pick<BotRow, PowerKind | "model"> | null = null;
  function closeModal(): void {
    if (!modal) return;
    modal.remove();
    modal = null;
    draft = null;
    guardWebviewsForModal(false);
    document.removeEventListener("keydown", onModalKey, true);
  }
  function onModalKey(e: KeyboardEvent): void {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeModal(); }
  }
  function openModal(kind?: PowerKind): void {
    if (!bot) return;
    if (kind) modalKind = kind;
    if (modal) { paintModal(); return; }
    draft = {
      model: bot.model ?? "",
      folders: powersOf(bot, "folders"), connections: powersOf(bot, "connections"),
      models: powersOf(bot, "models"), skills: powersOf(bot, "skills"),
    };
    modal = el("div", "confirm-overlay botp-modal");
    modal.innerHTML = `
      <div class="confirm-box botp-modal-box" role="dialog" aria-modal="true" aria-label="Add a power">
        <div class="confirm-head botp-modal-head"><h3>Add a power</h3>
          <button class="ws-icon-btn botp-modal-x" type="button" title="Close" aria-label="Close">${CLOSE_SVG}</button></div>
        <div class="skills-tabs botp-modal-tabs" role="tablist"></div>
        <div class="confirm-body botp-modal-body"></div>
        <div class="crud-form-error botp-error botp-modal-error hidden"></div>
        <div class="confirm-foot">
          <button class="action-btn secondary botp-modal-cancel" type="button">Cancel</button>
          <button class="action-btn primary botp-modal-save" type="button">Save</button>
        </div>
      </div>`;
    const tabs = modal.querySelector<HTMLElement>(".botp-modal-tabs")!;
    for (const { kind: k, label } of POWER_KINDS) {
      const b = el("button", "skills-tab", label);
      b.type = "button"; b.dataset.kind = k; b.setAttribute("role", "tab");
      b.addEventListener("click", () => { modalKind = k; paintModal(); });
      tabs.appendChild(b);
    }
    modal.querySelector(".botp-modal-x")!.addEventListener("click", closeModal);
    modal.querySelector(".botp-modal-cancel")!.addEventListener("click", closeModal);
    modal.querySelector(".botp-modal-save")!.addEventListener("click", () => { void saveModal(); });
    modal.addEventListener("mousedown", (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener("keydown", onModalKey, true);
    guardWebviewsForModal(true);
    document.body.appendChild(modal);
    paintModal();
    if (!onWeb()) void api().getWorkingDirRecents?.().then((r) => { recents = Array.isArray(r) ? r.map(String) : []; paintModal(); }).catch(() => {});
  }
  /** Flip one pick in the draft. A model picked for a bot with none becomes the one it runs on. */
  function toggleDraft(kind: PowerKind, name: string): void {
    if (!draft) return;
    if (kind === "models" && !draft.model) { draft.model = name; paintModal(); return; }
    const cur = powersOf(draft, kind);
    draft[kind] = cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name];
    paintModal();
  }
  async function saveModal(): Promise<void> {
    if (!modal || !draft || !bot) return;
    const patch: Record<string, unknown> = {};
    for (const { kind } of POWER_KINDS) {
      if (JSON.stringify(powersOf(draft, kind)) !== JSON.stringify(powersOf(bot, kind))) patch[kind] = powersOf(draft, kind);
    }
    if ((draft.model ?? "") !== (bot.model ?? "")) patch.model = draft.model;
    if (!Object.keys(patch).length) { closeModal(); return; }
    const save = modal.querySelector<HTMLButtonElement>(".botp-modal-save")!;
    save.disabled = true;
    const r = await api().libraryAgentUpdate?.(bot.slug, patch).catch((e: unknown): Envelope => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!modal) return;
    save.disabled = false;
    if (!r?.ok) { showErr(modal.querySelector<HTMLElement>(".botp-modal-error")!, r?.error || "The powers could not be saved."); return; }
    bot = { ...bot, ...(patch as Partial<BotRow>) };
    if ("model" in patch) fillModels(String(patch.model));
    showErr(sideErr, "");
    paintPowers();
    closeModal();
  }
  /** One choice in the modal: Add, or Added (a click takes it back off). */
  function choice(icon: string, name: string, sub: string, has: boolean, onToggle: () => void, fixed?: string): HTMLElement {
    const row = el("div", "botp-choice");
    const ic = el("div", "botp-power-icon");
    ic.innerHTML = icon;
    const main = el("div", "botp-power-main");
    main.appendChild(el("div", "botp-power-name", name));
    if (sub) main.appendChild(el("div", "botp-power-sub", sub));
    row.append(ic, main);
    if (fixed) { row.appendChild(el("span", "botp-power-tag", fixed)); return row; }
    const b = el("button", `action-btn ${has ? "" : "secondary "}botp-choice-btn${has ? " on" : ""}`, has ? "Added" : "Add");
    b.type = "button";
    b.addEventListener("click", onToggle);
    row.appendChild(b);
    return row;
  }
  function paintModal(): void {
    if (!modal || !draft) return;
    modal.querySelectorAll<HTMLElement>(".botp-modal-tabs .skills-tab").forEach((b) => b.classList.toggle("active", b.dataset.kind === modalKind));
    const body = modal.querySelector<HTMLElement>(".botp-modal-body")!;
    body.textContent = "";
    const empty = (t: string): void => { body.appendChild(el("div", "botp-empty", t)); };
    const d = draft;
    if (modalKind === "folders") {
      if (onWeb()) { empty("Folders live on your computer. Open Glyphh on your desktop to give this super power a folder."); }
      else {
        const pick = el("button", "action-btn secondary botp-pick", "Choose a folder…");
        pick.type = "button";
        pick.addEventListener("click", () => {
          void api().pickDirectory?.().then((dir) => {
            if (!dir || !draft) return;
            if (!powersOf(draft, "folders").includes(dir)) toggleDraft("folders", dir);
          });
        });
        body.appendChild(pick);
      }
      const have = powersOf(d, "folders");
      for (const f of [...have, ...recents.filter((r) => !have.includes(r))]) {
        body.appendChild(choice(PLUS_ICONS.folder, baseName(f), f, have.includes(f), () => toggleDraft("folders", f)));
      }
    } else if (modalKind === "connections") {
      const have = powersOf(d, "connections");
      const live = conns.filter((c) => c.on || have.includes(c.slug));
      if (!live.length) empty("No connections yet. Connect an account on the Connections page first.");
      for (const c of live) body.appendChild(choice(c.icon, c.name, c.org ? "Your organization's" : "", have.includes(c.slug), () => toggleDraft("connections", c.slug)));
    } else if (modalKind === "models") {
      const main = String(d.model ?? "").trim();
      const have = powersOf(d, "models");
      if (!models.length) empty("Your team's models couldn't be read.");
      for (const m of models) {
        if (m.id === main) { body.appendChild(choice(MODEL_SVG, m.name, "", true, () => {}, "Runs on")); continue; }
        body.appendChild(choice(MODEL_SVG, m.name, "", have.includes(m.id), () => toggleDraft("models", m.id)));
      }
    } else {
      const have = powersOf(d, "skills");
      if (!skills.length) empty("No powers of your own yet. Ask Glyphh to make one.");
      for (const s of skills) body.appendChild(choice(POWER_SVG, s.name, s.type === "task" ? "Task" : "Skill", have.includes(s.id), () => toggleDraft("skills", s.id)));
    }
  }

  // ── Load ──
  void (async () => {
    const [got, ms, cs, sk] = await Promise.all([
      api().libraryAgentGet?.(opts.slug).catch((e: unknown): Envelope => ({ ok: false, error: e instanceof Error ? e.message : String(e) })),
      api().loopModels?.("glyphh").catch(() => null),
      readConnectorRows(api()).catch(() => [] as PlusConnectorRow[]),
      api().skillsList?.(["skill", "task"]).catch(() => null),
    ]);
    if (destroyed) return;
    if (!got?.ok || !got.data) { showErr(errEl, got?.error || "This super power could not be read."); return; }
    bot = got.data as BotRow;
    models = ms?.ok ? ms.models.filter((m) => !m.utility) : [];
    conns = cs;
    skills = sk?.ok && Array.isArray(sk.data) ? (sk.data as Array<{ id: string; name: string; type?: string }>) : [];
    fillForm();
    paintPowers();
    void primeConnectedIcons(conns.filter((r) => r.prime).map((r) => ({ connection: r.prime! })), () => {
      if (destroyed) return;
      void readConnectorRows(api()).then((rows) => { conns = rows; paintPowers(); paintModal(); }).catch(() => {});
    });
    nameIn.focus();
  })();

  return {
    back: () => false,
    destroy: () => { destroyed = true; closeModal(); root.remove(); host.classList.remove("botp-host"); },
  };
}
