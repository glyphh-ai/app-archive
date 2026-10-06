/**
 * run-place-modal — WHERE A CLI RUNS, asked first (his order, 2026-10-07:
 * "opening the cli agents directly from echo should open the chip to choose
 * where they are going to run… as a modal"). The same two sections the
 * composer's environment chip shows — Remote control (the attached desktops,
 * or this desktop) and Cloud environments (Default, the member's own) — in
 * the standard modal. The pick becomes the composer's source, so the CLI's
 * terminal lands on that desktop over the relay or on the cloud worker.
 */

import { drillItem } from "./code-source-chip.js";
import { guardWebviewsForModal } from "./shared.js";
import { LOCUS_SVG } from "./session-locus.js";

export type RunPlace = { kind: "desktop"; machine: { id?: string; name: string } } | { kind: "cloud"; environmentId: string };

export interface RunPlaceInput {
  surface: "web" | "desktop";
  /** The attached desktops (web); on the desktop the machine is itself. */
  machines: ReadonlyArray<{ id?: string; name: string }>;
  environments: ReadonlyArray<{ id: string; name: string; subline?: string }>;
  /** Where the composer stands now — the checked row. */
  current: RunPlace | null;
}

export interface RunPlaceRow { section: "desktop" | "cloud"; place: RunPlace | null; label: string; sub: string; selected: boolean }

const CHECK = `<svg class="drop-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

/** The rows, pure: the desktops first (a note when none is attached on the
 *  web), then Default and the member's environments. */
export function runPlaceRows(i: RunPlaceInput): RunPlaceRow[] {
  const out: RunPlaceRow[] = [];
  const machines = i.surface === "desktop" && !i.machines.length ? [{ name: "This desktop" }] : [...i.machines];
  if (!machines.length) out.push({ section: "desktop", place: null, label: "No desktop attached", sub: "Turn remote control on in the Glyphh desktop app (Settings → Remote control).", selected: false });
  for (const m of machines) {
    const selected = i.current?.kind === "desktop" && (!i.current.machine.id || !m.id || i.current.machine.id === m.id);
    out.push({ section: "desktop", place: { kind: "desktop", machine: m }, label: m.name || "Glyphh desktop", sub: "Runs on this desktop", selected });
  }
  const envs = [{ id: "default", name: "Default", subline: "" }, ...i.environments.filter((e) => e.id !== "default")];
  for (const e of envs) {
    out.push({ section: "cloud", place: { kind: "cloud", environmentId: e.id }, label: e.name, sub: e.subline ?? "", selected: i.current?.kind === "cloud" && i.current.environmentId === e.id });
  }
  return out;
}

/** The modal. Resolves to the pick, or null on Cancel / Escape / a click outside. */
export function chooseRunPlace(i: RunPlaceInput): Promise<RunPlace | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay run-place-overlay";
    overlay.innerHTML = `<div class="confirm-box run-place-box" role="dialog" aria-modal="true" aria-labelledby="run-place-title">
      <div class="confirm-head"><h3 id="run-place-title">Choose environment</h3></div>
      <div class="run-place-list"></div>
      <div class="confirm-foot"><button class="action-btn secondary run-place-cancel" type="button">Cancel</button></div>
    </div>`;
    const list = overlay.querySelector<HTMLElement>(".run-place-list")!;
    const done = (place: RunPlace | null): void => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      guardWebviewsForModal(false);
      resolve(place);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.preventDefault(); done(null); } };
    let section: "desktop" | "cloud" | null = null;
    for (const r of runPlaceRows(i)) {
      if (r.section !== section) {
        section = r.section;
        const lbl = document.createElement("div");
        lbl.className = "ws-sec-label";
        lbl.innerHTML = `${section === "desktop" ? LOCUS_SVG.local : LOCUS_SVG.cloud}<span></span>`;
        (lbl.querySelector("span") as HTMLElement).textContent = section === "desktop" ? "Remote control" : "Cloud environments";
        list.appendChild(lbl);
      }
      const row = drillItem(r.label, r.sub, r.selected ? CHECK : "");
      if (r.selected) row.classList.add("selected");
      if (!r.place) { row.classList.add("ws-unreachable"); row.disabled = true; }
      else { const place = r.place; row.addEventListener("click", () => done(place)); }
      list.appendChild(row);
    }
    overlay.querySelector(".run-place-cancel")!.addEventListener("click", () => done(null));
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) done(null); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    guardWebviewsForModal(true);
    list.querySelector<HTMLButtonElement>(".code-drop-item.selected")?.focus();
  });
}
