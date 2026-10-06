/**
 * Preload for installed Glyphh apps (glyphh-app-host). The ENTIRE surface an
 * app gets is `glyphh.call(method, args)` — main forwards it to the app's
 * cloud instance as the member, and the instance enforces the manifest's
 * capability list (e.g. "db.exec", "notify.send").
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("glyphh", {
  call: (method: string, args?: unknown) =>
    ipcRenderer.invoke("glyphh-app:call", method, args) as Promise<
      { ok: true; result: unknown } | { ok: false; error: string }
    >,
});
