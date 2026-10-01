/**
 * bundled-cli.ts — THE GLYPHH CLI THE APP CARRIES (his order, 2026-10-01: "make
 * sure the app bundles the cli into it so a user doesn't have to install the
 * cli separately and on update it always pulls the latest down with the sdk").
 *
 * CI bundles cli@main against the same sdk@main the app vendors
 * (scripts/bundle-cli.mjs) into Resources/glyphh-cli, and the app runs it with
 * its own binary as Node — so the user installs nothing, and an app update is
 * a CLI + SDK update. A dev checkout uses vendor/glyphh-cli when it has been
 * bundled there, else the `glyphh` on PATH.
 */

import fs from "fs";
import path from "path";
import { app } from "electron";

/** The bundled CLI's entry, or null when this build does not carry one. */
export function bundledGlyphhCli(): string | null {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "glyphh-cli")
    : path.join(app.getAppPath(), "vendor", "glyphh-cli");
  const entry = path.join(root, "run.mjs");
  return fs.existsSync(entry) ? entry : null;
}
