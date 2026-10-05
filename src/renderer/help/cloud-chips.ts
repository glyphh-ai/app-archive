/**
 * cloud-chips.ts — THE WEB'S TWO SOURCE CHIPS above the composer (his report,
 * 2026-10-05, a screenshot of app.glyphh.ai at desktop width: "the composer
 * shows one chip '☁ workspace' … how does the user pick a new cloud env or
 * connect github? It looks like the chip is removed in web"). The phone
 * (web/src/mobile.tsx) already wears the pair he approved from the Claude
 * mobile screenshots; this is the same pair on the desktop-width agent
 * window, as the renderer's own `.code-drop-up` drops:
 *
 *   ENVIRONMENT chip — a cloud + "Default" (or the environment's name), or
 *     the attached desktop's name when the session runs there. Opens
 *     "Choose environment": Remote control (the attached desktops, with how
 *     many sessions live there) and Cloud environments (Default ✓, the
 *     member's own, "Create environment"). Create / Edit is the same
 *     dropdown with the form slid in (shared.ts showDropDetail): Name,
 *     Network access, Environment variables (.env), Delete on an edit.
 *   REPO chip — the GitHub mark + "N repos · N branches" ("Connect GitHub"
 *     until linked, "Choose repositories" with none picked). Opens
 *     "Repositories": the Connect row + the 2 s poll, Selected on top, the
 *     rest grouped by owner, a pinned search, Manage access / Disconnect;
 *     then "Choose base branch" — one row per picked repo.
 *
 * WEB ONLY — the desktop app's composer keeps its one folder chip. The chips
 * are direct children of the chips ROW (not wrapped: the row's chip wraps
 * clip their overflow, so a drop inside one would be cut), and their drops
 * hang off the row exactly as the locus picker's does (code-source-chip.ts
 * clampDropUp / clampDropX over menu-place.ts). Every rule — labels, the
 * send gate, the picks, the .env reading, the GitHub return — is
 * help/cloud-source.ts, shared with the phone; nothing is decided here.
 *
 * The picks write the session's source as the phone does:
 * cloudSource(picks, environmentId) (sourceForPicks when no repo is picked
 * yet). A BORN session's chips are read-only (LOCUS_LOCKED_HINT); a new
 * session can change them until its first turn.
 */
import { hostHas } from "./web-surface.js";
import { showDropDetail } from "./shared.js";
import { LOCUS_LOCKED_HINT, LOCUS_SVG, sourceLocus, type Locus } from "./session-locus.js";
import { CHECK, CHEV, backHead, clampDropUp, clampDropX, closeAllDrops, drillItem, markUnreachable, type Source } from "./code-source-chip.js";
import {
  DEFAULT_ENVIRONMENT_ID, DEFAULT_ENVIRONMENT_NAME, NETWORK_OPTIONS,
  cloudChipsModel, environmentFormError, environmentIdOf, environmentName, environmentSaveError, environmentSubline,
  gitCompleteError, groupRepos, maskedDotenv, picksOf, setBranch, sourceForPicks, splitRepo, toggleRepo,
  type BranchRow, type EnvironmentNetwork, type EnvironmentRow, type EnvironmentVarRow, type RepoPick, type RepoRow,
} from "./cloud-source.js";

// ── The web bridge's doors (web/src/web-contract.js) ─────────────────────
interface GitStatus { connected: boolean; login?: string | null; pending?: boolean }
interface EnvironmentDetail extends EnvironmentRow { vars: EnvironmentVarRow[] }
interface CloudDoors {
  cloudGitStatus(): Promise<GitStatus>;
  cloudGitConnect(returnTo: string): Promise<{ url: string }>;
  cloudGitComplete(link?: string): Promise<GitStatus>;
  cloudGitRepos(): Promise<RepoRow[]>;
  cloudGitBranches(repo: string, defaultBranch: string): Promise<BranchRow[]>;
  cloudGitDisconnect(): Promise<void>;
  cloudEnvironmentsList(): Promise<EnvironmentRow[]>;
  cloudEnvironmentsGet(id: string): Promise<EnvironmentDetail>;
  cloudEnvironmentsCreate(input: { name: string; network: EnvironmentNetwork; vars?: string }): Promise<EnvironmentDetail>;
  cloudEnvironmentsUpdate(id: string, input: { name?: string; network?: EnvironmentNetwork; vars?: string }): Promise<EnvironmentDetail>;
  cloudEnvironmentsDelete(id: string): Promise<void>;
}
const doors = (): CloudDoors | null =>
  hostHas("cloudGitStatus") ? (window as unknown as { glyphh: CloudDoors }).glyphh : null;

const GITHUB = `<svg class="cl-chip-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.17c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.52 11.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>`;
const CLOUD = LOCUS_SVG.cloud.replace("<svg ", `<svg class="cl-chip-ico" `);
const DESKTOP = LOCUS_SVG.local.replace("<svg ", `<svg class="cl-chip-ico" `);
const PLUS = `<svg class="drop-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;

const CLOUD_DROP_MAX_PX = 460;

type GitState = "unknown" | "off" | "connecting" | "on";

export interface CloudChipsOpts {
  getSource: () => Source;
  onPick: (s: Source) => void;
  /** The open session's locus once it has a turn; null = nothing is born. */
  bornLocus: () => Locus | null;
  /** The attached desktops (thread-store.attachedMachines). */
  machines: () => ReadonlyArray<{ id?: string; name: string }>;
  /** Pick a desktop as the place — the locus picker's own local pick. */
  onPickDesktop: (m: { id?: string; name: string }) => void;
  /** How many of the member's sessions run on the desktop. */
  sessionCount: () => number;
  /** The gate inputs changed (git state, picks): repaint the composer. */
  onChange: () => void;
}

export interface CloudChips {
  /** The two chips, in row order: environment, repo. */
  els: [HTMLButtonElement, HTMLButtonElement];
  /** Repaint both from the source + state (labels, the repo chip's
   *  presence, the born lock). */
  refresh: () => void;
  gitConnected: () => boolean;
  /** The GitHub return landing (page load): finish the link as this member,
   *  then open the repositories — or say why it failed. */
  completePendingLink: (link: string) => void;
  openRepos: (note?: string) => void;
}

export function createCloudChips(opts: CloudChipsOpts): CloudChips {
  const envBtn = document.createElement("button");
  envBtn.type = "button";
  envBtn.className = "cl-runtime-chip cl-runtime-btn cl-env-chip";
  const repoBtn = document.createElement("button");
  repoBtn.type = "button";
  repoBtn.className = "cl-runtime-chip cl-runtime-btn cl-repo-chip";

  let git: GitState = "unknown";
  let environments: EnvironmentRow[] = [];
  let repos: RepoRow[] | null = null;
  let menu: HTMLElement | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollAbort = 0;

  const src = (): Source => opts.getSource();
  const locus = (): Locus => sourceLocus(src());
  const picks = (): RepoPick[] => (locus() === "cloud" ? picksOf(src()) : []);
  const envId = (): string => (locus() === "cloud" ? environmentIdOf(src()) : DEFAULT_ENVIRONMENT_ID);
  const born = (): boolean => opts.bornLocus() !== null;
  const machineName = (): string => opts.machines()[0]?.name || "";

  const paint = (): void => {
    const m = cloudChipsModel({
      locus: locus(), born: born(), machineName: machineName(),
      environmentName: environmentName(envId(), environments),
      connected: git === "on", picks: picks(), lockedHint: LOCUS_LOCKED_HINT,
    });
    envBtn.innerHTML = `${locus() === "cloud" ? CLOUD : DESKTOP}<span class="cl-runtime-lbl"></span>${CHEV}`;
    (envBtn.querySelector(".cl-runtime-lbl") as HTMLElement).textContent = m.env.label;
    envBtn.title = m.env.title;
    envBtn.classList.toggle("cl-chip-static", m.env.locked);
    repoBtn.innerHTML = `${GITHUB}<span class="cl-runtime-lbl"></span>${CHEV}`;
    (repoBtn.querySelector(".cl-runtime-lbl") as HTMLElement).textContent = m.repo.label;
    repoBtn.title = m.repo.title;
    repoBtn.classList.toggle("cl-chip-static", m.repo.locked);
    repoBtn.classList.toggle("hidden", !m.repo.shown);
  };

  const closeMenu = (): void => { menu?.remove(); menu = null; stopPoll(); };
  const stopPoll = (): void => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    pollAbort++;
    if (git === "connecting") git = "off";
  };
  document.addEventListener("mousedown", (e) => {
    const t = e.target as Node;
    if (menu && !menu.contains(t) && t !== envBtn && t !== repoBtn && !envBtn.contains(t) && !repoBtn.contains(t)) closeMenu();
  }, true);

  /** One drop, hung off the chips ROW (the anchor's parent), placed like the
   *  locus picker's — drop-up, clamped to the row's clip box. */
  const openMenu = (anchor: HTMLElement, extraClass = ""): HTMLElement => {
    closeMenu();
    const row = anchor.parentElement || anchor;
    row.querySelector(".ws-source-drop")?.remove();
    closeAllDrops();
    menu = document.createElement("div");
    menu.className = `code-drop-up ws-source-drop ws-drop-flex ws-cloud-drop ${extraClass}`.trim();
    (row as HTMLElement).style.position ||= "relative";
    row.appendChild(menu);
    return menu;
  };
  // Taller than the folder picker's cap: these drops list repositories and
  // carry a form, and the chips sit at the foot of the window with the room.
  const place = (anchor: HTMLElement): void => { if (menu) { clampDropUp(menu, anchor, CLOUD_DROP_MAX_PX); clampDropX(menu, anchor); } };

  const pickCloud = (next: RepoPick[], id: string): void => {
    opts.onPick(sourceForPicks(next, id) as Source);
    paint();
    opts.onChange();
  };

  // ── Choose environment ──────────────────────────────────────────────────
  const openEnvironment = (): void => {
    const m = openMenu(envBtn);
    m.insertAdjacentHTML("beforeend", `<div class="code-drop-head"><span>Choose environment</span></div>`);
    const list = document.createElement("div");
    list.className = "ws-env-list ws-drop-body";
    m.appendChild(list);
    const bornLocus = opts.bornLocus();
    const lockDesktop = bornLocus === "cloud" ? LOCUS_LOCKED_HINT.cloud : "";
    const lockCloud = bornLocus === "local" ? LOCUS_LOCKED_HINT.local : bornLocus === "cloud" ? "This session's environment was fixed when it started." : "";

    const draw = (): void => {
      list.textContent = "";
      const secLabel = (svg: string, text: string): void => {
        const lbl = document.createElement("div");
        lbl.className = "ws-sec-label";
        lbl.innerHTML = `${svg}<span></span>`;
        (lbl.querySelector("span") as HTMLElement).textContent = text;
        list.appendChild(lbl);
      };
      // ── Remote control: the attached desktops ────────────────────────
      secLabel(LOCUS_SVG.local, "Remote control");
      const machines = opts.machines();
      if (!machines.length) {
        const note = drillItem("No desktop attached", "Turn remote control on in the Glyphh desktop app (Settings → Remote control).", "");
        note.classList.add("ws-install");
        markUnreachable(note, "No desktop is attached — turn remote control on in the Glyphh desktop app.");
        list.appendChild(note);
      }
      for (const mc of machines) {
        const n = opts.sessionCount();
        const sel = locus() === "local";
        const row = drillItem(mc.name || "Glyphh desktop", "Runs sessions on this desktop", `<span class="ws-env-count">${n} session${n === 1 ? "" : "s"}</span>${sel ? CHECK : CHEV}`);
        if (sel) row.classList.add("selected");
        if (lockDesktop) markUnreachable(row, lockDesktop);
        else row.addEventListener("click", () => { opts.onPickDesktop(mc); closeMenu(); paint(); opts.onChange(); });
        list.appendChild(row);
      }
      // ── Cloud environments: Default, the member's own, Create ────────
      secLabel(LOCUS_SVG.cloud, "Cloud environments");
      const current = envId();
      const cloudRow = (id: string, name: string, sub: string, edit: EnvironmentRow | null): void => {
        const sel = locus() === "cloud" && current === id;
        const row = drillItem(name, sub, sel ? CHECK : "");
        if (sel) row.classList.add("selected");
        if (lockCloud) markUnreachable(row, lockCloud);
        else row.addEventListener("click", () => { pickCloud(picks(), id); closeMenu(); });
        if (!edit) { list.appendChild(row); return; }
        const wrap = document.createElement("div");
        wrap.className = "ws-env-row";
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "ws-env-edit";
        editBtn.textContent = "Edit";
        editBtn.title = `Edit ${name}`;
        editBtn.addEventListener("click", (ev) => { ev.stopPropagation(); showForm(m, list, edit); });
        wrap.append(row, editBtn);
        list.appendChild(wrap);
      };
      cloudRow(DEFAULT_ENVIRONMENT_ID, DEFAULT_ENVIRONMENT_NAME, "", null);
      for (const e of environments) cloudRow(e.id, e.name, environmentSubline(e), e);
      const create = drillItem("Create environment", "A name, a network policy and .env variables", PLUS);
      if (lockCloud) markUnreachable(create, lockCloud);
      else create.addEventListener("click", () => showForm(m, list, null));
      list.appendChild(create);
      place(envBtn);
    };
    draw();
    // A fresh read of the member's rows while the menu is up.
    void loadEnvironments().then(() => { if (menu === m) draw(); });
  };

  /** The Create / Edit form, slid in over the list (shared.ts showDropDetail
   *  — the drop-detail pattern: the list hides, the form takes its place
   *  behind a back arrow). */
  const showForm = (m: HTMLElement, list: HTMLElement, editing: EnvironmentRow | null): void => {
    const form = document.createElement("div");
    form.className = "ws-env-form";
    form.innerHTML = `
      <label class="ws-env-field"><span>Name</span><input class="loop-drop-search repo-drop-search ws-env-name" placeholder="Default" maxlength="60" autocomplete="off" spellcheck="false"></label>
      <label class="ws-env-field"><span>Network access</span><select class="loop-drop-search ws-env-network"></select></label>
      <label class="ws-env-field"><span>Environment variables</span><textarea class="loop-drop-search ws-env-vars" rows="6" placeholder="API_KEY=hunter2" autocomplete="off" spellcheck="false" autocapitalize="off"></textarea></label>
      <div class="ws-env-note">In <a href="https://www.dotenv.org/docs/security/env" target="_blank" rel="noopener noreferrer">.env format</a>.</div>
      <div class="ws-env-err"></div>
      <div class="ws-env-actions"></div>`;
    const name = form.querySelector(".ws-env-name") as HTMLInputElement;
    const network = form.querySelector(".ws-env-network") as HTMLSelectElement;
    const vars = form.querySelector(".ws-env-vars") as HTMLTextAreaElement;
    const err = form.querySelector(".ws-env-err") as HTMLElement;
    const actions = form.querySelector(".ws-env-actions") as HTMLElement;
    for (const o of NETWORK_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = o.id; opt.textContent = o.label;
      network.appendChild(opt);
    }
    network.value = "full";
    form.querySelectorAll("input, select, textarea").forEach((el) => el.addEventListener("mousedown", (ev) => ev.stopPropagation()));
    let varsDirty = false;
    vars.addEventListener("input", () => { varsDirty = true; });
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "action-btn primary ws-env-submit";
    submit.textContent = editing ? "Save environment" : "Create environment";
    let remove: HTMLButtonElement | null = null;
    if (editing) {
      remove = document.createElement("button");
      remove.type = "button";
      remove.className = "action-btn danger ws-env-delete";
      remove.textContent = "Delete environment";
      actions.appendChild(remove);
    }
    actions.appendChild(submit);
    showDropDetail(m, list, { title: editing ? "Edit cloud environment" : "New cloud environment", body: form });
    place(envBtn);
    const back = (): void => { m.querySelector(".drop-detail")?.remove(); list.classList.remove("hidden"); place(envBtn); };
    const d = doors();
    if (!d) { err.textContent = "This build can't reach the cloud environments yet."; return; }
    if (editing) {
      name.value = editing.name; network.value = editing.network; vars.disabled = true;
      void d.cloudEnvironmentsGet(editing.id)
        .then((detail) => { name.value = detail.name; network.value = detail.network; vars.value = maskedDotenv(detail.vars); })
        .catch((e) => { err.textContent = environmentSaveError(e); })
        .finally(() => { vars.disabled = false; });
    }
    submit.addEventListener("click", () => {
      const problem = environmentFormError({ name: name.value, vars: editing && !varsDirty ? "" : vars.value });
      if (problem) { err.textContent = problem; return; }
      submit.disabled = true; err.textContent = "";
      const net = network.value as EnvironmentNetwork;
      void (editing
        ? d.cloudEnvironmentsUpdate(editing.id, { name: name.value.trim(), network: net, ...(varsDirty ? { vars: vars.value } : {}) })
        : d.cloudEnvironmentsCreate({ name: name.value.trim(), network: net, vars: vars.value }))
        .then(async (saved) => {
          await loadEnvironments();
          // A new environment is the pick; an edit keeps whatever was picked.
          if (!editing && !born()) pickCloud(picks(), saved.id);
          closeMenu();
          paint();
        })
        .catch((e) => { err.textContent = environmentSaveError(e); submit.disabled = false; });
    });
    name.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submit.click(); });
    let confirmDelete = false;
    remove?.addEventListener("click", () => {
      if (!editing) return;
      if (!confirmDelete) { confirmDelete = true; remove!.textContent = "Click again to delete"; return; }
      remove!.disabled = true; submit.disabled = true; err.textContent = "";
      void d.cloudEnvironmentsDelete(editing.id)
        .then(async () => {
          await loadEnvironments();
          // The deleted pick falls back to Default (environmentName does the
          // same for a row deleted elsewhere) — the record says so too.
          if (envId() === editing.id && !born()) pickCloud(picks(), DEFAULT_ENVIRONMENT_ID);
          back();
          paint();
        })
        .catch((e) => { err.textContent = environmentSaveError(e); remove!.disabled = false; submit.disabled = false; });
    });
    requestAnimationFrame(() => name.focus());
  };

  const loadEnvironments = async (): Promise<void> => {
    const d = doors();
    if (!d) return;
    environments = await d.cloudEnvironmentsList();
    paint();
  };

  // ── Repositories → Choose base branch ───────────────────────────────────
  const openRepos = (note = ""): void => {
    const m = openMenu(repoBtn);
    let err = note;
    let query = "";
    let view: { kind: "list" } | { kind: "branches" } | { kind: "branch"; repo: string; rows: BranchRow[] | null } = { kind: "list" };
    const locked = born();

    const draw = (): void => {
      if (!menu || menu !== m) return;
      m.textContent = "";
      if (view.kind === "branches") { drawBranches(); place(repoBtn); return; }
      if (view.kind === "branch") { drawBranch(view.repo, view.rows); place(repoBtn); return; }
      const ps = picks();
      m.insertAdjacentHTML("beforeend", `<div class="code-drop-head"><span></span></div>`);
      (m.querySelector(".code-drop-head span") as HTMLElement).textContent = git === "on" ? `Repositories (${ps.length})` : "Repositories";
      if (git === "on") {
        const search = document.createElement("input");
        search.type = "text";
        search.className = "loop-drop-search repo-drop-search";
        search.placeholder = "Search repositories…";
        search.spellcheck = false; search.autocomplete = "off";
        search.value = query;
        search.addEventListener("mousedown", (ev) => ev.stopPropagation());
        search.addEventListener("input", () => { query = search.value; drawList(); });
        m.appendChild(search);
      }
      const body = document.createElement("div");
      body.className = "ws-drop-body";
      m.appendChild(body);
      const list = document.createElement("div");
      list.className = "code-repo-drop-list ws-repo-list";
      body.appendChild(list);
      const foot = document.createElement("div");
      foot.className = "ws-repo-foot";
      body.appendChild(foot);

      const drawList = (): void => {
        list.textContent = "";
        foot.textContent = "";
        if (err) {
          list.insertAdjacentHTML("beforeend", `<div class="ws-note ws-env-err"></div>`);
          (list.querySelector(".ws-env-err") as HTMLElement).textContent = err;
        }
        if (git === "unknown") { list.insertAdjacentHTML("beforeend", `<div class="drop-empty">Loading…</div>`); return; }
        if (git === "connecting") { list.insertAdjacentHTML("beforeend", `<div class="drop-empty">Waiting for GitHub — finish in the tab that opened…</div>`); return; }
        if (git === "off") {
          const row = drillItem("Connect GitHub…", "Link your account — a cloud session checks out one of its repositories", CHEV);
          row.addEventListener("click", connect);
          list.appendChild(row);
          list.insertAdjacentHTML("beforeend", `<div class="ws-note"><div class="ws-note-body">Opens GitHub in a new tab; come back here when it is linked.</div></div>`);
          return;
        }
        // Linked: Selected on top, the rest by owner, the search over both.
        const ps2 = picks();
        const secLabel = (text: string): void => {
          const lbl = document.createElement("div");
          lbl.className = "ws-sec-label";
          lbl.textContent = text;
          list.appendChild(lbl);
        };
        const repoRow = (r: RepoRow, on: boolean): HTMLButtonElement => {
          const { owner, name } = splitRepo(r.fullName);
          const row = drillItem(name, owner, on ? CHECK : "");
          if (on) row.classList.add("selected");
          if (locked) markUnreachable(row, LOCUS_LOCKED_HINT.cloud);
          else row.addEventListener("click", () => { pickCloud(toggleRepo(ps2, r), envId()); draw(); });
          return row;
        };
        const known = repos ?? [];
        if (ps2.length) {
          secLabel("Selected");
          for (const p of ps2) {
            const r = known.find((k) => k.fullName === p.repo) ?? { id: p.repo, fullName: p.repo, private: false, defaultBranch: p.branch };
            list.appendChild(repoRow(r, true));
          }
        }
        const groups = groupRepos(known.filter((r) => !ps2.some((p) => p.repo === r.fullName)), query);
        if (repos === null) list.insertAdjacentHTML("beforeend", `<div class="drop-empty">Loading repositories…</div>`);
        else if (!groups.length) list.insertAdjacentHTML("beforeend", `<div class="drop-empty">${known.length ? (query ? "No repositories match." : "Every repository is selected.") : "No repositories found — grant the Glyphh app some on GitHub."}</div>`);
        for (const g of groups) {
          secLabel(g.owner);
          for (const r of g.repos) list.appendChild(repoRow(r, false));
        }
        if (ps2.length) {
          const next = drillItem("Choose base branch", ps2.map((p) => `${splitRepo(p.repo).name} · ${p.branch || "default"}`).join(", "), CHEV);
          next.addEventListener("click", () => { view = { kind: "branches" }; draw(); });
          foot.appendChild(next);
        }
        const manage = drillItem("Manage repository access…", "Grant the Glyphh app more repositories on GitHub", "");
        manage.addEventListener("click", () => { window.open("https://github.com/settings/installations", "_blank", "noopener"); });
        foot.appendChild(manage);
        const disc = drillItem("Disconnect GitHub", "Unlink this account (repos stop listing here)", "");
        if (locked) markUnreachable(disc, LOCUS_LOCKED_HINT.cloud);
        else disc.addEventListener("click", () => {
          void doors()?.cloudGitDisconnect()
            .then(() => { git = "off"; repos = null; pickCloud([], envId()); draw(); })
            .catch(() => { /* the rows stay; a failed unlink changes nothing */ });
        });
        foot.appendChild(disc);
      };
      drawList();
      place(repoBtn);
      if (git === "on") requestAnimationFrame(() => (m.querySelector(".repo-drop-search") as HTMLInputElement | null)?.focus());
    };

    const drawBranches = (): void => {
      backHead(m, "Choose base branch", () => { view = { kind: "list" }; draw(); });
      const body = document.createElement("div");
      body.className = "ws-drop-body code-repo-drop-list";
      m.appendChild(body);
      const ps = picks();
      if (!ps.length) body.insertAdjacentHTML("beforeend", `<div class="drop-empty">Pick a repository first.</div>`);
      for (const p of ps) {
        const row = drillItem(p.repo, p.branch || "default branch", CHEV);
        if (locked) markUnreachable(row, LOCUS_LOCKED_HINT.cloud);
        else row.addEventListener("click", () => {
          view = { kind: "branch", repo: p.repo, rows: null };
          draw();
          const r = (repos ?? []).find((k) => k.fullName === p.repo);
          void (doors()?.cloudGitBranches(p.repo, r?.defaultBranch || p.branch || "main") ?? Promise.resolve([{ name: p.branch || "main", default: true }]))
            .then((rows) => { if (view.kind === "branch" && view.repo === p.repo) { view = { kind: "branch", repo: p.repo, rows }; draw(); } });
        });
        body.appendChild(row);
      }
      if (ps.length > 1) body.insertAdjacentHTML("beforeend", `<div class="ws-note"><div class="ws-note-body">The first repository is the one the cloud workspace checks out; the rest ride with the session for later.</div></div>`);
    };

    const drawBranch = (repo: string, rows: BranchRow[] | null): void => {
      backHead(m, repo, () => { view = { kind: "branches" }; draw(); });
      const body = document.createElement("div");
      body.className = "ws-drop-body code-repo-drop-list";
      m.appendChild(body);
      if (!rows) { body.insertAdjacentHTML("beforeend", `<div class="drop-empty">Loading…</div>`); return; }
      const cur = picks().find((p) => p.repo === repo)?.branch;
      for (const b of rows) {
        const row = drillItem(b.name, b.default ? "default" : "", cur === b.name ? CHECK : "");
        if (cur === b.name) row.classList.add("selected");
        row.addEventListener("click", () => { pickCloud(setBranch(picks(), repo, b.name), envId()); view = { kind: "branches" }; draw(); });
        body.appendChild(row);
      }
    };

    /** Connect GitHub: the SDK's link opens in a new tab (`returnTo` = this
     *  page); status polls every 2 s (3 min cap); a `pending` answer (the
     *  return landed in another tab) is completed from here, linkless. */
    const connect = (): void => {
      const d = doors();
      if (!d) { err = "This build can't reach GitHub yet."; draw(); return; }
      err = "";
      // The return lands on the small connect-done page, not on a second copy
      // of the app (his report, 2026-10-05); this tab's poll sees the status flip.
      void d.cloudGitConnect(`${window.location.origin}/github/done`)
        .then(({ url }) => {
          if (!url) { err = "GitHub is not reachable right now."; draw(); return; }
          window.open(url, "_blank", "noopener");
          git = "connecting";
          draw();
          paint();
          const mine = ++pollAbort;
          const started = Date.now();
          const tick = async (): Promise<void> => {
            if (mine !== pollAbort) return;
            let st = await d.cloudGitStatus();
            if (!st.connected && st.pending) {
              try { st = await d.cloudGitComplete(); }
              catch (e) { git = "off"; err = gitCompleteError(e); draw(); paint(); opts.onChange(); return; }
            }
            if (mine !== pollAbort) return;
            if (st.connected) { git = "on"; await loadRepos(); draw(); paint(); opts.onChange(); return; }
            if (Date.now() - started >= 180_000) { git = "off"; err = "GitHub did not finish linking — try again."; draw(); paint(); return; }
            pollTimer = setTimeout(() => { void tick(); }, 2000);
          };
          pollTimer = setTimeout(() => { void tick(); }, 2000);
        })
        .catch((e) => { err = e instanceof Error && e.message ? e.message : "GitHub is not reachable right now."; draw(); });
    };

    draw();
    void settleGit().then(async () => { if (git === "on" && repos === null) await loadRepos(); draw(); });
  };

  const loadRepos = async (): Promise<void> => {
    const d = doors();
    repos = d ? await d.cloudGitRepos() : [];
  };

  /** The link state, read once per open and at boot; a failed read is "not
   *  connected" (the door never throws). */
  const settleGit = async (): Promise<void> => {
    const d = doors();
    if (!d) { git = "off"; paint(); return; }
    const st = await d.cloudGitStatus();
    git = st.connected ? "on" : "off";
    paint();
    opts.onChange();
  };

  envBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu && menu.parentElement && menu.classList.contains("ws-env-open")) { closeMenu(); return; }
    openEnvironment();
    menu?.classList.add("ws-env-open");
  });
  repoBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu && menu.classList.contains("ws-repo-open")) { closeMenu(); return; }
    openRepos();
    menu?.classList.add("ws-repo-open");
  });

  paint();
  void settleGit();
  void loadEnvironments();

  return {
    els: [envBtn, repoBtn],
    refresh: paint,
    gitConnected: () => git === "on",
    completePendingLink: (link) => {
      const d = doors();
      if (!d) return;
      void d.cloudGitComplete(link || undefined)
        .then((st) => { git = st.connected ? "on" : "off"; paint(); opts.onChange(); if (st.connected) openRepos(); })
        .catch((e) => { git = "off"; paint(); opts.onChange(); openRepos(gitCompleteError(e)); });
    },
    openRepos,
  };
}
