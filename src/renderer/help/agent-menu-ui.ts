/**
 * agent-menu-ui.ts — paints agent-menu.ts's model into the agent window's
 * top-right ⋮ (#code-tools-menu), on the web AND the desktop (his order,
 * 2026-10-05: ONE menu on the agent's top row, never an empty dropdown).
 *
 * WEB: the Apps rows come off the attached desktop (web-contract.js
 * desktopAppsList → `panelApps.list` over the relay) and open THERE
 * (desktopPanelOpen → `panels.open {app}`); the web only toasts "Opened on
 * <machine>". The CLI rows open the worker's terminal through the
 * workbench's own door (__wbOpenAgentCli — a cloud session's CLI runs on its
 * pod); a desktop CLI session under them resumes on the desktop through the
 * rail's own open (help/code.ts sessOpen, handed in).
 * BOTH: the Panels rows open the workbench views for the session's type; the
 * Session rows are the old head kebab's (Rename / Pin / New agent panel /
 * Delete), handed in from code.ts, shown only while a session is open.
 *
 * Every open repaints from the last answer at once and refreshes behind it.
 */
import { hostHas, onWeb } from "./web-surface.js";
import { toast } from "./toast.js";
import {
  agentMenuModel, openedOnLine,
  type AgentMenu, type MenuAppRow, type MenuCliRow, type MenuCliSession, type MenuMachine, type MenuMode, type MenuSession, type SessionAction,
} from "./agent-menu.js";

interface MenuApi {
  attachStatus?: () => Promise<{ attached: boolean; machines: MenuMachine[] }>;
  desktopAppsList?: () => Promise<{ ok: boolean; apps: MenuAppRow[] }>;
  desktopPanelOpen?: (p: { app: string; machineId?: string }) => Promise<{ ok: boolean; name?: string; error?: string }>;
  cliAgentsList?: () => Promise<{ ok: boolean; agents: Array<{ id: string; name: string }> }>;
}
type RailSessionLike = MenuCliSession & { origin?: "cli"; locked?: boolean };
export interface AgentMenuDoors {
  /** The session on screen (null on a fresh landing) and its type. */
  session: () => MenuSession | null;
  mode: () => MenuMode;
  /** The old kebab's actions. */
  onSession: (action: SessionAction) => void;
  /** WEB: the rail's open for a desktop CLI session (resume on the desktop, grant card when locked). */
  openCliSession?: (sess: RailSessionLike) => void;
}
interface ShellDoors {
  __wbOpenAgentCli?: (id: string) => void;
  __wbOpenTool?: (view: string) => void;
  __glyphhOpenSettings?: (sub?: string) => void;
  __glyphhCliSessions?: () => Promise<RailSessionLike[]>;
}

const api = (): MenuApi => window.glyphh as unknown as MenuApi;
const shell = (): ShellDoors => window as unknown as ShellDoors;

const IC = {
  files: `<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>`,
  terminal: `<svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  monaco: `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  preview: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  diff: `<svg viewBox="0 0 24 24"><line x1="12" y1="3" x2="12" y2="21"/><polyline points="8 7 4 11 8 15"/><polyline points="16 9 20 13 16 17"/></svg>`,
  plan: `<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  agents: `<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M12 7.2v3.3M12 10.5 6.4 16.1M12 10.5l5.6 5.6"/></svg>`,
  cli: `<svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  app: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  session: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  rename: `<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  pin: `<svg viewBox="0 0 24 24"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`,
  "new-panel": `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/></svg>`,
  delete: `<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
};

/** The web's last relay answer (machines, apps, CLIs, sessions) — painted at once on the next open. */
let lastWeb: { machines: MenuMachine[]; apps: MenuAppRow[]; sessions: RailSessionLike[] } | null = null;
let clisCache: MenuCliRow[] = [];

/** The web's three relay reads + the CLI list, in parallel; each failure is an empty. */
async function readWeb(): Promise<{ machines: MenuMachine[]; apps: MenuAppRow[]; sessions: RailSessionLike[] }> {
  const a = api();
  const [status, apps, clis, sessions] = await Promise.all([
    hostHas("attachStatus") ? a.attachStatus!().catch(() => null) : Promise.resolve(null),
    hostHas("desktopAppsList") ? a.desktopAppsList!().catch(() => null) : Promise.resolve(null),
    hostHas("cliAgentsList") ? a.cliAgentsList!().catch(() => null) : Promise.resolve(null),
    (shell().__glyphhCliSessions?.() ?? Promise.resolve([] as RailSessionLike[])).catch(() => [] as RailSessionLike[]),
  ]);
  if (clis?.ok && clis.agents.length) clisCache = clis.agents.map((c) => ({ id: c.id, name: c.name }));
  return { machines: status?.machines ?? [], apps: apps?.ok ? apps.apps : [], sessions };
}

function modelFor(doors: AgentMenuDoors, web: { machines: MenuMachine[]; apps: MenuAppRow[]; sessions: RailSessionLike[] } | null): AgentMenu {
  return agentMenuModel({
    surface: onWeb() ? "web" : "desktop",
    mode: doors.mode(),
    session: doors.session(),
    machines: web?.machines ?? [],
    apps: web?.apps ?? [],
    clis: clisCache,
    cliSessions: web?.sessions ?? [],
  });
}

const row = (icon: string, label: string, cls = ""): HTMLButtonElement => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `code-view-menu-item${cls ? ` ${cls}` : ""}`;
  b.innerHTML = `${icon}<span></span>`;
  (b.querySelector("span") as HTMLElement).textContent = label;
  return b;
};
const head = (label: string): HTMLDivElement => {
  const h = document.createElement("div");
  h.className = "code-menu-head";
  h.textContent = label;
  return h;
};
const sep = (): HTMLDivElement => { const d = document.createElement("div"); d.className = "code-menu-sep"; return d; };

function appIcon(a: MenuAppRow): string {
  if (a.icon) {
    const img = document.createElement("img");
    img.className = "wam-icon";
    img.alt = "";
    img.src = a.icon;
    return img.outerHTML;
  }
  return IC.app;
}

/** Paint the model: one block per section, separators between. */
function paint(menu: HTMLElement, m: AgentMenu, doors: AgentMenuDoors, sessions: RailSessionLike[]): void {
  menu.textContent = "";
  const close = (): void => menu.classList.add("hidden");
  m.sections.forEach((s, idx) => {
    if (idx) menu.appendChild(sep());
    menu.appendChild(head(s.label));
    if (s.kind === "apps") {
      for (const a of s.rows) {
        const b = row(appIcon(a), a.name, "wam-app");
        b.title = `Open ${a.name} on ${a.machineName || "your desktop"}`;
        b.addEventListener("click", () => { close(); void openOnDesktop(a); });
        menu.appendChild(b);
      }
      if (s.note) {
        const note = document.createElement("div");
        note.className = "code-menu-note" + (s.enabled ? "" : " disabled");
        note.textContent = s.note;
        if (s.link) {
          note.append(" · ");
          const link = document.createElement("button");
          link.type = "button";
          link.className = "code-menu-link";
          link.textContent = s.link.label;
          const sub = s.link.settingsSub;
          link.addEventListener("click", (ev) => { ev.stopPropagation(); close(); shell().__glyphhOpenSettings?.(sub); });
          note.appendChild(link);
        }
        menu.appendChild(note);
      }
    } else if (s.kind === "clis") {
      for (const c of s.rows) {
        const b = row(IC.cli, c.name, "wam-cli");
        b.title = `Open ${c.name} in a cloud terminal`;
        b.addEventListener("click", () => {
          close();
          const open = shell().__wbOpenAgentCli;
          if (!open) { console.warn("[agent-menu] no CLI door — the workbench has not booted"); return; }
          open(c.id);
        });
        menu.appendChild(b);
        for (const sess of c.sessions) {
          const full = sessions.find((x) => x.id === sess.id) ?? { ...sess, origin: "cli" as const };
          const sb = row(IC.session, sess.title || sess.cwd || sess.id, "wam-sub" + (full.locked ? " locked" : ""));
          sb.title = `Resume on ${m.machine?.name || "your desktop"}${sess.cwd ? ` · ${sess.cwd}` : ""}`;
          sb.addEventListener("click", () => { close(); doors.openCliSession?.({ ...full, origin: "cli" }); });
          menu.appendChild(sb);
        }
      }
    } else if (s.kind === "tools") {
      for (const t of s.rows) {
        const b = row(IC[t.view as keyof typeof IC] ?? IC.app, t.label);
        b.dataset.view = t.view;
        b.addEventListener("click", () => { close(); shell().__wbOpenTool?.(t.view); });
        menu.appendChild(b);
      }
    } else {
      for (const r of s.rows) {
        const b = row(IC[r.action] ?? IC.session, r.label, `wam-session${r.danger ? " danger" : ""}`);
        b.dataset.action = r.action;
        b.addEventListener("click", () => { close(); doors.onSession(r.action); });
        menu.appendChild(b);
      }
    }
  });
}

/** panels.open on the desktop; the web says where it landed. */
async function openOnDesktop(a: MenuAppRow): Promise<void> {
  const open = api().desktopPanelOpen;
  if (!hostHas("desktopPanelOpen") || !open) { toast("Connect your desktop to open apps", { kind: "error" }); return; }
  const t = toast(`Opening ${a.name} on ${a.machineName || "your desktop"}…`);
  const r = await open({ app: a.slug, ...(a.machineId ? { machineId: a.machineId } : {}) }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  if (r?.ok) t.update(openedOnLine(a.machineName), { kind: "ok" });
  else t.update(`${a.name} did not open${r?.error ? `: ${r.error}` : ""}`, { kind: "error" });
}

let seq = 0;
/** Wire the ⋮: a click toggles the menu, painted from what is known at
 *  once; on the web the desktop's answer repaints it as soon as it lands. */
export function mountAgentMenu(menu: HTMLElement, moreBtn: HTMLElement, doors: AgentMenuDoors): void {
  const web = onWeb();
  menu.classList.toggle("web-agent-menu", web);
  if (web) {
    // The workbench's app doors (ctl.openApp / __wbOpenApp — an agent's
    // panels.open tool, a .dip, appLaunch) land here on the web: the app
    // opens on the attached desktop, by slug, on the first machine that has it.
    (window as unknown as { __glyphhOpenAppOnDesktop?: (a: { slug: string; name: string }) => void }).__glyphhOpenAppOnDesktop = (a) => {
      const known = lastWeb?.apps.find((r) => r.slug.toLowerCase() === a.slug.toLowerCase());
      const machine = lastWeb?.machines[0];
      void openOnDesktop(known ?? { slug: a.slug, name: a.name || a.slug, machineId: machine?.id ?? "", machineName: machine?.name ?? "" });
    };
  }
  const refresh = async (): Promise<void> => {
    const mine = ++seq;
    const read = await readWeb();
    if (mine !== seq) return;   // a later open repainted already
    lastWeb = read;
    if (!menu.classList.contains("hidden")) paint(menu, modelFor(doors, read), doors, read.sessions);
  };
  moreBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const opening = menu.classList.contains("hidden");
    menu.classList.toggle("hidden");
    if (!opening) return;
    paint(menu, modelFor(doors, lastWeb), doors, lastWeb?.sessions ?? []);
    if (web) void refresh();
  });
}
