/**
 * new-agent-route.ts — WHICH open a "new agent" press becomes, as a pure rule.
 *
 * His report, 2026-09-25: "when the user clicks new in the left rail or from
 * the echo panel to open a new agent... the ui MUST MUST create a new instance
 * of the agent. A new cli instance, a new terminal web panel. If within an
 * agent panel the user clicks the + in the top right that action starts a new
 * chat only in that window and cli."
 *
 * So there are TWO verbs, and the bug was that both front doors resolved to the
 * second one (newSessionInPlace — blank the seated agent's thread, spawn
 * nothing). The routing lives here, where it can be tested without a DOM: the
 * decision is the part that was wrong, and code-workbench.ts is bundled by
 * esbuild and typechecked by nothing, so nothing there is under test.
 */

/** What the press should DO. The caller performs it. */
export type NewAgentAction =
  /** Open this loop's CLI in its own terminal card, on a fresh conversation. */
  | { kind: "cli"; loop: string; fresh: true }
  /** Another whole agent panel (the shell in a webview). NOT what the New door
   *  returns — that is the explicit "New agent panel" command, which asks for
   *  a separate shell on purpose. */
  | { kind: "instance"; loop: string | null }
  /** Nothing is seated: the ordinary agent open IS the new agent. */
  | { kind: "open"; loop: string | null }
  /** Cannot instance here (web has no <webview>): fall back to in-place. */
  | { kind: "in-place" };

export interface NewAgentInput {
  /** The loop the caller asked for (the rail passes the active one). */
  loop?: string;
  /** Settings → General → Agent loop. */
  defaultLoop?: string;
  /** Loop ids this machine actually has. */
  loops: readonly string[];
  /** The resolved agent view: "cli" (terminal) or "glyphh" (chat). */
  view: "cli" | "glyphh";
  /** Is a chat agent card already on the stage? */
  agentSeated: boolean;
}

/**
 * The loop a new agent should run: the caller's, else the configured default,
 * else the first installed one. A loop id that this machine does not have is
 * NOT honoured — it would open an agent bound to nothing.
 */
export function resolveLoop(i: NewAgentInput): string | null {
  const known = (id: string | undefined): id is string => !!id && i.loops.includes(id);
  if (known(i.loop)) return i.loop;
  if (known(i.defaultLoop)) return i.defaultLoop;
  return i.loops[0] ?? null;
}

/**
 * Route a NEW-AGENT press (the rail's New, the Echo mark, the dock slot).
 *
 * Never returns the in-place action except where instancing is impossible —
 * "new" that silently reuses the open agent is the bug being fixed.
 */
export function routeNewAgent(i: NewAgentInput): NewAgentAction {
  const loop = resolveLoop(i);
  // AGENTS ARE NOT SINGLETONS (his ruling, 2026-09-25): "When you open a
  // glyphh agent from the side panel or from any of the agent icons on the
  // home page they are NOT singletons... they should open new agent windows
  // every time you click one. Period."
  //
  // So EVERY press opens another agent panel. The only asymmetry is cost, not
  // behaviour: with nothing seated yet, the page's own agent element is free
  // and already there, so the first press uses it; each press after that mints
  // a full instance. Either way the user gets one more agent panel per click,
  // which is the whole rule.
  //
  // Workspaces are the ONE exception, and they do not come through here: a
  // workspace adds its agent cell itself and applies that cell's saved config.
  if (i.view === "cli" && loop) return { kind: "cli", loop, fresh: true };
  return i.agentSeated ? { kind: "instance", loop } : { kind: "open", loop };
}

/**
 * The agent header's + — THE ONLY DOOR THAT DOES NOT OPEN A NEW AGENT (his
 * ruling, 2026-09-25: "the only new agent door that doesn't is the + button in
 * the top right of the agent window").
 *
 * A new chat in THIS panel and THIS cli; no panel, no process, nothing else on
 * the stage touched. Constant by design: it states the one exception in one
 * place so it cannot drift back into "new agent" the way every other door had.
 */
export function routeNewChatInPanel(): { kind: "in-place" } {
  return { kind: "in-place" };
}
