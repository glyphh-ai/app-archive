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
  avatarGenerate?: (input: { name?: string; description?: string; prompt?: string; model?: string }) =>
    Promise<{ ok: true; data: { image: string; model: string; usd: number; prompt: string } } | { ok: false; error: string }>;
  getWorkingDirRecents?: () => Promise<string[]>;
}
export interface BotPageHandle { back(): boolean; destroy(): void }
export type PowerKind = "folders" | "connections" | "models" | "skills";
/** Shut on first open: everything but Folders. */
export const DEFAULT_COLLAPSED: ReadonlyArray<PowerKind> = Object.freeze(["connections", "models", "skills"]);

const api = (): Api => ((window as unknown as { glyphh?: Api }).glyphh ?? {});
const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
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

/** A super power's models as ONE list (his order, 2026-10-09: the model "gets
 *  that information from the powers"): the first is the one it runs on
 *  (`model`), the rest are `models`. */
export function modelList(bot: Pick<BotRow, "model" | "models">): string[] {
  const main = String(bot.model ?? "").trim();
  return [...(main ? [main] : []), ...powersOf({ models: bot.models } as Pick<BotRow, PowerKind>, "models").filter((m) => m !== main)];
}
/** The fields a model list is saved as. */
export function modelFields(list: string[]): { model: string; models: string[] } {
  return { model: list[0] ?? "", models: list.slice(1) };
}

/** The patch that adds (on) or removes (off) one power. Models move as one
 *  list: the first added runs it, and removing that one hands it to the next. */
export function powerPatch(bot: Pick<BotRow, PowerKind | "model">, kind: PowerKind, name: string, on: boolean): Record<string, unknown> {
  if (kind === "models") {
    const cur = modelList(bot).filter((m) => m !== name);
    return modelFields(on ? [...cur, name] : cur);
  }
  const cur = powersOf(bot, kind).filter((x) => x !== name);
  return { [kind]: on ? [...cur, name] : cur };
}

/** What the avatar modal's box starts with (shared/avatar-style.ts avatarStarterAsk, kept in step). */
export function avatarStarter(name: string, description: string): string {
  const n = String(name ?? "").trim();
  const d = String(description ?? "").trim();
  if (!n && !d) return "";
  return [n && `${n}.`, d && `It ${d.charAt(0).toLowerCase()}${d.slice(1).replace(/\.?$/, ".")}`].filter(Boolean).join(" ")
    + " Give it one prop or feature that shows what it does.";
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
    <div class="botp-name-row">
      <button type="button" class="botp-face-btn" aria-haspopup="menu" aria-expanded="false" title="Change the avatar"></button>
      <input type="text" class="settings-input botp-name" placeholder="Researcher" maxlength="80" spellcheck="false" autocomplete="off" />
    </div>
    <label class="settings-label">When to use it</label>
    <input type="text" class="settings-input botp-desc" placeholder="Reads the web and reports facts with sources — the main agent reads this to decide what to hand over" maxlength="300" autocomplete="off" />
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
  const faceBtn = q<HTMLButtonElement>(".botp-face-btn");
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
  const CARET_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  /** THE AVATAR, LEFT OF THE NAME, AS A DROPDOWN (his order, 2026-10-09):
   *  the sixteen faces, the picture it wears if one was made, + Add new. */
  function paintFaceBtn(): void {
    faceBtn.innerHTML = `<span class="botp-face-mark">${botAvatarSvg(picked, "idle", { size: 40 })}</span><span class="botp-face-caret">${CARET_SVG}</span>`;
  }
  let faceMenu: HTMLElement | null = null;
  function closeFaceMenu(): void {
    faceMenu?.remove();
    faceMenu = null;
    faceBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onFaceAway, true);
    document.removeEventListener("keydown", onFaceKey, true);
  }
  function onFaceAway(e: MouseEvent): void {
    if (faceMenu && !faceMenu.contains(e.target as Node) && !faceBtn.contains(e.target as Node)) closeFaceMenu();
  }
  function onFaceKey(e: KeyboardEvent): void { if (e.key === "Escape") { e.stopPropagation(); closeFaceMenu(); } }
  function openFaceMenu(): void {
    if (faceMenu) { closeFaceMenu(); return; }
    const m = el("div", "botp-face-menu");
    m.setAttribute("role", "menu");
    const grid = el("div", "agents2-faces botp-face-grid");
    const pick = (a: BotAvatar): void => { picked = a; paintFaceBtn(); paintHead(); closeFaceMenu(); };
    // The picture it wears (made with + Add new), first.
    const pictures = [picked.image, bot?.avatar?.image].filter((x, i, all): x is string => !!x && all.indexOf(x) === i);
    for (const image of pictures) {
      const b = el("button", "agents2-face" + (picked.image === image ? " on" : ""));
      b.type = "button"; b.title = "Its picture"; b.setAttribute("aria-label", "Its picture");
      b.innerHTML = botAvatarSvg({ ...picked, image }, "idle", { size: 40 });
      b.addEventListener("click", () => pick({ variant: picked.variant, color: picked.color, image }));
      grid.appendChild(b);
    }
    for (const v of AVATAR_VARIANTS) {
      const b = el("button", "agents2-face" + (!picked.image && v.id === picked.variant ? " on" : ""));
      b.type = "button"; b.title = v.name; b.setAttribute("aria-label", v.name);
      b.innerHTML = botAvatarSvg({ variant: v.id, color: picked.color }, "idle", { size: 40 });
      b.addEventListener("click", () => pick({ variant: v.id, color: picked.color }));
      grid.appendChild(b);
    }
    const add = el("button", "botp-face-add");
    add.type = "button";
    add.innerHTML = `${PLUS_SVG}<span>Add new</span>`;
    add.addEventListener("click", () => { closeFaceMenu(); openAvatarModal(); });
    m.append(grid, add);
    document.body.appendChild(m);
    const r = faceBtn.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${Math.min(r.bottom + 6, window.innerHeight - m.offsetHeight - 8)}px`;
    faceMenu = m;
    faceBtn.setAttribute("aria-expanded", "true");
    setTimeout(() => { document.addEventListener("mousedown", onFaceAway, true); document.addEventListener("keydown", onFaceKey, true); }, 0);
  }
  faceBtn.addEventListener("click", openFaceMenu);

  // ── + ADD NEW: an avatar made by the Images power in the mascot's style.
  //    One fixed size; Generate as often as wanted; Use it puts the picture on
  //    the form (Save keeps it). The hard guards run in main (avatar-guard). ──
  let avatarModal: HTMLElement | null = null;
  function closeAvatarModal(): void {
    if (!avatarModal) return;
    avatarModal.remove();
    avatarModal = null;
    guardWebviewsForModal(false);
    document.removeEventListener("keydown", onAvatarKey, true);
  }
  function onAvatarKey(e: KeyboardEvent): void { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeAvatarModal(); } }
  function openAvatarModal(): void {
    if (avatarModal) return;
    const gen = api().avatarGenerate;
    const m = el("div", "confirm-overlay botp-modal botp-avatar-modal");
    m.innerHTML = `
      <div class="confirm-box botp-modal-box botp-avatar-box" role="dialog" aria-modal="true" aria-label="New avatar">
        <div class="confirm-head botp-modal-head"><h3>New avatar</h3>
          <button class="ws-icon-btn botp-modal-x" type="button" title="Close" aria-label="Close">${CLOSE_SVG}</button></div>
        <div class="confirm-body botp-avatar-body">
          <div class="botp-avatar-stage"><div class="botp-avatar-preview"></div></div>
          <label class="settings-label">Describe it</label>
          <textarea class="settings-input botp-avatar-ask" rows="4" maxlength="300" spellcheck="true" placeholder="Wearing goggles, holding a tiny wrench"></textarea>
          <div class="botp-avatar-note">Drawn in the Glyphh mascot's style by your image model. Friendly characters only: anything inappropriate is refused.</div>
          <div class="crud-form-error botp-error botp-avatar-error hidden"></div>
        </div>
        <div class="confirm-foot">
          <button class="action-btn secondary botp-avatar-cancel" type="button">Cancel</button>
          <button class="action-btn secondary botp-avatar-gen" type="button">Generate</button>
          <button class="action-btn primary botp-avatar-use" type="button" disabled>Use it</button>
        </div>
      </div>`;
    const qa = <T extends HTMLElement>(sel: string): T => m.querySelector<T>(sel)!;
    const preview = qa<HTMLElement>(".botp-avatar-preview");
    const askIn = qa<HTMLTextAreaElement>(".botp-avatar-ask");
    const err = qa<HTMLElement>(".botp-avatar-error");
    const genBtn = qa<HTMLButtonElement>(".botp-avatar-gen");
    const useBtn = qa<HTMLButtonElement>(".botp-avatar-use");
    let made = "";
    const paintPreview = (): void => { preview.innerHTML = botAvatarSvg(made ? { ...picked, image: made } : picked, "idle", { size: 160 }); };
    paintPreview();
    askIn.value = avatarStarter(nameIn.value, descIn.value);
    if (!gen) {
      showErr(err, "Avatar pictures are made in the Glyphh desktop app.");
      genBtn.disabled = true;
    }
    genBtn.addEventListener("click", async () => {
      if (!gen || genBtn.disabled) return;
      showErr(err, "");
      genBtn.disabled = true; useBtn.disabled = true;
      genBtn.textContent = "Generating…";
      preview.classList.add("busy");
      const r = await gen({ name: nameIn.value.trim(), description: descIn.value.trim(), prompt: askIn.value.trim() })
        .catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
      if (!avatarModal) return;
      preview.classList.remove("busy");
      genBtn.disabled = false;
      genBtn.textContent = made ? "Generate again" : "Generate";
      if (!r.ok) { showErr(err, r.error); useBtn.disabled = !made; return; }
      made = r.data.image;
      genBtn.textContent = "Generate again";
      useBtn.disabled = false;
      paintPreview();
    });
    useBtn.addEventListener("click", () => {
      if (!made) return;
      picked = { variant: picked.variant, color: picked.color, image: made };
      paintFaceBtn();
      paintHead();
      closeAvatarModal();
    });
    qa(".botp-modal-x").addEventListener("click", closeAvatarModal);
    qa(".botp-avatar-cancel").addEventListener("click", closeAvatarModal);
    m.addEventListener("mousedown", (e) => { if (e.target === m) closeAvatarModal(); });
    document.addEventListener("keydown", onAvatarKey, true);
    guardWebviewsForModal(true);
    document.body.appendChild(m);
    avatarModal = m;
    askIn.focus();
  }

  function fillForm(): void {
    if (!bot) return;
    nameIn.value = bot.name;
    descIn.value = bot.description ?? "";
    briefIn.value = bot.prompt ?? "";
    picked = avatarOf({ slug: bot.slug, avatar: bot.avatar });
    paintFaceBtn();
    paintHead();
  }

  async function save(): Promise<void> {
    if (!bot) return;
    const input = { name: nameIn.value.trim(), description: descIn.value.trim(), prompt: briefIn.value.trim(), avatar: picked };
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
    const input = { name: nameIn.value.trim(), description: descIn.value.trim(), model: bot?.model ?? "", draft: briefIn.value.trim() };
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
  const EMPTY_TEXT: Record<PowerKind, string> = {
    folders: "No folders yet.",
    connections: "No connections yet.",
    models: "No models yet. It runs on the main agent's.",
    skills: "None yet.",
  };
  interface PowerItem { icon: string; name: string; sub: string; tag?: string; stored?: string }
  // OPEN OR SHUT, REMEMBERED (his order, 2026-10-09: "collapse all these on
  // load, except for folders as a default. Remember the state the user left
  // it in"): one preference, the kinds that are shut.
  const COLLAPSED_PREF = "botPowersCollapsed";
  const collapsed = new Set<PowerKind>(DEFAULT_COLLAPSED);
  const applyCollapsed = (): void => {
    for (const [kind, s] of sections) {
      s.root.classList.toggle("collapsed", collapsed.has(kind));
      s.root.querySelector(".botp-sec-toggle")?.setAttribute("aria-expanded", String(!collapsed.has(kind)));
    }
  };
  void (async () => {
    const saved = await (api() as { getPreference?: (k: string, d?: unknown) => Promise<unknown> }).getPreference?.(COLLAPSED_PREF, null)?.catch(() => null);
    if (!Array.isArray(saved) || destroyed) return;
    collapsed.clear();
    for (const k of saved) if (POWER_KINDS.some((p) => p.kind === k)) collapsed.add(k as PowerKind);
    applyCollapsed();
  })();
  const sections = new Map<PowerKind, { root: HTMLElement; count: HTMLElement; list: HTMLElement; search: HTMLInputElement }>();

  function connOf(slug: string): PlusConnectorRow | undefined { return conns.find((c) => c.slug === slug); }
  function skillOf(id: string): { id: string; name: string; type?: string } | undefined { return skills.find((s) => s.id === id); }

  /** What one section lists for the bot as saved. */
  function itemsOf(kind: PowerKind): PowerItem[] {
    if (!bot) return [];
    if (kind === "folders") return powersOf(bot, "folders").map((f, i) => ({ icon: PLUS_ICONS.folder, name: baseName(f), sub: f, stored: f, ...(i === 0 ? { tag: "Works here" } : {}) }));
    if (kind === "connections") return powersOf(bot, "connections").map((c) => { const k = connOf(c); return { icon: k?.icon ?? PLUS_ICONS.connectors, name: k?.name ?? c, sub: k?.on ? "Connected" : "Not connected", stored: c }; });
    if (kind === "models") return modelList(bot).map((m, i) => ({ icon: MODEL_SVG, name: modelName(m), sub: "", stored: m, ...(i === 0 ? { tag: "Runs on" } : {}) }));
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
        applyCollapsed();
        (api() as { setPreference?: (k: string, v: unknown) => void }).setPreference?.(COLLAPSED_PREF, [...collapsed]);
      });
      const plus = el("button", "ws-icon-btn botp-sec-add");
      plus.type = "button"; plus.title = `Add to ${label}`; plus.setAttribute("aria-label", `Add to ${label}`);
      plus.innerHTML = PLUS_SVG;
      plus.addEventListener("click", () => openModal(kind));
      head.append(toggle, plus);
      const body = el("div", "botp-sec-body");
      const search = el("div", "skills-search botp-sec-search");
      search.innerHTML = SEARCH_SVG;
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
    applyCollapsed();
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
      models: modelList(bot).slice(1), skills: powersOf(bot, "skills"),
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
  /** Flip one pick in the draft. Models move as one list: the first picked runs it. */
  function toggleDraft(kind: PowerKind, name: string): void {
    if (!draft) return;
    if (kind === "models") {
      const cur = modelList(draft);
      Object.assign(draft, modelFields(cur.includes(name) ? cur.filter((m) => m !== name) : [...cur, name]));
      paintModal();
      return;
    }
    const cur = powersOf(draft, kind);
    draft[kind] = cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name];
    paintModal();
  }
  async function saveModal(): Promise<void> {
    if (!modal || !draft || !bot) return;
    const patch: Record<string, unknown> = {};
    for (const { kind } of POWER_KINDS) {
      if (kind === "models") continue;
      if (JSON.stringify(powersOf(draft, kind)) !== JSON.stringify(powersOf(bot, kind))) patch[kind] = powersOf(draft, kind);
    }
    if (JSON.stringify(modelList(draft)) !== JSON.stringify(modelList(bot))) Object.assign(patch, modelFields(modelList(draft)));
    if (!Object.keys(patch).length) { closeModal(); return; }
    const save = modal.querySelector<HTMLButtonElement>(".botp-modal-save")!;
    save.disabled = true;
    const r = await api().libraryAgentUpdate?.(bot.slug, patch).catch((e: unknown): Envelope => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!modal) return;
    save.disabled = false;
    if (!r?.ok) { showErr(modal.querySelector<HTMLElement>(".botp-modal-error")!, r?.error || "The powers could not be saved."); return; }
    bot = { ...bot, ...(patch as Partial<BotRow>) };
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
    if (fixed) row.appendChild(el("span", "botp-power-tag", fixed));
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
      const have = modelList(d);
      if (!models.length) empty("Your team's models couldn't be read.");
      for (const m of models) {
        body.appendChild(choice(MODEL_SVG, m.name, "", have.includes(m.id), () => toggleDraft("models", m.id), have[0] === m.id ? "Runs on" : undefined));
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
