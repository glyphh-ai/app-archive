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
import { folderRows, runPlaceRows, type RunPlace, type RunPlaceInput } from "./run-place.js";

export type { RunPlace, RunPlaceInput } from "./run-place.js";

export interface RunPlaceDoors {
  /** The machine's own folder picker (the desktop surface); absent on the web. */
  browse?: () => Promise<string | null>;
}

/** The modal. Resolves to the pick, or null on Cancel / Escape / a click
 *  outside. A desktop pick drills into its folders (folderRows) before it
 *  resolves — the session needs both the machine and the folder. */
export function chooseRunPlace(i: RunPlaceInput, doors: RunPlaceDoors = {}): Promise<RunPlace | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay run-place-overlay";
    overlay.innerHTML = `<div class="confirm-box run-place-box" role="dialog" aria-modal="true" aria-labelledby="run-place-title">
      <div class="confirm-head run-place-head"><button class="drop-detail-back run-place-back hidden" type="button" aria-label="Back to environments"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button><h3 id="run-place-title">Choose environment</h3></div>
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
    const title = overlay.querySelector<HTMLElement>("#run-place-title")!;
    const back = overlay.querySelector<HTMLButtonElement>(".run-place-back")!;
    // The folder step is a second page: the ← in the head goes back to the
    // environments (his order 2026-10-07: "needs a <- back button").
    const drillFolders = (machine: { id?: string; name: string; folders?: readonly string[] }): void => {
      list.textContent = "";
      title.textContent = `Choose folder — ${machine.name || "this desktop"}`;
      back.classList.remove("hidden");
      const rows = folderRows(machine, i.recents ?? []);
      for (const f of rows) {
        const row = drillItem(f.label, f.sub, "");
        row.addEventListener("click", () => done({ kind: "desktop", machine, folder: f.path }));
        list.appendChild(row);
      }
      if (doors.browse) {
        const browse = drillItem("Browse…", "Pick any folder on this desktop", "");
        browse.addEventListener("click", () => { void doors.browse!().then((p) => { if (p) done({ kind: "desktop", machine, folder: p }); }); });
        list.appendChild(browse);
      } else if (!rows.length) {
        const note = drillItem("No folder granted", "Grant one in the Glyphh desktop app (Settings → Remote control).", "");
        note.classList.add("ws-unreachable"); note.disabled = true;
        list.appendChild(note);
      }
      list.querySelector<HTMLButtonElement>(".code-drop-item:not(:disabled)")?.focus();
    };
    const renderPlaces = (): void => {
      list.textContent = "";
      title.textContent = "Choose environment";
      back.classList.add("hidden");
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
        // Nothing is pre-selected: the modal is the QUESTION "where does this
        // run?", and a pre-ticked row reads as already answered (his report,
        // 2026-10-07). The composer chip keeps its tick; this screen does not.
        const row = drillItem(r.label, r.sub, "");
        if (!r.place) { row.classList.add("ws-unreachable"); row.disabled = true; }
        else { const place = r.place; row.addEventListener("click", () => (place.kind === "desktop" ? drillFolders(place.machine) : done(place))); }
        list.appendChild(row);
      }
    };
    renderPlaces();
    back.addEventListener("click", renderPlaces);
    overlay.querySelector(".run-place-cancel")!.addEventListener("click", () => done(null));
    overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) done(null); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    guardWebviewsForModal(true);
  });
}
