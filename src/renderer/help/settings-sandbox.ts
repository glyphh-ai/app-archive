/**
 * settings-sandbox.ts — Settings → System → Sandbox (his order, 2026-10-09: "add
 * the settings for the sandbox… don't go overboard just lock it down"): the
 * hosts and local ports the member allowed (each can be taken back) and Strict
 * sandbox. The deny-list and the fence itself are not settings.
 */

interface SandboxView { builtIn: string[]; hosts: string[]; ports: number[]; strict: boolean }

type Bridge = {
  sandboxGet?: () => Promise<SandboxView>;
  sandboxRemoveHost?: (host: string) => Promise<SandboxView>;
  sandboxRemovePort?: (port: number) => Promise<SandboxView>;
  sandboxSetStrict?: (on: boolean) => Promise<SandboxView>;
};

const bridge = (): Bridge => window.glyphh as unknown as Bridge;
const el = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
let wired = false;

function rows(title: string, items: string[], empty: string, remove: (item: string) => void): HTMLElement {
  const box = document.createElement("div");
  const h = document.createElement("div");
  h.className = "set-pref-title";
  h.style.margin = "12px 0 4px";
  h.textContent = title;
  box.appendChild(h);
  if (!items.length) {
    const d = document.createElement("div");
    d.className = "set-pref-desc";
    d.textContent = empty;
    box.appendChild(d);
  }
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "set-pref-row";
    const text = document.createElement("div");
    text.className = "set-pref-text";
    text.textContent = item;
    const val = document.createElement("div");
    val.className = "set-pref-value";
    const b = document.createElement("button");
    b.className = "action-btn";
    b.type = "button";
    b.textContent = "Remove";
    b.addEventListener("click", () => remove(item));
    val.appendChild(b);
    row.append(text, val);
    box.appendChild(row);
  }
  return box;
}

function paint(v: SandboxView): void {
  const strict = el<HTMLInputElement>("toggle-sandbox-strict");
  if (strict) strict.checked = v.strict;
  const builtIn = el("sandbox-builtin");
  if (builtIn) builtIn.textContent = `Always allowed: package registries and git hosts (${v.builtIn.join(", ")}).`;
  const hosts = el("sandbox-hosts");
  if (hosts) hosts.replaceChildren(rows("Hosts you allowed", v.hosts, "None yet. A session asks the first time a command reaches a new host.", (h) => { void bridge().sandboxRemoveHost?.(h).then(paint); }));
  const ports = el("sandbox-ports");
  if (ports) ports.replaceChildren(rows("Local ports you allowed", v.ports.map(String), "None. Your local services are reachable only once you allow their port.", (p) => { void bridge().sandboxRemovePort?.(Number(p)).then(paint); }));
}

export async function loadSandbox(): Promise<void> {
  const b = bridge();
  if (!b.sandboxGet) return;
  if (!wired) {
    wired = true;
    el<HTMLInputElement>("toggle-sandbox-strict")?.addEventListener("change", (e) => {
      void b.sandboxSetStrict?.((e.target as HTMLInputElement).checked).then(paint);
    });
  }
  const v = await b.sandboxGet().catch(() => null);
  if (v) paint(v);
}
