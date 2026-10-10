/**
 * turn-folder.ts — THE TURN'S FOLDER, its perimeter (his rule, 2026-10-09: "that
 * session is 1000% bound to that folder"). Every turn runs inside
 * `inTurnFolder(folder, …)`; a desktop tool that takes a path resolves it with
 * `turnPath`, the same realpath check the SDK's own file tools use, so `..`,
 * absolute paths and symlinks can't land outside it.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { insideFolder } from "@glyphh/sdk/loop";

const folder = new AsyncLocalStorage<string>();

export function inTurnFolder<T>(dir: string, fn: () => T): T {
  return folder.run(dir, fn);
}

/** The folder of the turn this code runs in, or null outside a turn. */
export function currentTurnFolder(): string | null {
  return folder.getStore() || null;
}

/** `p` (relative to the turn's folder, or absolute) as a real path inside it; throws when it is outside or there is no turn. */
export async function turnPath(p: string): Promise<string> {
  const root = currentTurnFolder();
  if (!root) throw new Error("this tool works only inside a session, in its folder");
  return insideFolder(root, p);
}
