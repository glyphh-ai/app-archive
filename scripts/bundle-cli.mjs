#!/usr/bin/env node
/**
 * bundle-cli.mjs — THE GLYPHH CLI SHIPS INSIDE THE APP (his order, 2026-10-01:
 * "make sure the app bundles the cli into it so a user doesn't have to install
 * the cli separately and on update it always pulls the latest down with the sdk").
 *
 * Bundles a CLI checkout (default ../cli, whose `@glyphh/sdk: file:../sdk` is
 * the same SDK the app vendors) into ONE self-contained file: the SDK, ink and
 * react all inline, no node_modules. electron-builder copies the result into
 * Resources/glyphh-cli, and the app runs it with its own binary as Node
 * (ELECTRON_RUN_AS_NODE), so there is no Node or npm for the user to install and
 * every app update replaces the CLI with the one built beside its SDK.
 *
 *   vendor/glyphh-cli/package.json   the CLI reads its version from ../package.json
 *   vendor/glyphh-cli/dist/main.js   the bundle
 *   vendor/glyphh-cli/run.mjs        the entry the app launches
 *
 * Usage: node scripts/bundle-cli.mjs [cliDir]   (the CLI's `npm ci` must have run)
 */

import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = path.resolve(appDir, process.argv[2] ?? "../cli");
const outDir = path.join(appDir, "vendor", "glyphh-cli");

if (!fs.existsSync(path.join(cliDir, "node_modules"))) {
  console.error(`[bundle-cli] ${cliDir} has no node_modules — run npm ci there first`);
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "dist"), { recursive: true });

await build({
  absWorkingDir: cliDir,
  entryPoints: ["src/main.tsx"],
  outfile: path.join(outDir, "dist", "main.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  jsx: "automatic",
  // ink's devtools.js statically imports react-devtools-core (an optional peer
  // it only loads under DEV=true); bundled, that import must resolve to something.
  alias: { "react-devtools-core": path.join(appDir, "scripts", "cli-devtools-stub.mjs") },
  // CJS deps (react, signal-exit…) call require() inside the ESM bundle.
  banner: { js: "import { createRequire as __glyphhRequire } from 'node:module'; const require = __glyphhRequire(import.meta.url);" },
  logLevel: "warning",
});

const pkg = JSON.parse(fs.readFileSync(path.join(cliDir, "package.json"), "utf-8"));
fs.writeFileSync(
  path.join(outDir, "package.json"),
  JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", private: true }, null, 2) + "\n",
);
// The app launches the CLI with ELECTRON_RUN_AS_NODE=1; drop it before the CLI
// starts, so nothing the CLI's shell runs (an Electron app's own `npm run dev`)
// inherits it.
fs.writeFileSync(
  path.join(outDir, "run.mjs"),
  "delete process.env.ELECTRON_RUN_AS_NODE;\nawait import(\"./dist/main.js\");\n",
);

// Fail the BUILD, not a user's machine: the bundle must load with nothing beside
// it. An unknown flag makes the CLI print its usage line and exit before any UI.
const smoke = spawnSync(process.execPath, [path.join(outDir, "run.mjs"), "--bundle-smoke"], { encoding: "utf-8", cwd: outDir, timeout: 30_000 });
const said = `${smoke.stdout ?? ""}${smoke.stderr ?? ""}`;
if (!/usage: glyphh/.test(said)) {
  console.error(`[bundle-cli] the bundled CLI did not load:\n${said}`);
  process.exit(1);
}
console.log(`[bundle-cli] ${pkg.name}@${pkg.version} → ${path.relative(appDir, outDir)}`);
