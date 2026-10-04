/**
 * settings-agent.ts — Settings → General: what the agent starts with, and the
 * embeddings model behind memory and search.
 *
 * This is what survived settings-loops.ts. That page configured a roster of
 * vendor-CLI loops — a name, a command, a key, a session mode, a default view
 * (chat or the CLI in a terminal) — and it went with the bridge (his order,
 * 2026-09-28: one loop, no switching). What a member still chooses is the
 * MODEL a new session opens on, from the list their organization allows.
 */

import { onWeb } from "./web-surface.js";

const el = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const api = () => window.glyphh as unknown as {
  getPreference?: (k: string, d: unknown) => Promise<unknown>;
  setPreference?: (k: string, v: unknown) => void;
  loopModels?: (loopId: string, force?: boolean) => Promise<{ ok: boolean; source: string; models: Array<{ id: string; name: string; providerSlug: string }> }>;
  planGates?: () => Promise<{ gatewayAllowed?: boolean; defaultModel?: string }>;
  onModelsChanged?: (cb: () => void) => () => void;
};

let wired = false;

/**
 * THE DEFAULT MODEL — THE MEMBER'S OWN CHOICE, from their team's list (his
 * order, 2026-09-29: "the user should be able to set the default model to
 * whatever they want. The organization list is what feeds this dropdown. If the
 * org limits the teams models to only say auto that is all the user can
 * choose").
 *
 * So the LIST is the only constraint: it is the same answer the composer's
 * picker gets, and a team limited to one model leaves one choice. Auto only
 * used to disable this control and pin it to the router — a second gate over
 * the list, which is the gate.
 *
 * "" means "no choice of mine": the team's flagged default seeds it, and the
 * org's own default stands behind that. Storing "" rather than a name keeps
 * the answer moving with the team instead of freezing whatever was true the
 * day this page was last opened.
 */
/**
 * THE CLI AGENTS' GATEWAY DEFAULT (his order, 2026-09-30: "if the user is
 * paying for glyphh we allow them to pass the gateway to the agent but we need
 * some way to allow them to set that they either want that or they don't").
 * Off by default; a workspace slot can override it. Free has no gateway for a
 * CLI, so the switch is shown off and locked there.
 */
export async function loadCliGatewaySetting(): Promise<void> {
  const box = el<HTMLInputElement>("toggle-cli-gateway");
  const desc = el("cli-gateway-desc");
  if (!box) return;
  // WEB: the CLIs run in the worker's terminal and sign in on their own there
  // (his order, 2026-10-04) — the gateway env is written by the DESKTOP main
  // process at open time (cli-agents.ts), which a browser tab has no part of.
  // The switch would persist a pref nothing on web reads: hide the row.
  if (onWeb()) { el("cli-gateway-row")?.classList.add("hidden"); return; }
  const g = window.glyphh as unknown as { cliAgentsList?: () => Promise<{ ok: boolean; hasPlan?: boolean; gatewayDefault?: boolean }> };
  const r = await g.cliAgentsList?.().catch(() => null);
  const paid = r?.hasPlan !== false;
  box.checked = paid && !!r?.gatewayDefault;
  box.disabled = !paid;
  if (!paid && desc) desc.textContent = "Needs a paid plan. On Free, your CLIs run on their own login and can still drive your workspace.";
  box.onchange = () => { api().setPreference?.("cliGateway", box.checked); };
}

export async function loadAgentDefaults(): Promise<void> {
  void loadCliGatewaySetting();
  const modelSel = el<HTMLSelectElement>("set-default-model");
  const hint = el("set-default-hint");
  if (!modelSel) return;

  const [gates, saved, list] = await Promise.all([
    api().planGates?.().catch(() => null) ?? Promise.resolve(null),
    api().getPreference?.("defaultModel", "") ?? Promise.resolve(""),
    // Fresh from the server every time the page opens (his report, 2026-09-29).
    api().loopModels?.("glyphh", true).catch(() => null) ?? Promise.resolve(null),
  ]);
  const models = (list?.ok ? list.models : []).map((m) => ({ id: `${m.providerSlug}::${m.id}`, name: m.name || m.id, providerSlug: m.providerSlug }));
  if (!wired) {
    wired = true;
    modelSel.addEventListener("change", () => {
      api().setPreference?.("defaultModel", modelSel.value);
      void loadAgentDefaults();
    });
    // The server moved the list or the defaults while this page is open.
    api().onModelsChanged?.(() => void loadAgentDefaults());
  }
  // What the team seeds when this member has chosen nothing.
  const seeded = String(gates?.defaultModel || "").trim();
  const seededName = models.find((m) => m.id.endsWith(`::${seeded}`) || m.name === seeded)?.name || seeded;

  if (!models.length) {
    modelSel.innerHTML = `<option value="">No models available</option>`;
    modelSel.disabled = true;
    if (hint) hint.textContent = "Your organization hasn't allowed any model yet. An org admin turns them on in the console.";
    return;
  }
  modelSel.disabled = false;
  modelSel.innerHTML = [`<option value="">${seededName ? `My team's default — ${seededName}` : "My team's default"}</option>`]
    .concat(models.map((m) => `<option value="${m.id}">${m.name}</option>`))
    .join("");
  const want = String(saved ?? "");
  modelSel.value = models.some((m) => m.id === want) ? want : "";
  if (hint) {
    hint.textContent = modelSel.value
      ? `A new session opens on ${models.find((m) => m.id === modelSel.value)?.name ?? modelSel.value}.`
      : seededName
        ? `A new session opens on ${seededName}, the default your team is set to. Pick a model above to use your own.`
        : "A new session opens on whichever model your organization has set as its default.";
  }
}

// ── Settings → Memory: embeddings ───────────────────────────────────────────
// The GATEWAY embeds (his order, 2026-09-16): the dropdown lists the org's
// embedding models; no key lives here. An org with none published gets a
// disabled control saying so — the feature is off until an admin configures it.
export async function loadEmbeddingsSettings(): Promise<void> {
  const modelSel = el<HTMLSelectElement>("set-embeddings-model");
  const desc = el("set-embeddings-desc");
  if (!modelSel) return;
  const g = window.glyphh as unknown as {
    embeddingsConfigGet?: () => Promise<{ ok: boolean; model: string; models: Array<{ id: string; name: string; providerSlug: string }> }>;
    embeddingsConfigSet?: (i: { model?: string }) => Promise<{ ok: boolean; model?: string; error?: string }>;
  };
  const cfg = await g.embeddingsConfigGet?.().catch(() => null);
  if (!cfg?.ok) return;

  const models = cfg.models ?? [];
  if (!models.length) {
    modelSel.innerHTML = `<option value="">None available</option>`;
    modelSel.disabled = true;
    if (desc) desc.textContent = "Configure embeddings models in your organization's admin console to enable memory, search and app data.";
    return;
  }
  modelSel.disabled = false;
  modelSel.innerHTML = [`<option value="">Off</option>`]
    .concat(models.map((m) => `<option value="${m.id}"${m.id === cfg.model ? " selected" : ""}>${m.name}</option>`))
    .join("");
  if (desc) desc.textContent = "Powers memory, search and app data. Embedding runs on the Glyphh gateway with your own key.";
  modelSel.onchange = () => { void g.embeddingsConfigSet?.({ model: modelSel.value }); };
}
