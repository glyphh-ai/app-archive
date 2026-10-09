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

import { clearInvalid, confirmAction, escapeHtml, guardWebviewsForModal } from "./shared.js";
import { safeIconUrl } from "./model-info.js";
import { AVATAR_COLORS, AVATAR_VARIANTS, DEFAULT_VARIANT, avatarOf, botAvatarSvg, type BotAvatar } from "./bot-avatar.js";
import { PLUS_ICONS, readConnectorRows, type PlusApi, type PlusConnectorRow } from "./composer-plus.js";
import { primeConnectedIcons } from "./app-icon.js";
import { openPowersModal } from "./powers-modal.js";
import { mountPowerMap, type MapGroup, type PowerMapModel } from "./power-map.js";
import { cronToWords } from "./schedules.js";
import { createGlyphhSpinner } from "../glyphh-spinner.js";

export interface BotVoice { model: string; voiceId: string; name?: string }
export interface BotRow {
  slug: string; name: string; description: string; prompt: string; model: string;
  personality?: number; directness?: number; temperament?: number; effort?: string; voice?: BotVoice | null;
  /** Model → dollars a month; absent = no limit (the gateway enforces it). */
  modelCaps?: Record<string, number>;
  avatar: BotAvatar | null;
  folders?: string[]; connections?: string[]; models?: string[]; skills?: string[];
  /** The other super powers it holds (2026-10-09). */
  superPowers?: string[];
}
type PowerTabName = "folders" | "connections" | "models" | "skills" | "superPowers";
interface Envelope { ok: boolean; data?: unknown; error?: string }
interface LoopModel { id: string; name: string; utility?: boolean }
interface Api extends PlusApi {
  voiceSettingsGet?: () => Promise<unknown>;
  voiceConfig?: () => Promise<unknown>;
  catalogModels?: () => Promise<unknown>;
  catalogVoices?: (provider: string) => Promise<unknown>;
  voiceSynthesize?: (text: string, model: string, voiceId: string | null) => Promise<unknown>;
  libraryAgentGet?: (ref: string) => Promise<Envelope>;
  libraryAgentUpdate?: (ref: string, patch: unknown) => Promise<Envelope>;
  libraryAgentDelete?: (ref: string) => Promise<Envelope>;
  loopModels?: (loopId: string, force?: boolean) => Promise<{ ok: boolean; models: LoopModel[] }>;
  agentBriefGenerate?: (input: { name?: string; description?: string; model?: string; draft?: string }) =>
    Promise<{ ok: true; brief: string; model: string } | { ok: false; error: string }>;
  pickDirectory?: () => Promise<string | null>;
  avatarGenerateStop?: () => Promise<unknown>;
  avatarGenerate?: (input: { name?: string; description?: string; prompt?: string; model?: string }) =>
    Promise<{ ok: true; data: { image: string; model: string; usd: number; prompt: string } } | { ok: false; error: string }>;
  getWorkingDirRecents?: () => Promise<string[]>;
  modelsCatalog?: () => Promise<{ ok: boolean; data: unknown[]; error?: string }>;
  /** A power that runs on its own: its schedule and slots (task-runner.ts getTaskSpec). */
  taskSpec?: (slug: string) => Promise<Envelope>;
}
export interface BotPageHandle { back(): boolean; destroy(): void }
export type PowerKind = "folders" | "connections" | "models" | "skills" | "superPowers";
/** Shut on first open: everything but Folders. */
export const DEFAULT_COLLAPSED: ReadonlyArray<PowerKind> = Object.freeze(["connections", "models", "skills", "superPowers"]);

/** The sliders' stops (his order, 2026-10-09). Effort maps onto the loop's dial. */
export const PERSONALITY_LABELS: ReadonlyArray<string> = Object.freeze(["Serious", "Calm", "Balanced", "Warm", "Playful"]);
export const EFFORTS: ReadonlyArray<string> = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
export const EFFORT_LABELS: ReadonlyArray<string> = Object.freeze(["Fastest", "Faster", "Balanced", "Deeper", "Deepest"]);
/** TWO MORE SLIDERS (his order, 2026-10-09: "Gentle -> Blunt and Kind -> Spicy why not both?"). */
export const DIRECTNESS_LABELS: ReadonlyArray<string> = Object.freeze(["Gentle", "Tactful", "Balanced", "Frank", "Blunt"]);
export const TEMPERAMENT_LABELS: ReadonlyArray<string> = Object.freeze(["Kind", "Friendly", "Balanced", "Sassy", "Spicy"]);
interface VoiceOption { id: string; name: string; providerSlug?: string; previewUrl?: string; category?: string }
/** The voice a super power wears until one is picked: the member's own when
 *  the model offers it, else the model's first. */
export function defaultVoiceOf(voices: ReadonlyArray<{ id: string; name: string }>, model: string, mine: string): BotVoice | null {
  const v = voices.find((x) => x.id === mine) ?? voices[0];
  return v ? { model, voiceId: v.id, name: v.name } : null;
}
/** Desktop IPC answers raw; the web contract wraps it in { ok, data }. */
function unwrap<T>(res: unknown): T | null {
  if (res && typeof res === "object" && "data" in (res as object) && "ok" in (res as object)) return ((res as { data?: T }).data ?? null);
  return (res as T) ?? null;
}
function asBytes(res: unknown): ArrayBuffer | null {
  const r = unwrap<unknown>(res);
  if (r instanceof ArrayBuffer) return r;
  if (ArrayBuffer.isView(r)) return (r as ArrayBufferView).buffer as ArrayBuffer;
  return null;
}
const PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>`;
const api = (): Api => ((window as unknown as { glyphh?: Api }).glyphh ?? {});
const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
const CLOSE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
const WAND_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M12.2 6.2 11 5"/><path d="m15 9-12 12"/></svg>`;
const MODEL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>`;
const POWER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>`;
/** A program's flow on the map: its clock, and each slot it hands work to. */
const CLOCK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;
const SLOT_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h11"/><path d="m12 7 5 5-5 5"/><circle cx="20" cy="12" r="1.5"/></svg>`;

/** The kinds, in the order the page and the modal show them. */
export const POWER_KINDS: ReadonlyArray<{ kind: PowerKind; label: string }> = Object.freeze([
  { kind: "folders", label: "Folders" },
  { kind: "connections", label: "Connections" },
  { kind: "models", label: "Models" },
  { kind: "skills", label: "Your powers" },
  // SUPER POWERS HOLD SUPER POWERS (his order, 2026-10-09).
  { kind: "superPowers", label: "Super powers" },
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
/** The fields a model list is saved as: it runs on the first CHAT model
 *  (an image or speech model is a power it uses, never what it runs on). */
export function modelFields(list: string[], isChat: (name: string) => boolean = () => true): { model: string; models: string[] } {
  const model = list.find(isChat) ?? "";
  return { model, models: list.filter((m) => m !== model) };
}
/** The caps kept for a model list: only models still on it, positive dollars only. */
export function capsFor(list: string[], caps: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of list) { const v = Number(caps?.[m]); if (Number.isFinite(v) && v > 0) out[m] = v; }
  return out;
}

/** The patch that adds (on) or removes (off) one power. Models move as one
 *  list: the first added runs it, and removing that one hands it to the next. */
export function powerPatch(bot: Pick<BotRow, PowerKind | "model" | "modelCaps">, kind: PowerKind, name: string, on: boolean, isChat?: (name: string) => boolean): Record<string, unknown> {
  if (kind === "models") {
    const cur = modelList(bot).filter((m) => m !== name);
    const list = on ? [...cur, name] : cur;
    return { ...modelFields(list, isChat), modelCaps: capsFor(list, bot.modelCaps) };
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

/** `onDeleted`: where the member lands after Delete (his order, 2026-10-09: "the
 *  screen should go back to the home default"); without it, Delete just closes. */
export function mountBotPage(host: HTMLElement, opts: { slug: string; onClose: () => void; onDeleted?: () => void }): BotPageHandle {
  host.classList.add("botp-host");
  const root = el("div", "botp");
  host.appendChild(root);
  /** GLYPHH'S OWN RECORD is edited here too (slug "glyphh", shared GLYPHH_AGENT). */
  const isGlyphh = opts.slug === "glyphh";
  let bot: BotRow | null = null;
  let models: LoopModel[] = [];
  /** Each model's logo, from the server's catalog (models-catalog). */
  const modelIcons = new Map<string, string>();
  let conns: PlusConnectorRow[] = [];
  /** Every super power, for this one's Super powers section (face, name). */
  let roster: Array<{ slug: string; name: string; avatar: BotAvatar | null }> = [];
  const readRoster = async (): Promise<typeof roster> => {
    const env = await (api() as { libraryAgentsList?: () => Promise<Envelope> }).libraryAgentsList?.().catch(() => null);
    return (env?.ok && Array.isArray(env.data) ? env.data as Array<Record<string, unknown>> : [])
      .map((a) => ({ slug: String(a.slug ?? ""), name: String(a.name ?? a.slug ?? ""), avatar: (a.avatar as BotAvatar | null) ?? null }))
      .filter((a) => a.slug);
  };
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

  // A logo that won't load falls back to the chip glyph (error does not bubble: capture it).
  root.addEventListener("error", (e) => {
    const img = e.target as HTMLElement | null;
    if (img instanceof HTMLImageElement && img.classList.contains("powm-model-img")) img.outerHTML = MODEL_SVG;
  }, true);
  // THE MAP (his order, 2026-10-09: "the top portion of the page needs a new
  // sick sick react flow esc view of a super power"): help/power-map.ts. A
  // node opens in the powers modal; the circle adds a power.
  const mapHost = el("div", "botp-map");
  root.appendChild(mapHost);
  const map = mountPowerMap(mapHost, {
    onOpen: (kind, stored) => openModal(kind, stored),
    onAdd: () => openModal(),
  });
  const grid = el("div", "botp-grid");
  root.appendChild(grid);
  // THE LOADING SCREEN (his order, 2026-10-09: "the edit super power needs to
  // use a loading screen"): the app's Glyphh loader over the page until the
  // super power, its powers and their logos are read.
  const loading = el("div", "botp-loading");
  const spin = createGlyphhSpinner({ size: 64 });
  spin.setMeta("Loading your super power");
  loading.appendChild(spin.el);
  root.appendChild(loading);
  const doneLoading = (): void => {
    if (!loading.isConnected) return;
    loading.classList.add("gone");
    window.setTimeout(() => { spin.destroy(); loading.remove(); }, 220);
  };
  const form = el("div", "botp-form");
  const side = el("div", "botp-powers");
  grid.append(form, side);

  // ── LEFT: the form as it was ──
  form.innerHTML = `
    <div class="crud-form-error botp-error hidden"></div>
    <div class="edit-head botp-head"></div>
    <label class="settings-label">Identity</label>
    <div class="botp-name-row">
      <button type="button" class="botp-face-btn" aria-haspopup="menu" aria-expanded="false" title="Change the avatar"></button>
      <span class="botp-voice-wrap">
        <button type="button" class="ws-icon-btn botp-voice-test" title="Hear this voice" aria-label="Hear this voice"></button>
        <button type="button" class="botp-voice-btn" aria-haspopup="menu" aria-expanded="false" title="Change the voice"></button>
      </span>
      <input type="text" class="settings-input botp-name" aria-label="Name" placeholder="Researcher" maxlength="80" spellcheck="false" autocomplete="off" />
    </div>
    <label class="settings-label">When to use it</label>
    <input type="text" class="settings-input botp-desc" placeholder="Reads the web and reports facts with sources — the main agent reads this to decide what to hand over" maxlength="300" autocomplete="off" />
    <div class="botp-sliders">
      <div class="botp-slider">
        <div class="botp-slider-head"><label class="settings-label">Personality</label><span class="botp-slider-val botp-personality-val"></span></div>
        <input type="range" class="botp-range botp-personality" min="1" max="5" step="1" aria-label="Personality" />
        <div class="botp-slider-ends"><span>Serious</span><span>Playful</span></div>
      </div>
      <div class="botp-slider">
        <div class="botp-slider-head"><label class="settings-label">Directness</label><span class="botp-slider-val botp-directness-val"></span></div>
        <input type="range" class="botp-range botp-directness" min="1" max="5" step="1" aria-label="Directness" />
        <div class="botp-slider-ends"><span>Gentle</span><span>Blunt</span></div>
      </div>
      <div class="botp-slider">
        <div class="botp-slider-head"><label class="settings-label">Temperament</label><span class="botp-slider-val botp-temperament-val"></span></div>
        <input type="range" class="botp-range botp-temperament" min="1" max="5" step="1" aria-label="Temperament" />
        <div class="botp-slider-ends"><span>Kind</span><span>Spicy</span></div>
      </div>
      <div class="botp-slider">
        <div class="botp-slider-head"><label class="settings-label">Thinking</label><span class="botp-slider-val botp-effort-val"></span></div>
        <input type="range" class="botp-range botp-effort" min="1" max="5" step="1" aria-label="Thinking: speed or effort" />
        <div class="botp-slider-ends"><span>Fast</span><span>Thorough</span></div>
      </div>
    </div>
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
  const voiceBtn = q<HTMLButtonElement>(".botp-voice-btn");
  const voiceTest = q<HTMLButtonElement>(".botp-voice-test");
  // THE SLIDERS (his order, 2026-10-09: "personality, thinking effort or speed").
  const persIn = q<HTMLInputElement>(".botp-personality");
  const effortIn = q<HTMLInputElement>(".botp-effort");
  const directIn = q<HTMLInputElement>(".botp-directness");
  const tempIn = q<HTMLInputElement>(".botp-temperament");
  let effortTouched = false;
  const paintSliders = (): void => {
    q<HTMLElement>(".botp-personality-val").textContent = PERSONALITY_LABELS[Number(persIn.value) - 1] ?? "";
    q<HTMLElement>(".botp-directness-val").textContent = DIRECTNESS_LABELS[Number(directIn.value) - 1] ?? "";
    q<HTMLElement>(".botp-temperament-val").textContent = TEMPERAMENT_LABELS[Number(tempIn.value) - 1] ?? "";
    q<HTMLElement>(".botp-effort-val").textContent = EFFORT_LABELS[Number(effortIn.value) - 1] ?? "";
    for (const r of [persIn, directIn, tempIn, effortIn]) r.style.setProperty("--fill", `${((Number(r.value) - 1) / 4) * 100}%`);
  };
  persIn.addEventListener("input", paintSliders);
  directIn.addEventListener("input", paintSliders);
  tempIn.addEventListener("input", paintSliders);
  effortIn.addEventListener("input", () => { effortTouched = true; paintSliders(); });
  /** The voice it speaks in (null = yours); picked in the avatar dropdown, kept on Save. */
  let pickedVoice: BotVoice | null = null;
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
    // The name alone: the avatar is on the row below (his order, 2026-10-09).
    head.append(el("div", "edit-head-name", nameIn.value.trim() || bot?.name || "Super power"));
  }
  const CARET_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  /** THE AVATAR, LEFT OF THE NAME, AS A DROPDOWN (his order, 2026-10-09):
   *  the sixteen faces, the picture it wears if one was made, + Add new. */
  function paintFaceBtn(): void {
    // Glyphh wears its own mark, always (his order, 2026-10-09: "a fixed… face").
    if (isGlyphh) { faceBtn.innerHTML = `<span class="botp-face-mark"><img src="brand/glyphh-mark.png" alt="" width="40" height="40" draggable="false" /></span>`; return; }
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
  faceBtn.addEventListener("click", () => { if (!isGlyphh) openFaceMenu(); });
  // GLYPHH'S PAGE (his order, 2026-10-09): no Delete, a fixed face, a free name.
  if (isGlyphh) {
    // Hidden, not removed: the page wires every control by its selector.
    q<HTMLElement>(".botp-delete").hidden = true;
    faceBtn.disabled = true;
    faceBtn.title = "Glyphh";
  }

  // ── THE VOICE, its own dropdown on the identity row (his order, 2026-10-09:
  //    "that row is the agent's identity: Avatar -> voice -> name"). The
  //    voices are the ones your speech model offers; ▶ plays a sample. ──
  const SPEAKER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;
  const voiceLabel = (): string => pickedVoice?.name || pickedVoice?.voiceId || (voiceList && "error" in voiceList ? "No voice" : "Voice…");
  function paintVoiceBtn(): void {
    voiceBtn.innerHTML = `<span class="botp-voice-icon">${SPEAKER_SVG}</span><span class="botp-voice-btn-name"></span><span class="botp-face-caret">${CARET_SVG}</span>`;
    (voiceBtn.querySelector(".botp-voice-btn-name") as HTMLElement).textContent = voiceLabel();
  }
  let voiceMenu: HTMLElement | null = null;
  function closeVoiceMenu(): void {
    stopPreview();
    voiceMenu?.remove();
    voiceMenu = null;
    voiceBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", onVoiceAway, true);
    document.removeEventListener("keydown", onVoiceKey, true);
  }
  function onVoiceAway(e: MouseEvent): void {
    if (voiceMenu && !voiceMenu.contains(e.target as Node) && !voiceBtn.contains(e.target as Node)) closeVoiceMenu();
  }
  function onVoiceKey(e: KeyboardEvent): void { if (e.key === "Escape") { e.stopPropagation(); closeVoiceMenu(); } }
  function openVoiceMenu(): void {
    if (voiceMenu) { closeVoiceMenu(); return; }
    const m = el("div", "botp-face-menu botp-voice-menu");
    m.setAttribute("role", "menu");
    m.appendChild(voiceSection());
    document.body.appendChild(m);
    const r = voiceBtn.getBoundingClientRect();
    m.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8))}px`;
    m.style.top = `${Math.min(r.bottom + 6, window.innerHeight - m.offsetHeight - 8)}px`;
    voiceMenu = m;
    voiceBtn.setAttribute("aria-expanded", "true");
    setTimeout(() => { document.addEventListener("mousedown", onVoiceAway, true); document.addEventListener("keydown", onVoiceKey, true); }, 0);
  }
  voiceBtn.addEventListener("click", openVoiceMenu);

  /** THE TEST (his order, 2026-10-09: "a small test icon above the voice so
   *  the user can hear it"): the super power says hello in the voice picked,
   *  or in yours when none is; a second press stops it. */
  const STOP_SVG = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>`;
  voiceTest.innerHTML = PLAY_SVG;
  async function testVoice(): Promise<void> {
    if (previewAudio || voiceTest.classList.contains("busy")) { stopPreview(); paintTest(); return; }
    showErr(errEl, "");
    let model = pickedVoice?.model ?? "";
    let voiceId: string | null = pickedVoice?.voiceId ?? null;
    if (!pickedVoice) {
      const a = api();
      const [vs, cfg] = await Promise.all([a.voiceSettingsGet?.().catch(() => null), a.voiceConfig?.().catch(() => null)]);
      const mine = unwrap<{ outputModel?: string | null; voiceId?: string | null }>(vs);
      const house = unwrap<{ tts?: string | null; voice?: string | null }>(cfg);
      model = String(mine?.outputModel || house?.tts || "").trim();
      voiceId = mine?.voiceId || house?.voice || null;
    }
    if (!model) { showErr(errEl, "Pick a speech model in Settings › Voice to hear a voice."); return; }
    voiceTest.classList.add("busy");
    try {
      const bytes = asBytes(await api().voiceSynthesize?.(`Hi, I'm ${nameIn.value.trim() || "your super power"}.`, model, voiceId));
      if (!bytes) throw new Error("no audio");
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      const au = new Audio(url);
      previewAudio = au;
      au.onended = au.onerror = () => { URL.revokeObjectURL(url); if (previewAudio === au) previewAudio = null; paintTest(); };
      voiceTest.classList.remove("busy");
      paintTest();
      await au.play();
    } catch {
      voiceTest.classList.remove("busy");
      previewAudio = null;
      showErr(errEl, "That voice couldn't be played. Try another one.");
    }
    paintTest();
  }
  function paintTest(): void {
    const on = !!previewAudio;
    voiceTest.innerHTML = on ? STOP_SVG : PLAY_SVG;
    voiceTest.title = on ? "Stop" : "Hear this voice";
    voiceTest.setAttribute("aria-label", voiceTest.title);
    voiceTest.classList.toggle("on", on);
  }
  voiceTest.addEventListener("click", () => { void testVoice(); });
  let voiceList: { model: string; voices: VoiceOption[] } | { error: string } | null = null;
  let previewAudio: HTMLAudioElement | null = null;
  const stopPreview = (): void => { try { previewAudio?.pause(); } catch { /* gone */ } previewAudio = null; paintTest(); };
  async function loadVoices(): Promise<void> {
    const a = api();
    const [vs, cfg] = await Promise.all([a.voiceSettingsGet?.().catch(() => null), a.voiceConfig?.().catch(() => null)]);
    const model = String(unwrap<{ outputModel?: string | null }>(vs)?.outputModel || unwrap<{ tts?: string | null }>(cfg)?.tts || "").trim();
    if (!model) { voiceList = { error: "Pick a speech model in Settings › Voice first." }; return; }
    const cat = unwrap<Array<{ id: string; providerSlug: string }>>(await a.catalogModels?.().catch(() => null));
    const provider = (Array.isArray(cat) ? cat.find((x) => x.id === model)?.providerSlug : undefined) || model.split("/")[0] || "";
    const voices = unwrap<VoiceOption[]>(await a.catalogVoices?.(provider).catch(() => null));
    voiceList = Array.isArray(voices) && voices.length ? { model, voices } : { error: "Your speech model has no voices to pick from." };
    if (Array.isArray(voices) && voices.length) {
      const mine = String(unwrap<{ voiceId?: string | null }>(vs)?.voiceId || unwrap<{ voice?: string | null }>(cfg)?.voice || "");
      defaultVoice = defaultVoiceOf(voices, model, mine);
    }
  }
  /** A super power always has a voice (his order, 2026-10-09: "default the
   *  voice instead of having a row called 'your voice'"): one never picked
   *  wears yours when your model offers it, else the model's first. */
  let defaultVoice: BotVoice | null = null;
  async function primeVoice(): Promise<void> {
    if (!voiceList) await loadVoices();
    if (!pickedVoice && defaultVoice) pickedVoice = defaultVoice;
    paintVoiceBtn();
  }
  async function preview(v: VoiceOption, model: string, btn: HTMLButtonElement): Promise<void> {
    stopPreview();
    btn.classList.add("busy");
    try {
      let src = v.previewUrl || "";
      if (!src) {
        const raw = await api().voiceSynthesize?.(`Hi, I'm ${nameIn.value.trim() || "a super power"}.`, model, v.id);
        const bytes = asBytes(raw);
        if (!bytes) throw new Error("no audio");
        src = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
      }
      const au = new Audio(src);
      previewAudio = au;
      await au.play();
    } catch { /* no sample: stay quiet */ }
    btn.classList.remove("busy");
  }
  function voiceSection(): HTMLElement {
    const sec = el("div", "botp-voice");
    const head = el("div", "botp-voice-head");
    head.append(el("span", "", "Voice"), el("span", "botp-voice-now", voiceLabel()));
    sec.appendChild(head);
    const list = el("div", "botp-voice-list");
    sec.appendChild(list);
    const paintList = (): void => {
      list.textContent = "";
      if (!voiceList) { list.appendChild(el("div", "botp-empty", "Loading voices…")); return; }
      if ("error" in voiceList) { list.appendChild(el("div", "botp-empty", voiceList.error)); return; }
      const vl = voiceList;
      const choose = (v: BotVoice | null): void => {
        pickedVoice = v;
        paintVoiceBtn();
        closeVoiceMenu();
      };
      for (const v of vl.voices) {
        const on = !!pickedVoice && pickedVoice.voiceId === v.id && pickedVoice.model === vl.model;
        const r = el("div", "botp-voice-row" + (on ? " on" : ""));
        r.setAttribute("role", "button");
        r.tabIndex = 0;
        const play = el("button", "ws-icon-btn botp-voice-play");
        play.type = "button"; play.title = `Hear ${v.name}`; play.setAttribute("aria-label", `Hear ${v.name}`);
        play.innerHTML = PLAY_SVG;
        play.addEventListener("click", (e) => { e.stopPropagation(); void preview(v, vl.model, play); });
        r.append(play, el("span", "botp-voice-name", v.name));
        if (v.category) r.appendChild(el("span", "botp-voice-cat", v.category));
        r.addEventListener("click", () => choose({ model: vl.model, voiceId: v.id, name: v.name }));
        r.addEventListener("keydown", (e) => { if (e.key === "Enter") choose({ model: vl.model, voiceId: v.id, name: v.name }); });
        list.appendChild(r);
      }
    };
    paintList();
    if (!voiceList) void loadVoices().then(() => { if (sec.isConnected) paintList(); });
    return sec;
  }

  // ── + ADD NEW: an avatar made by the Images power in the mascot's style.
  //    One fixed size; Generate as often as wanted; Use it puts the picture on
  //    the form (Save keeps it). The hard guards run in main (avatar-guard). ──
  let avatarModal: HTMLElement | null = null;
  function closeAvatarModal(): void {
    if (!avatarModal) return;
    if (avatarModal.querySelector(".botp-avatar-stop")) void api().avatarGenerateStop?.();
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
    // GENERATE TURNS INTO STOP while it works (his order, 2026-10-09: "needs a stop button here as well during generation").
    let generating = false;
    genBtn.addEventListener("click", async () => {
      if (!gen || genBtn.disabled) return;
      if (generating) { genBtn.disabled = true; genBtn.textContent = "Stopping…"; void api().avatarGenerateStop?.(); return; }
      showErr(err, "");
      generating = true;
      useBtn.disabled = true;
      genBtn.textContent = "Stop";
      genBtn.classList.add("botp-avatar-stop");
      preview.classList.add("busy");
      const r = await gen({ name: nameIn.value.trim(), description: descIn.value.trim(), prompt: askIn.value.trim() })
        .catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
      generating = false;
      if (!avatarModal) return;
      preview.classList.remove("busy");
      genBtn.disabled = false;
      genBtn.classList.remove("botp-avatar-stop");
      genBtn.textContent = made ? "Generate again" : "Generate";
      if (!r.ok) { if (r.error !== "Stopped.") showErr(err, r.error); useBtn.disabled = !made; return; }
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
    persIn.value = String(bot.personality ?? 3);
    directIn.value = String(bot.directness ?? 3);
    tempIn.value = String(bot.temperament ?? 3);
    const ei = EFFORTS.indexOf(String(bot.effort ?? ""));
    effortIn.value = String(ei >= 0 ? ei + 1 : 3);   // unset sits in the middle until moved
    effortTouched = false;
    pickedVoice = bot.voice ?? null;
    paintVoiceBtn();
    void primeVoice();
    paintSliders();
  }

  async function save(): Promise<void> {
    if (!bot) return;
    const input = {
      name: nameIn.value.trim(), description: descIn.value.trim(), prompt: briefIn.value.trim(), avatar: picked,
      personality: Number(persIn.value), directness: Number(directIn.value), temperament: Number(tempIn.value), voice: pickedVoice,
      // Untouched and never set, the effort stays the chat's own dial.
      ...(effortTouched || bot.effort ? { effort: EFFORTS[Number(effortIn.value) - 1] } : {}),
    };
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
    if (opts.onDeleted) opts.onDeleted(); else opts.onClose();
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
  nameIn.addEventListener("input", () => { paintHead(); paintMap(); showErr(briefErr, ""); });
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
    superPowers: "None yet. Add one it can hand work to.",
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
    if (kind === "superPowers") return powersOf(bot, "superPowers").map((slug) => {
      const r = roster.find((x) => x.slug === slug);
      return { icon: botAvatarSvg(avatarOf({ slug, avatar: r?.avatar ?? null }), "idle", { size: 24 }), name: r?.name ?? slug, sub: r ? "Hands work to it" : "Gone", stored: slug };
    });
    if (kind === "connections") return powersOf(bot, "connections").map((c) => { const k = connOf(c); return { icon: k?.icon ?? PLUS_ICONS.connectors, name: k?.name ?? c, sub: k?.on ? "Connected" : "Not connected", stored: c }; });
    if (kind === "models") {
      const caps = bot.modelCaps ?? {};
      return modelList(bot).map((m) => ({
        icon: modelIconOf(m), name: modelName(m), stored: m,
        sub: caps[m] ? `$${caps[m]}/month cap` : "No limit",
        ...(m === bot!.model ? { tag: "Runs on" } : {}),
      }));
    }
    return powersOf(bot, "skills").map((s) => { const k = skillOf(s); return { icon: POWER_SVG, name: k?.name ?? s, sub: k?.type === "task" ? "Task" : "Skill", stored: s }; });
  }

  /** THE MODEL'S LOGO from the server (his order, 2026-10-09: "they should be
   *  in the powers section and in the modal"); the chip glyph without one. */
  function modelIconOf(name: string): string {
    const url = safeIconUrl(modelIcons.get(name));
    return url ? `<img class="powm-model-img" src="${escapeHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false" />` : MODEL_SVG;
  }

  function powerRow(kind: PowerKind, it: PowerItem): HTMLElement {
    const row = el("div", "botp-power");
    // A power opens in the powers modal (his order, 2026-10-09).
    if (it.stored !== undefined) {
      const stored = it.stored;
      row.classList.add("openable");
      row.title = `Open ${it.name}`;
      row.addEventListener("click", (e) => { if (!(e.target as HTMLElement).closest(".botp-power-remove")) openModal(kind, stored); });
    }
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
    paintMap();
  }

  /** A power that runs on its own: its flow (schedule, then each slot), read once. */
  const flows = new Map<string, Array<{ name: string; sub: string; icon: string }>>();
  const flowAsked = new Set<string>();
  function flowOf(id: string): Array<{ name: string; sub: string; icon: string }> | undefined {
    const k = skillOf(id);
    if (k?.type !== "task") return undefined;
    if (!flowAsked.has(id)) {
      flowAsked.add(id);
      void api().taskSpec?.(id.slice(id.indexOf(":") + 1)).then((r) => {
        const spec = r?.ok ? r.data as { schedule?: string | null; slots?: Array<{ name: string; label?: string; agent: string | null }> } : null;
        if (!spec || destroyed) return;
        const steps: Array<{ name: string; sub: string; icon: string }> = [];
        if (spec.schedule) steps.push({ name: cronToWords(spec.schedule) || spec.schedule, sub: "On a clock", icon: CLOCK_SVG });
        for (const sl of spec.slots ?? []) steps.push({ name: sl.label || sl.name, sub: sl.agent ? `Hands it to ${sl.agent}` : "Hands it to Glyphh", icon: SLOT_SVG });
        flows.set(id, steps.length ? steps : [{ name: "Runs on its own", sub: "When it's called", icon: CLOCK_SVG }]);
        paintMap();
      }).catch(() => { /* no flow drawn */ });
    }
    return flows.get(id);
  }

  /** The map's model: what the bot holds, in the same words the sections use. */
  function paintMap(): void {
    if (!bot) return;
    const group = (kind: PowerKind, label: string): MapGroup => ({
      kind, label,
      nodes: itemsOf(kind).map((it) => ({
        stored: it.stored ?? it.name, name: it.name, sub: it.tag ?? it.sub, icon: it.icon,
        ...(kind === "connections" && it.sub === "Not connected" ? { muted: true } : {}),
        ...(kind === "skills" && it.stored ? { flow: flowOf(it.stored) } : {}),
      })),
    });
    const model: PowerMapModel = {
      center: { name: nameIn.value.trim() || bot.name, face: isGlyphh ? `<img src="brand/glyphh-mark.png" alt="" width="84" height="84" draggable="false" />` : botAvatarSvg(picked, "idle", { size: 84 }) },
      groups: [group("connections", "Connections"), group("folders", "Folders"), group("superPowers", "Super powers"), group("skills", "Powers"), group("models", "Models")],
    };
    map.update(model);
  }

  /** Remove one power from the list, saved at once. */
  async function setPower(kind: PowerKind, name: string, on: boolean): Promise<void> {
    if (!bot) return;
    const chat = new Set(models.map((m) => m.id));
    const patch = powerPatch(bot, kind, name, on, (n) => chat.has(n));
    const r = await api().libraryAgentUpdate?.(bot.slug, patch).catch((e: unknown): Envelope => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    if (!r?.ok) { showErr(sideErr, r?.error || "The power could not be saved."); return; }
    showErr(sideErr, "");
    bot = { ...bot, ...(patch as Partial<BotRow>) };
    paintPowers();
  }

  // ── + ADD A POWER: the one powers modal (help/powers-modal.ts), picking for
  //    this super power; Save writes the picks in one update. ──
  function openModal(kind?: PowerKind, focus?: string): void {
    if (!bot) return;
    const b = bot;
    openPowersModal({
      ...(kind ? { tab: kind } : {}),
      ...(kind && focus ? { focus: { tab: kind as PowerTabName, name: focus } } : {}),
      selection: { folders: powersOf(b, "folders"), connections: powersOf(b, "connections"), models: modelList(b), skills: powersOf(b, "skills"), superPowers: powersOf(b, "superPowers"), modelCaps: { ...(b.modelCaps ?? {}) } },
      self: b.slug,
      onSave: async (picked) => {
        if (!bot) return { ok: false, error: "This super power is gone." };
        const patch: Record<string, unknown> = {};
        for (const k of ["folders", "connections", "skills", "superPowers"] as const) {
          if (JSON.stringify(picked[k]) !== JSON.stringify(powersOf(bot, k))) patch[k] = picked[k];
        }
        // It runs on its first chat model; the team's chat list is `models` here.
        const chat = new Set(models.map((m) => m.id));
        const isChat = (n: string): boolean => chat.has(n);
        const fields = modelFields(picked.models, isChat);
        if (fields.model !== (bot.model ?? "") || JSON.stringify(fields.models) !== JSON.stringify(powersOf(bot, "models").filter((m) => m !== bot!.model))) Object.assign(patch, fields);
        const caps = capsFor(picked.models, picked.modelCaps);
        if (JSON.stringify(caps) !== JSON.stringify(capsFor(modelList(bot), bot.modelCaps))) patch.modelCaps = caps;
        // A connection made inside the modal is new to this page's list too.
        conns = await readConnectorRows(api()).catch(() => conns);
        if (Object.keys(patch).length) {
          const r = await api().libraryAgentUpdate?.(bot.slug, patch).catch((e: unknown): Envelope => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          if (!r?.ok) return { ok: false, error: r?.error || "The powers could not be saved." };
          bot = { ...bot, ...(patch as Partial<BotRow>) };
        }
        showErr(sideErr, "");
        paintPowers();
        return { ok: true };
      },
    });
  }

  // ── Load ──
  void (async () => {
    const [got, ms, cs, sk, cat] = await Promise.all([
      api().libraryAgentGet?.(opts.slug).catch((e: unknown): Envelope => ({ ok: false, error: e instanceof Error ? e.message : String(e) })),
      api().loopModels?.("glyphh").catch(() => null),
      readConnectorRows(api()).catch(() => [] as PlusConnectorRow[]),
      api().skillsList?.(["skill", "task"]).catch(() => null),
      api().modelsCatalog?.().catch(() => null),
    ]);
    for (const m of (cat?.ok && Array.isArray(cat.data) ? cat.data : []) as Array<{ name?: string; iconUrl?: string | null }>) {
      if (m && typeof m.name === "string" && m.iconUrl) modelIcons.set(m.name, m.iconUrl);
    }
    if (destroyed) return;
    // Glyphh's record is made the first time its page opens.
    let row = got?.ok ? got.data : null;
    if (!row && isGlyphh) {
      const made = await api().libraryAgentUpdate?.("glyphh", { name: "Glyphh" }).catch(() => null);
      row = made?.ok ? made.data : null;
    }
    if (destroyed) return;
    if (!row) { doneLoading(); showErr(errEl, got?.error || "This super power could not be read."); return; }
    bot = row as BotRow;
    models = ms?.ok ? ms.models.filter((m) => !m.utility) : [];
    conns = cs;
    skills = sk?.ok && Array.isArray(sk.data) ? (sk.data as Array<{ id: string; name: string; type?: string }>) : [];
    roster = await readRoster();
    fillForm();
    paintPowers();
    doneLoading();
    void primeConnectedIcons(conns.filter((r) => r.prime).map((r) => ({ connection: r.prime! })), () => {
      if (destroyed) return;
      void readConnectorRows(api()).then((rows) => { conns = rows; paintPowers(); }).catch(() => {});
    });
    nameIn.focus();
  })();

  return {
    back: () => false,
    destroy: () => { destroyed = true; stopPreview(); spin.destroy(); map.destroy(); root.remove(); host.classList.remove("botp-host"); },
  };
}
