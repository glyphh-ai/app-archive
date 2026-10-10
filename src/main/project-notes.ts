/**
 * project-notes.ts — A PROJECT'S RULES LIVE IN ITS FOLDER (his order,
 * 2026-10-10: "Do both 100%"), as Claude Code keeps CLAUDE.md: GLYPHH.md at
 * the root of the session's folder is the project's rulebook. It rides every
 * turn in that folder as the loop's cached standing block, so a rule never
 * depends on a search finding it, and it is reviewed and shared with the code.
 * The server keeps a copy (memory.py projects), so a search reaches the rules
 * of every project on every machine. A folder without one is read through the
 * files other agents keep: AGENTS.md, then CLAUDE.md.
 */

import { deviceName } from "./machine-mode.js";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { getClient } from "./glyphh-client.js";
import { currentTurnChat } from "./turn-folder.js";

export const PROJECT_NOTES = ["GLYPHH.md", "AGENTS.md", "CLAUDE.md"] as const;
const CAP = 64_000;
const REPORT_EVERY_MS = 10 * 60_000;

/** The folder's rules file, the first of PROJECT_NOTES that exists; null when none does. */
export function readProjectNotes(folder: string): { name: string; text: string } | null {
  for (const name of PROJECT_NOTES) {
    const file = join(folder, name);
    try {
      if (!statSync(file).isFile()) continue;
      return { name, text: readFileSync(file, "utf8").slice(0, CAP) };
    } catch { /* not there */ }
  }
  return null;
}

/** The standing block a turn in this folder carries. */
export function projectBlock(notes: { name: string; text: string } | null): string {
  if (notes && notes.text.trim()) {
    return `<glyphh_project file="${notes.name}">\nThis project's own rules, kept in ${notes.name} at the root of its folder. Follow them for work in this folder; when the user states a lasting rule for this project, add it there.\n\n${notes.text.trim()}\n</glyphh_project>`;
  }
  return "This folder has no GLYPHH.md. When the user states a lasting rule for this project, offer to write it to GLYPHH.md at the root of the folder, where every turn here will read it.";
}

type Poster = (body: { machine: string; folder: string; name: string; notes: string; sessionId: string }) => Promise<unknown>;
const postProject: Poster = (body) => getClient().http.post("/api/memory/projects", body);
const reported = new Map<string, { hash: string; at: number }>();

/** Tell the server about the folder (its name, the session, its rules), when the rules changed or now and then. */
export function reportProject(folder: string, notes: { name: string; text: string } | null, post: Poster = postProject, now: number = Date.now()): boolean {
  const text = notes?.text ?? "";
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const had = reported.get(folder);
  if (had && had.hash === hash && now - had.at < REPORT_EVERY_MS) return false;
  reported.set(folder, { hash, at: now });
  void post({ machine: deviceName(), folder, name: basename(folder.replace(/\/+$/, "")) || folder, notes: text, sessionId: currentTurnChat() ?? "" })
    .catch((err: unknown) => { reported.delete(folder); console.warn("[project] not reported:", err instanceof Error ? err.message : String(err)); });
  return true;
}

/** The loop's `standing` seam: the folder's rules, read fresh each turn. */
export async function projectStanding(scope: { folder: string }): Promise<string> {
  const folder = String(scope?.folder || "").trim();
  if (!folder) return "";
  const notes = readProjectNotes(folder);
  reportProject(folder, notes);
  return projectBlock(notes);
}
