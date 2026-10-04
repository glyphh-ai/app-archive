/**
 * web-surface.ts — WHICH HOST IS THIS, and WHAT CAN IT DO.
 *
 * The renderer is shared by the desktop (Electron, `window.glyphh` = the
 * preload's IPC surface) and the web (app.glyphh.ai, `window.glyphh` = the
 * bridge's Proxy over @glyphh/sdk). On web that Proxy answers EVERY name with
 * a function, so `typeof window.glyphh.x === "function"` cannot tell a real
 * method from a no-op. The bridge therefore exposes `window.glyphhWeb.has(name)`
 * — true only for a method web-contract.js actually implements — and this
 * module is the renderer's one door to it.
 *
 * Rule: a control that depends on a method the host cannot serve is HIDDEN,
 * never left to silently no-op (his order, 2026-10-04).
 */

interface GlyphhWebProbe { has?: (name: string) => boolean }

/** The web target (the bridge stamps both the global and the html class). */
export function onWeb(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window as unknown as { __GLYPHH_WEB__?: boolean }).__GLYPHH_WEB__
    || (typeof document !== "undefined" && document.documentElement.classList.contains("glyphh-web"));
}

/** Does the host implement `window.glyphh[name]` for real? Desktop: every
 *  preload method exists (typeof is honest there). Web: only what the bridge
 *  contract serves. */
export function hostHas(name: string): boolean {
  if (!onWeb()) {
    const g = (window as unknown as { glyphh?: Record<string, unknown> }).glyphh;
    return typeof g?.[name] === "function";
  }
  const probe = (window as unknown as { glyphhWeb?: GlyphhWebProbe }).glyphhWeb;
  return typeof probe?.has === "function" ? probe.has(name) : false;
}

/** Hide `el` unless the host serves every one of `names`. Returns whether it
 *  stayed visible, so a caller can skip wiring a control nobody can use. */
export function keepIfHost(el: Element | null | undefined, ...names: string[]): boolean {
  const ok = names.every(hostHas);
  if (!ok) el?.classList.add("hidden");
  return ok;
}

/** Copy text: the desktop's clipboard IPC where it exists, the browser's
 *  Clipboard API on web. Never throws. */
export async function copyText(text: string): Promise<boolean> {
  if (hostHas("copyToClipboard")) {
    const g = (window as unknown as { glyphh: { copyToClipboard: (t: string) => Promise<unknown> } }).glyphh;
    try { await g.copyToClipboard(text); return true; }
    catch { /* fall through to the browser API */ }
  }
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
}
