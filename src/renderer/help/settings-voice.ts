/**
 * settings-voice.ts — Settings → General → Voice (his order, 2026-10-07): the
 * member picks their microphone mode, whether replies are read aloud, and the
 * voice they hear, on BOTH surfaces through the same doors —
 * `window.glyphh.voiceSettingsGet/Set` (the SDK's profile.voiceSettings) and
 * `window.glyphh.voiceConfig()` (the super admin's flagged speech models +
 * the curated `voices` list for the speech model).
 *
 * The composer (voice-mic.ts voicePref) merges the member's picks over the
 * admin's models; this page only WRITES the member's side and tells the
 * composer to repaint. A switch per mode the composer's mic menu offers
 * (push-to-talk ⇄ continuous), a switch for autoplay, a select for the voice
 * (empty = the admin's default), and the microphone device select the old
 * Settings › Voice page carried (enumerateDevices, no permission prompt here).
 */

import { refreshMicChip, refreshSpeakToggle } from "./voice-mic.js";
import { keepIfHost } from "./web-surface.js";

export type VoiceMode = "off" | "push-to-talk" | "continuous";

export interface VoiceConfigView { stt: string | null; tts: string | null; voice: string | null; voices: string[] }
export interface VoicePrefView {
  mode?: VoiceMode;
  voiceId?: string | null;
  deviceId?: string | null;
  autoplay?: boolean;
}

/** What the section paints — the pure answer the DOM and the test both read. */
export interface VoiceSectionModel {
  /** Microphone switch: on unless the member turned it off (the SDK default is push-to-talk). */
  micOn: boolean;
  /** Hands-free switch: continuous mode; disabled while the mic is off. */
  handsFree: boolean;
  /** Speak-replies switch, and why it is locked when it is. */
  speakOn: boolean;
  speakLocked: boolean;
  speakNote: string | null;
  /** The voice dropdown's options, or null when the admin listed none. */
  voiceOptions: Array<{ value: string; label: string }> | null;
  /** The muted line that stands in for an empty dropdown. */
  voicesLine: string | null;
  /** The dropdown's current value ("" = the admin's default). */
  voiceValue: string;
}

export const NO_SPEECH_MODEL_LINE = "No speech model is set up for your organization.";
export const NO_VOICES_LINE = "Your admin has not listed voices for the speech model yet.";

/** Unwrap a door's answer: the desktop hands the object raw, the web's
 *  contract wraps it ({ok, data}). Never throws on a bad shape. */
function unwrap(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  if ("ok" in o && "data" in o) return (o.data && typeof o.data === "object" ? o.data : {}) as Record<string, unknown>;
  return o;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The admin's speech config; a missing `voices` reads as []. */
export function readVoiceConfig(raw: unknown): VoiceConfigView {
  const o = unwrap(raw);
  const voices = Array.isArray(o.voices) ? o.voices.filter((v): v is string => typeof v === "string" && !!v) : [];
  return { stt: str(o.stt), tts: str(o.tts), voice: str(o.voice), voices };
}

/** The member's own voice settings. */
export function readVoicePref(raw: unknown): VoicePrefView {
  const o = unwrap(raw);
  const mode = o.mode === "off" || o.mode === "push-to-talk" || o.mode === "continuous" ? o.mode : undefined;
  return {
    mode,
    voiceId: str(o.voiceId),
    deviceId: str(o.deviceId),
    autoplay: typeof o.autoplay === "boolean" ? o.autoplay : undefined,
  };
}

export function voiceSectionModel(cfg: VoiceConfigView, pref: VoicePrefView): VoiceSectionModel {
  const mode: VoiceMode = pref.mode ?? "push-to-talk";
  const hasTts = !!cfg.tts;
  const voices = cfg.voices;
  const voiceOptions = voices.length
    ? [
      { value: "", label: cfg.voice && voices.includes(cfg.voice) ? `${cfg.voice} (default)` : "Default" },
      ...voices.filter((v) => v !== cfg.voice).map((v) => ({ value: v, label: v })),
    ]
    : null;
  // A saved voice that is no longer listed falls back to the default row.
  const voiceValue = pref.voiceId && voices.includes(pref.voiceId) && pref.voiceId !== cfg.voice ? pref.voiceId : "";
  return {
    micOn: mode !== "off",
    handsFree: mode === "continuous",
    speakOn: hasTts && pref.autoplay !== false,
    speakLocked: !hasTts,
    speakNote: hasTts ? null : NO_SPEECH_MODEL_LINE,
    voiceOptions: hasTts ? voiceOptions : null,
    voicesLine: !hasTts ? null : voiceOptions ? null : NO_VOICES_LINE,
    voiceValue,
  };
}

/** The patch one control writes. */
export const voicePatch = {
  mic: (on: boolean): Partial<VoicePrefView> => ({ mode: on ? "push-to-talk" : "off" }),
  handsFree: (on: boolean): Partial<VoicePrefView> => ({ mode: on ? "continuous" : "push-to-talk" }),
  speak: (on: boolean): Partial<VoicePrefView> => ({ autoplay: on }),
  voice: (value: string): Partial<VoicePrefView> => ({ voiceId: value || null }),
  device: (value: string): Partial<VoicePrefView> => ({ deviceId: value || null }),
};

// ── the DOM ──────────────────────────────────────────────────────────────────

interface VoiceDoors {
  voiceConfig?: () => Promise<unknown>;
  voiceSettingsGet?: () => Promise<unknown>;
  voiceSettingsSet?: (patch: Partial<VoicePrefView>) => Promise<unknown>;
}
const doors = (): VoiceDoors => (window as unknown as { glyphh: VoiceDoors }).glyphh;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c] as string));

/** The sections already wired (the DOM is static; a reload repaints only). */
const wired = new WeakSet<HTMLElement>();

function paint(m: VoiceSectionModel): void {
  const mic = $<HTMLInputElement>("toggle-voice-mic");
  if (mic) mic.checked = m.micOn;
  const hands = $<HTMLInputElement>("toggle-voice-handsfree");
  if (hands) { hands.checked = m.handsFree; hands.disabled = !m.micOn; }
  const speak = $<HTMLInputElement>("toggle-voice-speak");
  if (speak) { speak.checked = m.speakOn; speak.disabled = m.speakLocked; }
  const note = $("voice-speak-note");
  if (note) { note.textContent = m.speakNote ?? ""; note.classList.toggle("hidden", !m.speakNote); }
  const sel = $<HTMLSelectElement>("voice-voice");
  if (sel) {
    sel.innerHTML = (m.voiceOptions ?? []).map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join("");
    sel.value = m.voiceValue;
    sel.classList.toggle("hidden", !m.voiceOptions);
  }
  const line = $("voice-voices-line");
  if (line) { line.textContent = m.voicesLine ?? ""; line.classList.toggle("hidden", !m.voicesLine); }
  // The whole voice row goes when there is no speech model: the speak switch's note says why.
  $("voice-voice-row")?.classList.toggle("hidden", m.speakLocked);
}

/** The microphone device select (restored from the old Settings › Voice page):
 *  the OS's audio inputs. Only enumerates — labels fill in once the mic has
 *  been allowed from the composer; this page never prompts. */
async function fillDevices(selected: string | null): Promise<void> {
  const row = $("voice-device-row");
  const sel = $<HTMLSelectElement>("voice-device");
  const media = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (!row || !sel) return;
  if (!media?.enumerateDevices) { row.classList.add("hidden"); return; }
  let mics: MediaDeviceInfo[] = [];
  try { mics = (await media.enumerateDevices()).filter((d) => d.kind === "audioinput" && d.deviceId); }
  catch { /* enumeration refused — the default row alone */ }
  sel.innerHTML = `<option value="">System default</option>` +
    mics.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || `Microphone ${i + 1}`)}</option>`).join("");
  sel.value = selected && mics.some((d) => d.deviceId === selected) ? selected : "";
  row.classList.remove("hidden");
}

function setErr(msg: string): void {
  const e = $("voice-settings-error");
  if (e) { e.textContent = msg; e.classList.toggle("hidden", !msg); }
}

async function save(patch: Partial<VoicePrefView>): Promise<void> {
  try {
    await doors().voiceSettingsSet?.(patch);
    setErr("");
  } catch (e) { setErr(`Couldn't save — ${(e as Error).message}`); }
  // The composer's chips read the same settings: repaint them.
  void refreshMicChip();
  void refreshSpeakToggle();
}

function wire(section: HTMLElement): void {
  if (wired.has(section)) return;
  wired.add(section);
  $<HTMLInputElement>("toggle-voice-mic")?.addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    const hands = $<HTMLInputElement>("toggle-voice-handsfree");
    if (hands) { hands.disabled = !on; if (!on) hands.checked = false; }
    void save(voicePatch.mic(on));
  });
  $<HTMLInputElement>("toggle-voice-handsfree")?.addEventListener("change", (e) => void save(voicePatch.handsFree((e.target as HTMLInputElement).checked)));
  $<HTMLInputElement>("toggle-voice-speak")?.addEventListener("change", (e) => void save(voicePatch.speak((e.target as HTMLInputElement).checked)));
  $<HTMLSelectElement>("voice-voice")?.addEventListener("change", (e) => void save(voicePatch.voice((e.target as HTMLSelectElement).value)));
  $<HTMLSelectElement>("voice-device")?.addEventListener("change", (e) => void save(voicePatch.device((e.target as HTMLSelectElement).value)));
}

/** Populate the Voice section of Settings → General. Rows hide on a host
 *  that serves no voice doors (web-surface keepIfHost). */
export async function loadVoiceSection(): Promise<void> {
  const section = $("voice-section");
  if (!section) return;
  if (!keepIfHost(section, "voiceConfig", "voiceSettingsGet", "voiceSettingsSet")) return;
  setErr("");
  const [cfgRaw, prefRaw] = await Promise.all([
    Promise.resolve().then(() => doors().voiceConfig?.()).catch(() => undefined),
    Promise.resolve().then(() => doors().voiceSettingsGet?.()).catch(() => undefined),
  ]);
  const cfg = readVoiceConfig(cfgRaw);
  const pref = readVoicePref(prefRaw);
  paint(voiceSectionModel(cfg, pref));
  await fillDevices(pref.deviceId ?? null);
  wire(section);
}
