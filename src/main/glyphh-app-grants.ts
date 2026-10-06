/**
 * Per-webContents grants for Glyphh-app panels: which cloud instance a
 * panel's `glyphh.call` is forwarded to (app-instances.ts callInstanceBridge).
 * The pod enforces the manifest's capabilities; this machine only knows which
 * webContents stands for which instance. The "glyphh-app:call" IPC handler
 * (glyphh-app-host.ts) consults it on every call.
 */

export interface PanelGrant {
  slug: string;
  name: string;
  /** The instance key the panel's calls land on. */
  instance: string;
}

const grants = new Map<number, PanelGrant>();

export function grantPanel(webContentsId: number, slug: string, name: string, instance: string): void {
  grants.set(webContentsId, { slug, name, instance });
}

export function revokePanel(webContentsId: number): void {
  grants.delete(webContentsId);
}

export function panelGrant(webContentsId: number): PanelGrant | undefined {
  return grants.get(webContentsId);
}
