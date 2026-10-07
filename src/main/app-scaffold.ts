/**
 * app-scaffold.ts — THE STARTER on this machine (his order, 2026-10-07; punch
 * list 12). The SDK's scaffoldAppFiles makes the files (manifest, worker
 * handlers, SKILL.md, CONNECTIONS.md with the member's real connected-account
 * tool names); this writes them into a folder and answers the spec, so the
 * agent's first move edits a working app instead of searching for one.
 * Nothing here touches Electron, so it is tested under test/main.
 */

import fs from "node:fs";
import path from "node:path";
import * as sdk from "@glyphh/sdk";

export interface ScaffoldInput {
  name: string;
  slug?: string;
  /** Under `base` by default (<base>/<slug>); an absolute path is taken as is. */
  dir?: string;
  description?: string;
  connections?: string[];
  tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  /** The session's folder — where the app lands when `dir` is not absolute. */
  base: string;
  /** The member's tools for one connection (the desktop's connector catalog). */
  connectorTools?: (app: string) => Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
  fsImpl?: Pick<typeof fs, "existsSync" | "readdirSync" | "mkdirSync" | "writeFileSync">;
}

export interface ScaffoldAnswer { dir: string; slug: string; files: string[]; connections: Array<{ app: string; tools: number }>; next: readonly string[]; contract: string }

/** The SDK's starter, read loosely: the app's checked-out SDK types may lag the one CI bundles. */
const SDK = sdk as unknown as {
  scaffoldAppFiles?: (o: { name: string; slug?: string; description?: string; connections?: string[]; tools?: ScaffoldInput["tools"]; connectionTools?: Array<{ app: string; tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }> }) => Record<string, string>;
  GLYPHH_APP_SPEC?: string;
  SCAFFOLD_NEXT?: readonly string[];
};

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function scaffoldAppFolder(input: ScaffoldInput): ScaffoldAnswer {
  const f = input.fsImpl ?? fs;
  const make = SDK.scaffoldAppFiles;
  if (!make) throw new Error("this app's SDK predates the starter — write the files from the spec by hand (the build-glyphh-app skill)");
  const name = String(input.name || "").trim();
  if (!name) throw new Error("`name` is required");
  const slug = String(input.slug || "").trim().toLowerCase();
  if (slug && !SLUG_RE.test(slug)) throw new Error("slug is lowercase [a-z0-9_-], no leading underscore");
  const connections = [...new Set((input.connections ?? []).map((c) => String(c || "").trim().toLowerCase()).filter((c) => /^[a-z0-9_-]+$/.test(c)))];
  const connectionTools = connections.map((app) => { try { return { app, tools: input.connectorTools?.(app) ?? [] }; } catch { return { app, tools: [] }; } });
  const files = make({ name, ...(slug ? { slug } : {}), ...(input.description ? { description: input.description } : {}), connections, tools: input.tools ?? [], connectionTools });
  const made = String((JSON.parse(files["manifest.json"] ?? "{}") as { slug?: string }).slug || slug || "app");
  const raw = String(input.dir || "").trim();
  if (!raw && !input.base) throw new Error("no folder — pass `dir`, or pick a folder for this session first");
  const dir = raw ? (path.isAbsolute(raw) ? raw : path.join(input.base, raw)) : path.join(input.base, made);
  if (f.existsSync(dir) && f.readdirSync(dir).length) throw new Error(`${dir} already has files — pass dir for a fresh folder, or edit what is there`);
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    f.mkdirSync(path.dirname(p), { recursive: true });
    f.writeFileSync(p, content);
  }
  return {
    dir, slug: made, files: Object.keys(files).sort(),
    connections: connectionTools.map((c) => ({ app: c.app, tools: c.tools.length })),
    next: SDK.SCAFFOLD_NEXT ?? ["edit → app_install { dir } → app_call_tool → Share to publish"],
    contract: SDK.GLYPHH_APP_SPEC ?? "",
  };
}
