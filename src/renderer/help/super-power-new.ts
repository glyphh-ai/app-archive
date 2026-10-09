/**
 * super-power-new.ts — THE NEW SUPER POWER MODAL (his order, 2026-10-09: "a new
 * button next to super powers that opens a new super power modal that has
 * prompt etc. something super super cool that gets the user pumped about super
 * powers. Make the ui look awesome, needs to fit the edit super power feel and
 * powers modal").
 *
 * Three screens in one box, the powers modal's frame:
 *   ask    a cast of cats cycling in a glowing ring, the prompt, idea chips
 *   build  the ring spins up; five stages light in turn (main sends each beat:
 *          main/super-power-build-ipc.ts), the line Glyphh is on, and Stop
 *   done   its new face, its name, the powers it holds, the connections it
 *          still needs; Talk to it, Open its page, Build another
 */

import { botAvatarSvg, type BotAvatar } from "./bot-avatar.js";
import { escapeHtml, guardWebviewsForModal } from "./shared.js";
import { readConnectorRows, type PlusApi } from "./composer-plus.js";
import { openPowersModal } from "./powers-modal.js";

type Stage = "plan" | "powers" | "connect" | "life" | "face";
interface Beat { stage: Stage; line: string }
interface Built {
  agent: string; name: string; description: string;
  powers: Array<{ id: string; name: string }>;
  connections: string[];
  avatar: BotAvatar | null;
  avatarError: string | null;
}
interface Api extends PlusApi {
  superPowerBuild?: (ask: string) => Promise<{ ok: true; data: Built } | { ok: false; error: string }>;
  superPowerBuildStop?: () => Promise<{ ok: boolean; stopped: boolean }>;
  onSuperPowerBuildProgress?: (cb: (b: Beat) => void) => () => void;
}
const api = (): Api => (window as unknown as { glyphh?: Api }).glyphh ?? {};

/** The stages, in the order they light. */
const STAGES: ReadonlyArray<{ key: Stage; label: string }> = [
  { key: "plan", label: "Dreaming it up" },
  { key: "powers", label: "Forging its powers" },
  { key: "connect", label: "Wiring its connections" },
  { key: "life", label: "Bringing it to life" },
  { key: "face", label: "Drawing its face" },
];

/** Ideas, one click to fill the prompt. */
const IDEAS: ReadonlyArray<{ label: string; ask: string }> = [
  { label: "YouTube → social clips", ask: "Takes a full-length YouTube video and turns it into marketing content: short clip ideas with timestamps, posts for LinkedIn, X and Instagram, and a newsletter blurb." },
  { label: "UI / UX engineer", ask: "Writes clean, accessible UI and UX code: components, layouts and styles that follow our design tokens, with keyboard support and tests." },
  { label: "Inbox triage", ask: "Every weekday morning, reads my unread Gmail, sorts what needs a reply, drafts the easy ones and gives me a short briefing." },
  { label: "Competitor watch", ask: "Researches our competitors every week: pricing, launches and reviews, and writes me a one-page summary with what changed." },
  { label: "Meeting prep", ask: "Before each meeting on my calendar, pulls together who is attending, our last emails with them and three talking points." },
];

/** What the prompt box whispers while it is empty, one after another. */
const WHISPERS: ReadonlyArray<string> = [
  "A super power that turns my long videos into a week of social posts…",
  "A super power that reviews my pull requests like a senior engineer…",
  "A super power that reads my inbox at 8am and tells me what matters…",
  "A super power that writes on-brand landing pages from a one-line brief…",
];

const S = 'viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
const CLOSE_SVG = `<svg ${S} stroke-width="2.4"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
const BOLT_SVG = `<svg ${S} stroke-width="2"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>`;
const CHECK_SVG = `<svg ${S} stroke-width="2.6"><path d="m5 12 5 5L20 7"/></svg>`;
const PLUS_SVG = `<svg ${S} stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>`;
const SPARK_SVG = `<svg ${S} stroke-width="2"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/** A gateway refusal in plain words: a rate limit says when it lifts, in local time. */
export function friendlyError(raw: string): string {
  const s = String(raw ?? "");
  if (/\b429\b|rate limit/i.test(s)) {
    const at = s.match(/resets at:?\s*(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*UTC/i);
    const when = at ? new Date(`${at[1]}T${at[2]}Z`) : null;
    const local = when && !Number.isNaN(when.getTime()) ? when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
    return `Your organization has hit its model rate limit${local ? `. It resets at ${local}` : ""}. Try again then, or ask your admin to raise it.`;
  }
  return s;
}

export interface NewSuperPowerOptions {
  /** Open its conversation (help/code.ts: the rail's own opener). */
  onTalk?: (agent: string, name: string) => void;
  /** Open its Edit page. */
  onOpenPage?: (agent: string) => void;
}

let openModal: { close: () => void } | null = null;

export function openNewSuperPowerModal(opts: NewSuperPowerOptions = {}): void {
  openModal?.close();
  let closed = false;
  let building = false;
  let ask = "";
  let timers: number[] = [];
  const clearTimers = (): void => { for (const t of timers) clearInterval(t); timers = []; };

  const overlay = el("div", "confirm-overlay powm spn");
  overlay.innerHTML = `
    <div class="confirm-box powm-box spn-box" role="dialog" aria-modal="true" aria-label="New super power">
      <div class="confirm-head powm-head"><h3>New super power</h3>
        <button class="ws-icon-btn powm-x" type="button" title="Close" aria-label="Close">${CLOSE_SVG}</button></div>
      <div class="confirm-body powm-body spn-body"></div>
      <div class="crud-form-error powm-error hidden"></div>
      <div class="confirm-foot powm-foot spn-foot"></div>
    </div>`;
  const q = <T extends HTMLElement>(s: string): T => overlay.querySelector<T>(s)!;
  const body = q<HTMLElement>(".spn-body");
  const foot = q<HTMLElement>(".spn-foot");
  const errEl = q<HTMLElement>(".powm-error");
  const showErr = (msg: string): void => { errEl.textContent = msg; errEl.classList.toggle("hidden", !msg); };

  function close(): void {
    if (closed) return;
    if (building) void api().superPowerBuildStop?.();
    closed = true;
    clearTimers();
    clearTimeout(cometTimer);
    offBeat?.();
    document.removeEventListener("keydown", onKey, true);
    guardWebviewsForModal(false);
    overlay.remove();
    if (openModal?.close === close) openModal = null;
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape" && !building) { e.preventDefault(); close(); }
  }
  q<HTMLButtonElement>(".powm-x").addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay && !building) close(); });

  // ── THE HERO: a cat in a glowing ring. On the ask screen the cast cycles
  //    through every face; building, the ring spins up; done, its own face
  //    lands with a burst. ──
  const hero = el("div", "spn-hero");
  const ring = el("div", "spn-ring");
  const face = el("div", "spn-face");
  const sparks = el("div", "spn-sparks");
  for (let i = 0; i < 10; i++) {
    const s = el("span", "spn-spark");
    s.style.setProperty("--a", `${i * 36}deg`);
    s.style.setProperty("--d", `${(i % 5) * 0.35}s`);
    sparks.appendChild(s);
  }
  ring.append(face);
  // THE COMET (his order, 2026-10-09: "randomly do a flashy of white / theme
  // primary color around the outside of the circle with tiny particles as it
  // goes around"): at a random moment a bright head sweeps once round the
  // ring, white or the accent, shedding particles that drift outward.
  const comet = el("div", "spn-comet");
  comet.innerHTML = `<span class="spn-comet-light"></span><span class="spn-comet-head"></span>${Array.from({ length: 7 }, (_, i) => `<span class="spn-comet-trail" style="--i:${i + 1}"></span>`).join("")}`;
  hero.append(sparks, comet, ring);
  const COMET_MS = 1500;
  let cometTimer = 0;
  const launchComet = (): void => {
    if (closed) return;
    const white = Math.random() < 0.5;
    hero.style.setProperty("--comet", white ? "#ffffff" : "var(--accent)");
    const start = Math.floor(Math.random() * 360);
    hero.style.setProperty("--comet-from", `${start}deg`);
    comet.classList.remove("go");
    void comet.offsetWidth;
    comet.classList.add("go");
    // Particles shed along the path: each leaves where the head is when it is born.
    // More dust (his order, 2026-10-09: "increase the number of particles").
    const DUST = 96;
    for (let i = 0; i < DUST; i++) {
      // Every third one is a spark: brighter, finer, flung further.
      const spark = i % 3 === 0;
      const p = el("span", spark ? "spn-dust spark" : "spn-dust");
      const t = (i / DUST) * COMET_MS;
      p.style.setProperty("--a", `${start + (i / DUST) * 360 + (Math.random() - 0.5) * 6}deg`);
      p.style.setProperty("--d", `${t}ms`);
      p.style.setProperty("--out", `${spark ? 18 + Math.random() * 34 : 6 + Math.random() * 26}px`);
      p.style.setProperty("--drift", `${(Math.random() - 0.5) * 40}deg`);
      p.style.setProperty("--s", `${1.5 + Math.random() * 2.5}px`);
      hero.appendChild(p);
      window.setTimeout(() => p.remove(), t + 1200);
    }
    cometTimer = window.setTimeout(launchComet, 3500 + Math.random() * 5000);
  };
  cometTimer = window.setTimeout(launchComet, 900 + Math.random() * 1500);
  // THE REGULAR CAT (his order, 2026-10-09: "remove the weird eye cat… just
  // the regular cat with a wink and a slight strobe"): Glyphh itself, winking
  // now and then; the ring breathes a soft glow behind it.
  const REGULAR: BotAvatar = { variant: 1, color: "#0b0a0f" };
  const paintCat = (wink: boolean): void => { face.innerHTML = botAvatarSvg(REGULAR, wink ? "playful" : "idle", { size: 112 }); };
  // THE REGULAR CAT, WINKING THE WAY THE RAIL'S DOES (his order, 2026-10-09:
  // "i want the cat to actually have a wink animation, the regular cat, like
  // you do in the left rail"): the idle face and its blink animation.
  const startCat = (): void => {
    paintCat(false);
    face.classList.remove("spn-face-in");
    void face.offsetWidth;
    face.classList.add("spn-face-in");
  };

  // ── ASK ──
  function paintAsk(): void {
    building = false;
    hero.className = "spn-hero";
    startCat();
    body.textContent = "";
    foot.textContent = "";
    body.appendChild(hero);
    const title = el("div", "spn-title");
    title.innerHTML = `Give Glyphh a new <span class="spn-glow">super power</span>`;
    const sub = el("p", "spn-sub", "Describe the job. Glyphh plans it, forges the powers it needs, wires its connections and gives it a face. It lands on your rail, ready to go.");
    const box = el("div", "spn-ask-wrap");
    const field = el("textarea", "settings-input spn-ask");
    field.rows = 4;
    field.maxLength = 2000;
    field.value = ask;
    let w = 0;
    field.placeholder = WHISPERS[0]!;
    timers.push(window.setInterval(() => { w = (w + 1) % WHISPERS.length; field.placeholder = WHISPERS[w]!; }, 3200));
    field.addEventListener("input", () => { ask = field.value; go.disabled = !field.value.trim(); });
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void build(); }
    });
    box.appendChild(field);
    const ideas = el("div", "spn-ideas");
    ideas.appendChild(el("span", "spn-ideas-label", "Try one"));
    for (const idea of IDEAS) {
      const chip = el("button", "spn-idea", idea.label);
      chip.type = "button";
      chip.addEventListener("click", () => { ask = idea.ask; field.value = idea.ask; go.disabled = false; field.focus(); });
      ideas.appendChild(chip);
    }
    body.append(title, sub, box, ideas);

    const cancel = el("button", "action-btn secondary", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", close);
    const go = el("button", "action-btn primary spn-go");
    go.type = "button";
    go.innerHTML = `${BOLT_SVG}<span>Build my super power</span>`;
    go.disabled = !ask.trim();
    if (!api().superPowerBuild) {
      go.disabled = true;
      body.appendChild(el("div", "powm-note", "Building super powers needs the Glyphh desktop app."));
    }
    go.addEventListener("click", () => {
      // One build at a time: the button and the ideas go quiet at once.
      go.disabled = true;
      ideas.querySelectorAll<HTMLButtonElement>("button").forEach((b) => { b.disabled = true; });
      field.disabled = true;
      void build();
    });
    foot.append(el("span", "spn-hint", "⌘↵ to build"), cancel, go);
    setTimeout(() => field.focus(), 30);
  }

  // ── BUILD ──
  let offBeat: (() => void) | null = null;
  async function build(): Promise<void> {
    const text = ask.trim();
    const run = api().superPowerBuild;
    if (!text || !run || building) return;
    showErr("");
    building = true;
    hero.className = "spn-hero spn-building";
    startCat();
    body.textContent = "";
    foot.textContent = "";
    body.appendChild(hero);
    body.appendChild(el("div", "spn-title", "Building your super power"));
    const quote = el("p", "spn-sub spn-quote", `“${text.length > 160 ? `${text.slice(0, 159)}…` : text}”`);
    body.appendChild(quote);
    const list = el("ol", "spn-stages");
    const rows = new Map<Stage, HTMLLIElement>();
    for (const s of STAGES) {
      const li = el("li", "spn-stage");
      li.innerHTML = `<span class="spn-dot"></span><span class="spn-stage-label">${escapeHtml(s.label)}</span>`;
      rows.set(s.key, li);
      list.appendChild(li);
    }
    body.appendChild(list);
    const line = el("div", "spn-line", "Reading what you asked for");
    body.appendChild(line);
    const light = (stage: Stage): void => {
      const at = STAGES.findIndex((s) => s.key === stage);
      STAGES.forEach((s, i) => {
        const li = rows.get(s.key)!;
        const done = i < at;
        li.classList.toggle("done", done);
        li.classList.toggle("active", i === at);
        li.querySelector(".spn-dot")!.innerHTML = done ? CHECK_SVG : "";
      });
    };
    light("plan");
    // WHILE IT RUNS (his order, 2026-10-09: "there needs to be a stop button
    // here also when it is running and the buttons should be disabled, other
    // than cancel and stop"): Cancel stops it and closes; Stop stops it and
    // returns to the prompt. Nothing else is live.
    const cancel = el("button", "action-btn secondary", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", close);
    const stop = el("button", "action-btn danger", "Stop");
    stop.type = "button";
    stop.addEventListener("click", () => { stop.disabled = true; stop.textContent = "Stopping…"; void api().superPowerBuildStop?.(); });
    foot.append(el("span", "spn-hint", "This takes a minute or two"), cancel, stop);

    offBeat = api().onSuperPowerBuildProgress?.((b) => {
      if (closed) return;
      if (b.stage) light(b.stage);
      // A soft fade between lines, so a change reads as progress, not flicker.
      if (b.line && b.line !== line.textContent) {
        line.classList.add("swap");
        window.setTimeout(() => { if (!closed) { line.textContent = b.line; line.classList.remove("swap"); } }, 160);
      }
    }) ?? null;
    const r = await run(text).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    offBeat?.();
    offBeat = null;
    building = false;
    if (closed) return;
    if (!r.ok) {
      paintAsk();
      if (r.error !== "Stopped.") showErr(friendlyError(r.error));
      return;
    }
    ask = "";
    paintDone(r.data);
  }

  // ── DONE ──
  function paintDone(b: Built): void {
    clearTimers();
    hero.className = "spn-hero spn-born";
    face.innerHTML = botAvatarSvg(b.avatar ?? REGULAR, "done", { size: 112, title: b.name });
    face.classList.remove("spn-face-in");
    void face.offsetWidth;
    face.classList.add("spn-face-in");
    body.textContent = "";
    foot.textContent = "";
    body.appendChild(hero);
    const kicker = el("div", "spn-kicker");
    kicker.innerHTML = `${SPARK_SVG}<span>New super power unlocked</span>`;
    body.append(kicker, el("div", "spn-name", b.name), el("p", "spn-sub", b.description || ""));
    if (b.avatarError) body.appendChild(el("div", "powm-note", "Its face couldn't be drawn this time, so it wears the classic cat. Draw a new one from its page."));

    const sec = (label: string): HTMLElement => {
      const wrap = el("div", "spn-sec");
      wrap.appendChild(el("div", "conn2-h3 spn-sec-h", label));
      body.appendChild(wrap);
      return wrap;
    };
    const powers = sec("Its powers");
    const chips = el("div", "spn-chips");
    if (!b.powers.length) chips.appendChild(el("span", "powm-note", "None yet: it runs on Glyphh's own know-how."));
    for (const p of b.powers) {
      const c = el("span", "spn-chip");
      c.innerHTML = `${BOLT_SVG}<span>${escapeHtml(p.name)}</span>`;
      chips.appendChild(c);
    }
    powers.appendChild(chips);

    if (b.connections.length) {
      const conns = sec("Its connections");
      const list = el("div", "spn-chips");
      conns.appendChild(list);
      const note = el("div", "powm-note");
      conns.appendChild(note);
      void readConnectorRows(api()).then((rows) => {
        if (closed) return;
        const have = new Set(rows.filter((r) => r.kind === "account" && r.on).map((r) => r.slug));
        let missing = 0;
        for (const slug of b.connections) {
          const ok = have.has(slug);
          if (!ok) missing++;
          // A missing one is a door (his report, 2026-10-09: "the connect icon
          // didn't work… it should open the modal to that connector").
          const c = el(ok ? "span" : "button", `spn-chip ${ok ? "on" : "off"}`);
          c.innerHTML = `${ok ? CHECK_SVG : PLUS_SVG}<span>${escapeHtml(slug.replace(/_/g, " "))}</span>`;
          if (!ok) {
            (c as HTMLButtonElement).type = "button";
            c.title = `Connect ${slug.replace(/_/g, " ")}`;
            c.addEventListener("click", () => openConnector(slug));
          }
          list.appendChild(c);
        }
        if (missing) {
          note.textContent = `Connect ${missing === 1 ? "it" : `these ${missing}`} so it can do its job.`;
          const connect = el("button", "action-btn secondary spn-connect", "Connect");
          connect.type = "button";
          const first = b.connections.find((x) => !have.has(x))!;
          connect.addEventListener("click", () => openConnector(first));
          conns.appendChild(connect);
        } else {
          note.textContent = "All connected. It's ready.";
        }
      }).catch(() => { /* the chips stay unmarked */ });
    }

    /** The powers modal, open on that connector's own page (its + connects it). */
    function openConnector(slug: string): void {
      close();
      openPowersModal({ tab: "connections", focus: { tab: "connections", name: slug } });
    }

    const again = el("button", "action-btn secondary", "Build another");
    again.type = "button";
    again.addEventListener("click", () => paintAsk());
    const page = el("button", "action-btn secondary", "Open its page");
    page.type = "button";
    page.addEventListener("click", () => { close(); opts.onOpenPage?.(b.agent); });
    const talk = el("button", "action-btn primary spn-go");
    talk.type = "button";
    talk.innerHTML = `${BOLT_SVG}<span>Talk to it</span>`;
    talk.addEventListener("click", () => { close(); opts.onTalk?.(b.agent, b.name); });
    foot.append(again, page, talk);
  }

  document.addEventListener("keydown", onKey, true);
  guardWebviewsForModal(true);
  document.body.appendChild(overlay);
  openModal = { close };
  paintAsk();
}
