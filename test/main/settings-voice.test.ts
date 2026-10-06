/**
 * settings-voice.test.ts — Settings → General → Voice (src/renderer/help/
 * settings-voice.ts): the admin's config + the member's settings become the
 * section's rows, and each control writes one patch through
 * window.glyphh.voiceSettingsSet (his order, 2026-10-07).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_SPEECH_MODEL_LINE, NO_VOICES_LINE, loadVoiceSection, readVoiceConfig, readVoicePref, voicePatch, voiceSectionModel,
} from "../../src/renderer/help/settings-voice.js";

// ── a fake document: the section's ids, each a bag the module reads and writes ──
type Listener = (e: { target: FakeEl }) => void;
class FakeEl {
  checked = false; value = ""; disabled = false; innerHTML = ""; textContent = "";
  private classes = new Set<string>();
  private listeners: Record<string, Listener[]> = {};
  classList = {
    add: (c: string) => { this.classes.add(c); },
    remove: (c: string) => { this.classes.delete(c); },
    toggle: (c: string, on?: boolean) => { if (on ?? !this.classes.has(c)) this.classes.add(c); else this.classes.delete(c); return this.classes.has(c); },
    contains: (c: string) => this.classes.has(c),
  };
  addEventListener(type: string, fn: Listener): void { (this.listeners[type] ||= []).push(fn); }
  fire(type: string): void { for (const fn of this.listeners[type] || []) fn({ target: this }); }
  hidden(): boolean { return this.classes.has("hidden"); }
  options(): Array<{ value: string; label: string }> {
    return [...this.innerHTML.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((m) => ({ value: m[1], label: m[2] }));
  }
}
const IDS = [
  "voice-section", "voice-settings-error", "toggle-voice-mic", "toggle-voice-handsfree", "voice-device-row", "voice-device",
  "toggle-voice-speak", "voice-speak-note", "voice-voice-row", "voice-voice", "voice-voices-line",
];
let els: Record<string, FakeEl>;
let set: ReturnType<typeof vi.fn>;

const CFG = { stt: "openai::gpt-4o-mini-transcribe", tts: "elevenlabs::eleven_flash_v2_5", voice: "Rachel", voices: ["Rachel", "Adam", "Bella"] };

function install(cfg: unknown, pref: unknown): void {
  els = Object.fromEntries(IDS.map((id) => [id, new FakeEl()]));
  set = vi.fn(async (patch: unknown) => patch);
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => els[id] ?? null,
    documentElement: { classList: { contains: () => false } },
  };
  (globalThis as unknown as { window: unknown }).window = {
    glyphh: { voiceConfig: async () => cfg, voiceSettingsGet: async () => pref, voiceSettingsSet: set },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("reading the doors", () => {
  it("takes the desktop's raw object and the web's {ok,data} envelope alike; a missing voices list is []", () => {
    expect(readVoiceConfig(CFG)).toEqual(CFG);
    expect(readVoiceConfig({ ok: true, data: CFG })).toEqual(CFG);
    expect(readVoiceConfig({ stt: null, tts: "x", voice: null })).toEqual({ stt: null, tts: "x", voice: null, voices: [] });
    expect(readVoiceConfig(undefined)).toEqual({ stt: null, tts: null, voice: null, voices: [] });
    expect(readVoicePref({ ok: true, data: { mode: "continuous", autoplay: false, voiceId: "Adam", deviceId: null } }))
      .toEqual({ mode: "continuous", autoplay: false, voiceId: "Adam", deviceId: null });
    expect(readVoicePref({ mode: "sideways" }).mode).toBeUndefined();
  });
});

describe("the model", () => {
  it("an unset mode is push-to-talk (the SDK default): mic on, hands-free off", () => {
    const m = voiceSectionModel(CFG, {});
    expect(m.micOn).toBe(true);
    expect(m.handsFree).toBe(false);
    expect(m.speakOn).toBe(true);
    expect(m.speakLocked).toBe(false);
    expect(m.speakNote).toBeNull();
  });
  it("the admin's default voice is marked (default) and is the empty value; the member's pick is selected", () => {
    const m = voiceSectionModel(CFG, { voiceId: "Adam" });
    expect(m.voiceOptions).toEqual([{ value: "", label: "Rachel (default)" }, { value: "Adam", label: "Adam" }, { value: "Bella", label: "Bella" }]);
    expect(m.voiceValue).toBe("Adam");
    expect(m.voicesLine).toBeNull();
    // Picking the default by name, or a voice no longer listed, reads as the default.
    expect(voiceSectionModel(CFG, { voiceId: "Rachel" }).voiceValue).toBe("");
    expect(voiceSectionModel(CFG, { voiceId: "Gone" }).voiceValue).toBe("");
  });
  it("no voices listed → the muted line, no dropdown", () => {
    const m = voiceSectionModel({ ...CFG, voices: [] }, {});
    expect(m.voiceOptions).toBeNull();
    expect(m.voicesLine).toBe(NO_VOICES_LINE);
  });
  it("no speech model → the speak switch is off and locked with the note; no voice row at all", () => {
    const m = voiceSectionModel({ stt: CFG.stt, tts: null, voice: null, voices: [] }, { autoplay: true });
    expect(m.speakOn).toBe(false);
    expect(m.speakLocked).toBe(true);
    expect(m.speakNote).toBe(NO_SPEECH_MODEL_LINE);
    expect(m.voiceOptions).toBeNull();
    expect(m.voicesLine).toBeNull();
  });
  it("each control writes one patch", () => {
    expect(voicePatch.mic(false)).toEqual({ mode: "off" });
    expect(voicePatch.mic(true)).toEqual({ mode: "push-to-talk" });
    expect(voicePatch.handsFree(true)).toEqual({ mode: "continuous" });
    expect(voicePatch.handsFree(false)).toEqual({ mode: "push-to-talk" });
    expect(voicePatch.speak(false)).toEqual({ autoplay: false });
    expect(voicePatch.voice("Adam")).toEqual({ voiceId: "Adam" });
    expect(voicePatch.voice("")).toEqual({ voiceId: null });
    expect(voicePatch.device("")).toEqual({ deviceId: null });
  });
});

describe("the section in the DOM", () => {
  afterEach(() => {
    delete (globalThis as unknown as { document?: unknown }).document;
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  describe("with the admin's models and voices", () => {
    beforeEach(async () => { install(CFG, { ok: true, data: { mode: "continuous", autoplay: false, voiceId: "Bella", deviceId: null } }); await loadVoiceSection(); });

    it("paints the rows from the doors", () => {
      expect(els["voice-section"].hidden()).toBe(false);
      expect(els["toggle-voice-mic"].checked).toBe(true);
      expect(els["toggle-voice-handsfree"].checked).toBe(true);
      expect(els["toggle-voice-handsfree"].disabled).toBe(false);
      expect(els["toggle-voice-speak"].checked).toBe(false);
      expect(els["toggle-voice-speak"].disabled).toBe(false);
      expect(els["voice-speak-note"].hidden()).toBe(true);
      expect(els["voice-voice"].options()).toEqual([{ value: "", label: "Rachel (default)" }, { value: "Adam", label: "Adam" }, { value: "Bella", label: "Bella" }]);
      expect(els["voice-voice"].value).toBe("Bella");
      expect(els["voice-voice"].hidden()).toBe(false);
      expect(els["voice-voice-row"].hidden()).toBe(false);
      expect(els["voice-voices-line"].hidden()).toBe(true);
      // No enumerateDevices here → the device row stays hidden.
      expect(els["voice-device-row"].hidden()).toBe(true);
    });

    it("the mic switch writes the mode and locks hands-free when off", async () => {
      const mic = els["toggle-voice-mic"];
      mic.checked = false; mic.fire("change"); await tick();
      expect(set).toHaveBeenLastCalledWith({ mode: "off" });
      expect(els["toggle-voice-handsfree"].disabled).toBe(true);
      expect(els["toggle-voice-handsfree"].checked).toBe(false);
      mic.checked = true; mic.fire("change"); await tick();
      expect(set).toHaveBeenLastCalledWith({ mode: "push-to-talk" });
      expect(els["toggle-voice-handsfree"].disabled).toBe(false);
    });

    it("hands-free writes continuous / push-to-talk", async () => {
      const h = els["toggle-voice-handsfree"];
      h.checked = false; h.fire("change"); await tick();
      expect(set).toHaveBeenLastCalledWith({ mode: "push-to-talk" });
      h.checked = true; h.fire("change"); await tick();
      expect(set).toHaveBeenLastCalledWith({ mode: "continuous" });
    });

    it("the speak switch writes autoplay", async () => {
      const s = els["toggle-voice-speak"];
      s.checked = true; s.fire("change"); await tick();
      expect(set).toHaveBeenLastCalledWith({ autoplay: true });
    });

    it("the voice dropdown writes voiceId; the default row writes null", async () => {
      const v = els["voice-voice"];
      v.value = "Adam"; v.fire("change"); await tick();
      expect(set).toHaveBeenLastCalledWith({ voiceId: "Adam" });
      v.value = ""; v.fire("change"); await tick();
      expect(set).toHaveBeenLastCalledWith({ voiceId: null });
    });
  });

  it("no voices listed → the muted line, the dropdown hidden", async () => {
    install({ ...CFG, voices: [] }, {});
    await loadVoiceSection();
    expect(els["voice-voice"].hidden()).toBe(true);
    expect(els["voice-voice"].options()).toEqual([]);
    expect(els["voice-voices-line"].hidden()).toBe(false);
    expect(els["voice-voices-line"].textContent).toBe(NO_VOICES_LINE);
    expect(els["voice-voice-row"].hidden()).toBe(false);
  });

  it("no speech model → the speak switch is locked with its note, the voice row hidden; the mic still works", async () => {
    install({ stt: CFG.stt, tts: null, voice: null }, { mode: "push-to-talk", autoplay: true });
    await loadVoiceSection();
    expect(els["toggle-voice-speak"].disabled).toBe(true);
    expect(els["toggle-voice-speak"].checked).toBe(false);
    expect(els["voice-speak-note"].hidden()).toBe(false);
    expect(els["voice-speak-note"].textContent).toBe(NO_SPEECH_MODEL_LINE);
    expect(els["voice-voice-row"].hidden()).toBe(true);
    expect(els["toggle-voice-mic"].checked).toBe(true);
    expect(els["toggle-voice-handsfree"].disabled).toBe(false);
  });

  it("a host without the voice doors hides the whole section", async () => {
    install(CFG, {});
    (globalThis as unknown as { window: { glyphh: Record<string, unknown> } }).window.glyphh = {};
    await loadVoiceSection();
    expect(els["voice-section"].hidden()).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });
});
