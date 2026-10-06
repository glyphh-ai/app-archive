/**
 * attach-handlers — the machine capabilities beyond panels, fs and pty that
 * the local MCP server exposes today and the attach socket exposes again
 * (RELAY-RESEARCH.md §4). Everything runs on-machine via the shared registry
 * (registerRelayHandler), so loopback MCP and the attach socket offer one
 * surface.
 *
 *   fs.list     {path?}        → the web folder picker's home-capped browse
 *   fs.gitInfo  {path?}        → is git enabled on that folder, on what branch
 *   fs.mkdir    {path?, name}  → one new folder under home
 *   machine.appsList {}        → the native apps installed here
 *   machine.appOpen  {app}     → launch one by (fuzzy) name
 *   machine.openUrl  {url}     → open an http(s) url in the default browser
 *   scrape.page {url, wait?}   → load a URL headlessly, return title/text/html
 *   sessions.list {}           → this machine's chats, newest first (metadata)
 *   sessions.get  {id}         → one chat's last 200 messages
 *   sessions.put  {id, title?, mode?, workdir?} → create a chat / patch its metadata
 *   sessions.delete {id}       → delete one chat
 *   cliSessions.list {}        → the vendor CLIs' own sessions on this machine (Claude, Codex,
 *                                Gemini, Copilot, Cursor, the Glyphh CLI): the rows the desktop's
 *                                cli-sessions-list IPC lists, read-only, each with its resume handle
 *   layouts.list {}            → this machine's workspaces (the layouts-list rows)
 *   layouts.get  {name}        → one workspace by name
 *   panelApps.list {}          → this machine's app tabs (the panel-apps-list rows)
 *   apps.install {path | url | bundleBase64} → a .glyphh bundle becomes a CLOUD INSTANCE
 *                                (glyphh-app-host.ts installGlyphhAppBundle): the local MCP's
 *                                app_install (docs/GLYPHH-APP-SPEC.md §3). Loopback only — the
 *                                server never lists it for remote control, and an app's tools
 *                                are the gateway's (app_list_tools / app_call_tool), never a
 *                                machine's.
 *
 * The sessions.* four are mobile.glyphh.ai's whole view of the chats: they
 * live on this machine only (the chat store in agent-ipc.ts), so the phone
 * lists and opens them over the attach socket.
 *
 * layouts.* and panelApps.list are app.glyphh.ai's view of the Customize
 * libraries (his report, 2026-10-04: "none of my workspaces, app tabs, etc.
 * are showing on the web"). Since the purge of 2026-09-10 a workspace is a
 * folder under ~/.glyphh/workspaces and an app tab a folder under
 * ~/.glyphh/apps — files on this machine, never written to the server — so
 * the web reads them here, the way it reads the chats. READS ONLY: a change
 * is made on the desktop (the web's shims say so when a write is attempted).
 *
 * loops.run / skills.run / agents.run are gone with the scheduler they ran on
 * (2026-09-21); tasks are programs the desktop runs, and the MCP tools that
 * pointed at them were removed rather than left throwing "unknown method".
 */

import { BrowserWindow, shell } from "electron";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { registerRelayHandler } from "./relay-client.js";
import { findInstalledApp, launchInstalledApp, listInstalledApps } from "./installed-apps.js";
import { deleteStoredChat, getStoredChat, listStoredChats, upsertStoredChat, type RelayChat } from "./agent-ipc.js";
import { listCliSessions } from "./cli-agents.js";
import { desktopLayouts, getLayoutManager, toLayoutRow } from "./layout-manager.js";
import { fetchOrgApps } from "./org-apps.js";
import { installGlyphhAppBundle, installGlyphhAppBundleFromBase64, type InstallAnswer } from "./glyphh-app-host.js";

function str(params: unknown, key: string): string {
  const v = (params as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : "";
}

/** Read straight off `.git`: no shell, answers the moment a folder is picked.
 *  A `.git` FILE (worktree, submodule) still means git is enabled here. */
export function gitStateOf(dir: string): { isRepo: boolean; branch?: string } {
  const dot = join(dir, ".git");
  if (!existsSync(dot)) return { isRepo: false };
  try {
    const gitDir = statSync(dot).isDirectory()
      ? dot
      : join(dir, (readFileSync(dot, "utf8").match(/^gitdir:\s*(.+)$/m)?.[1] ?? "").trim());
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    return { isRepo: true, branch: ref ? ref[1] : head.slice(0, 7) };
  } catch {
    return { isRepo: true };
  }
}

/** A chat as the phone lists it: never its messages. */
function sessionMeta(c: RelayChat): Record<string, unknown> {
  const folder = c.workdir || ((c.source as { kind?: string; path?: string } | undefined)?.kind === "local" ? (c.source as { path?: string }).path : undefined);
  return {
    id: c.id, title: c.title?.trim() || "New session",
    createdAt: c.createdAt ?? c.updatedAt ?? 0, updatedAt: c.updatedAt ?? c.createdAt ?? 0,
    mode: c.mode === "work" || c.mode === "chat" ? "work" : "code",
    messageCount: c.messages?.length ?? 0,
    ...(folder ? { source: { kind: "local", path: folder } } : {}),
    ...(c.pinned ? { pinned: true } : {}),
  };
}

export function installAttachHandlers(): void {
  registerRelayHandler("sessions.list", async () => ({
    sessions: listStoredChats().map(sessionMeta).sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt)),
  }));

  registerRelayHandler("sessions.get", async (params) => {
    const id = str(params, "id");
    if (!id) throw new Error("sessions.get requires { id }");
    const c = getStoredChat(id);
    if (!c) throw new Error(`no session ${id} on this machine`);
    const messages = (c.messages ?? [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant"))
      .slice(-200)
      .map((m) => ({ role: m.role, text: typeof m.text === "string" ? m.text : "" }));
    return { session: { ...sessionMeta(c), messages } };
  });

  registerRelayHandler("sessions.put", async (params) => {
    const id = str(params, "id");
    if (!id) throw new Error("sessions.put requires { id }");
    const chat = upsertStoredChat(id, { title: str(params, "title"), mode: str(params, "mode"), workdir: str(params, "workdir") });
    return { session: sessionMeta(chat) };
  });

  // THE CLI SESSIONS TOO (his report, 2026-10-04: the web rail showed only
  // the Glyphh threads — `sessions.list` is the Glyphh chat store alone).
  // The same rows the desktop rail draws with the `>_` + vendor mark; `resume`
  // is what the CLI's own --resume takes (the session id), `updatedAt` the
  // file's clock. A read of the vendors' stores, never a write.
  registerRelayHandler("cliSessions.list", async () => ({
    sessions: listCliSessions().map((r) => ({ id: r.id, cli: r.cli, title: r.title, cwd: r.cwd, mtime: r.mtime, updatedAt: r.mtime, resume: r.id })),
  }));

  registerRelayHandler("sessions.delete", async (params) => {
    const id = str(params, "id");
    if (!id) throw new Error("sessions.delete requires { id }");
    return { deleted: deleteStoredChat(id) };
  });

  // The Customize libraries, read-only — the same rows the desktop's own
  // layouts-list / panel-apps-list IPC hand the renderer: this machine's
  // workspaces are the ones made on a desktop (his order, 2026-10-06).
  registerRelayHandler("layouts.list", async () => ({
    layouts: desktopLayouts(await getLayoutManager().refreshAndList()).map(toLayoutRow),
  }));

  registerRelayHandler("layouts.get", async (params) => {
    const name = str(params, "name");
    if (!name) throw new Error("layouts.get requires { name }");
    const hit = (await getLayoutManager().refreshAndList()).find((l) => l.name === name);
    if (!hit) throw new Error(`no workspace "${name}" on this machine`);
    return { layout: toLayoutRow(hit) };
  });

  registerRelayHandler("panelApps.list", async () => ({ apps: await fetchOrgApps() }));

  // INSTALL A BUNDLE IN THE CLOUD — the local MCP's app_install. A .glyphh
  // ({ path } on this machine, { url }, or { bundleBase64 }) is validated here
  // and becomes (or updates) the member's instance; its tab names it.
  registerRelayHandler("apps.install", async (params) => {
    const p = params as { bundleBase64?: string; path?: string; url?: string } | null;
    let r: InstallAnswer;
    if (p?.path) {
      // Preferred: the bundle is already on this machine — read it directly
      // instead of round-tripping megabytes of base64 through the LLM.
      const filePath = p.path.replace(/^~(?=$|\/)/, homedir());
      if (!existsSync(filePath)) throw new Error(`bundle not found: ${filePath}`);
      r = await installGlyphhAppBundle(filePath);
    } else if (p?.url) {
      const res = await fetch(p.url);
      if (!res.ok) throw new Error(`bundle download failed: HTTP ${res.status}`);
      r = await installGlyphhAppBundleFromBase64(Buffer.from(await res.arrayBuffer()).toString("base64"));
    } else if (p?.bundleBase64) {
      r = await installGlyphhAppBundleFromBase64(String(p.bundleBase64));
    } else {
      throw new Error("apps.install requires { path } (a .glyphh on this machine), { url }, or { bundleBase64 }");
    }
    if (!r.ok) throw new Error(r.error || "install failed");
    // The connections the app declared ride the answer: the caller tells the
    // user to connect them in Glyphh → Connections before the tools will work.
    return { installed: r.name, instance: r.instance, updated: !!r.updated, requiredConnections: r.connectors ?? [], tools: r.tools ?? [] };
  });

  registerRelayHandler("fs.list", async (params) => {
    const home = homedir();
    let path = str(params, "path") || home;
    if (!path.startsWith(home)) path = home;
    let entries: Array<{ name: string; path: string; dir: boolean; git?: boolean }> = [];
    try {
      entries = readdirSync(path, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => {
          const full = join(path, d.name);
          return { name: d.name, path: full, dir: true, ...(existsSync(join(full, ".git")) ? { git: true } : {}) };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      throw new Error(`could not list ${path}: ${(err as Error).message}`);
    }
    return { path, parent: path === home ? null : dirname(path), root: home, entries, git: gitStateOf(path) };
  });

  registerRelayHandler("fs.gitInfo", async (params) => {
    const home = homedir();
    const path = str(params, "path") || home;
    if (!path.startsWith(home)) throw new Error("fs.gitInfo is capped at your home folder");
    return { path, ...gitStateOf(path) };
  });

  registerRelayHandler("fs.mkdir", async (params) => {
    const home = homedir();
    const parent = str(params, "path") || home;
    const name = str(params, "name").trim();
    if (!name || name.startsWith(".") || /[/\\:]/.test(name)) throw new Error("fs.mkdir needs a plain folder name");
    if (!parent.startsWith(home)) throw new Error("fs.mkdir is capped at your home folder");
    const full = join(parent, name);
    if (existsSync(full)) throw new Error(`"${name}" already exists here`);
    mkdirSync(full);
    return { name, path: full, dir: true };
  });

  registerRelayHandler("machine.appsList", async () => ({ apps: listInstalledApps().map((a) => a.name) }));

  registerRelayHandler("machine.appOpen", async (params) => {
    const ref = str(params, "app");
    if (!ref) throw new Error("machine.appOpen requires { app }");
    const app = findInstalledApp(ref);
    if (!app) throw new Error(`no installed app matches '${ref}'`);
    launchInstalledApp(app);
    return { opened: app.name };
  });

  registerRelayHandler("machine.openUrl", async (params) => {
    const url = str(params, "url");
    if (!/^https?:\/\//i.test(url)) throw new Error("machine.openUrl requires an http(s) { url }");
    await shell.openExternal(url);
    return { opened: url };
  });

  // Headless scrape: a hidden, sandboxed window loads the URL, we pull
  // title + text + html, then destroy it.
  registerRelayHandler("scrape.page", async (params) => {
    const url = str(params, "url");
    if (!/^https?:\/\//i.test(url)) throw new Error("scrape.page requires an http(s) { url }");
    const waitMs = Math.min(Math.max(Number((params as Record<string, unknown>)?.wait) || 0, 0), 15_000);
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: true, images: false, sandbox: true, contextIsolation: true } });
    try {
      await win.loadURL(url);
      if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
      const [title, text, html] = await Promise.all([
        win.webContents.executeJavaScript("document.title").catch(() => ""),
        win.webContents.executeJavaScript("document.body ? document.body.innerText : ''").catch(() => ""),
        win.webContents.executeJavaScript("document.documentElement.outerHTML").catch(() => ""),
      ]);
      return { url: win.webContents.getURL() || url, title: String(title || ""), text: String(text || "").slice(0, 200_000), html: String(html || "").slice(0, 500_000) };
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  });
}
