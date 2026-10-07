/** THE CONTRACT IS PUSHED INTO THE TURN (his doubt, 2026-10-07: "I am not
 *  convinced it is going to find it"; punch list 12). When the prompt asks
 *  for a Glyphh app, or the Build › Apps "New app" door was used, the turn's
 *  steer carries the sequence — scaffold first, edit, app_install by path,
 *  test, share — so the agent never searches for a template or a skill. The
 *  scaffold's answer brings the whole spec. */

const INTENT = /\bglyphh\s+app\b|\bapp\s+for\s+glyphh\b|\bglyphh[- ]app\b/i;

/** Does this prompt ask for a Glyphh app? */
export function appBuildIntent(text: string): boolean {
  return INTENT.test(String(text || ""));
}

/** The steer block. `folder` is the session's folder when known. `viaDevice`:
 *  the turn runs in the cloud but its folder is on the member's desktop (a
 *  desktop-born Work session), so the install door is the device's. */
export function appBuildSteer(folder?: string | null, opts: { viaDevice?: boolean } = {}): string {
  const where = folder ? ` in ${folder}` : " in this session's folder";
  if (opts.viaDevice) {
    return [
      "GLYPHH APP BUILD — the contract is in hand; do NOT search the repo, the skills or the web for a template, a spec or an example.",
      `The app's folder${where} is on the member's DESKTOP, which this session reaches as a device (device_folders names it). Write and read its files with device_write_file / device_read_file / device_list_dir.`,
      "1. FIRST write the starter yourself from the spec in the build-glyphh-app skill (manifest.json with manifestVersion 3, worker.js with one glyphh.handle per tool, app/ pages, next.config.mjs, package.json, SKILL.md) into that folder with device_write_file; use the member's real connected-account tool names (mcp_tool_search finds them).",
      "2. Build and run: device_app_install { dir: \"<the app's folder>\" } — the ONE door, by path, on the device. The desktop packs and uploads it; a source build runs as a job (the answer carries it). NEVER tar, zip or base64 a folder yourself and never paste a bundle into a tool call.",
      "3. Test: app_call_tool { app, tool, args }; the panel is at the answer's url.",
      "4. Share to publish is the member's move (Build › Apps › Publish). Say so; do not do it.",
    ].join("\n");
  }
  return [
    "GLYPHH APP BUILD — the contract is in hand; do NOT search the repo, the skills or the web for a template, a spec or an example.",
    `1. FIRST call glyphh_app_scaffold { name, slug?, connections?, tools? }. It writes a working starter${where} (manifest.json, worker.js with one handler per tool, app/ pages, next.config.mjs, package.json, SKILL.md, CONNECTIONS.md with the member's REAL connected-account tool names) and answers the full spec. Read its answer; then edit.`,
    "2. Edit: one glyphh.handle per manifest tool in worker.js; the page talks to the host only through window.glyphh.call(capability, args); no model call inside the app — the agent thinks, the app stores, finds and reaches accounts.",
    "3. Build and run: app_install { dir: \"<the app's folder>\" } — the ONE door, by path. The platform builds source as a job; app_build_status { job } reads it. NEVER tar, zip or base64 a folder yourself and never paste a bundle into a tool call.",
    "4. Test: app_call_tool { app, tool, args }; the panel is at the answer's url.",
    "5. Share to publish is the member's move (Build › Apps › Publish). Say so; do not do it.",
  ].join("\n");
}

let doorArmed = false;
/** The New app door arms the next turn's steer, whatever the prompt says. */
export function armAppBuildDoor(): void { doorArmed = true; }
/** Was the door armed? Reading it disarms it. */
export function consumeAppBuildDoor(): boolean { const was = doorArmed; doorArmed = false; return was; }

/** The steer line for a turn, or "" when the turn is not an app build. */
export function appBuildSteerFor(text: string, folder?: string | null, opts: { viaDevice?: boolean } = {}): string {
  const armed = consumeAppBuildDoor();
  return armed || appBuildIntent(text) ? appBuildSteer(folder, opts) : "";
}
