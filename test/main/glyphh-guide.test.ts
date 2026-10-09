/**
 * The Glyphh power is built in (his order, 2026-10-09: "that skill should be
 * auto installed into the loop. That shouldn't be anything anyone ever has
 * to install or even see"): its text ships with the app. These checks moved
 * here with it from the server's hub seed tests.
 */
import { describe, it, expect } from "vitest";
import { GLYPHH_GUIDE as md, GLYPHH_GUIDE_SLUG, GLYPHH_POWER_LINE } from "../../src/shared/glyphh-guide";

describe("the built-in Glyphh power", () => {
  it("is the glyphh slug, its body alone, and its index line fits the 200-character cap", () => {
    expect(GLYPHH_GUIDE_SLUG).toBe("glyphh");
    expect(GLYPHH_POWER_LINE.length).toBeLessThanOrEqual(200);
    expect(md.startsWith("---")).toBe(false);
    expect(md).toMatch(/^## What Glyphh is/);
  });

  it("documents the tools that exist (a stale name sends the loop at a tool that isn't there)", () => {
    for (const tool of [
      "skills_list", "skill_get", "skill_save", "skill_run",
      "tasks_list", "task_get", "task_run", "task_runs",
      "schedules_list", "schedule_save", "schedule_run", "schedule_delete",
      "agents_list", "settings_open",
      "connector_tools", "connector_call",
      "connections_list_tools", "connections_call_tool",
      "app_list_tools", "app_call_tool", "app_install", "app_deploy", "app_releases", "app_pin",
    ]) expect(md, `${tool} is undocumented`).toContain(`\`${tool}`);
    for (const spec of ["app_deploy { slug, kind?, note?, sourceBase64 }", "app_pin { app, n }", "app_releases { app }", "POSTGRES SQL", "`$1`", "NEO4J Cypher", "{ ok: true, result }", "{ ok: false, error }", "next.config.mjs", "output: 'export'", '"manifestVersion": 3', "GLYPHH_APP_BASE", "never throws"])
      expect(md, `${spec} is undocumented`).toContain(spec);
    for (const gone of [
      "glyphh.app", "create_app_entry", "build_app", "deploy_app", "/api/ingest", "/api/app/data/files", "EVERYTHING RUNS ON THIS MACHINE",
      "LOCAL FIRST", "Files plane", "Pipelines", "Webhooks", "list_images", "Kuzu", "SQLite", "llm.embed", "llm.chunk", "llm.complete",
      "contacts.search", "messages.send", 'manifestVersion": 2', '"entry"', "runs on their machine",
      "task_save", "connector_list_tools", "connector_call_tool", "app_install { path }",
    ]) expect(md, `${gone} is history`).not.toContain(gone);
    expect(md).toContain("ONE KIND, ONE LIBRARY, ONE DOOR");
    for (const door of ["skill_save { slug?", "skill_retype", "skill_enable", "skill_delete", "app_install { bundleBase64, intent"]) expect(md).toContain(door);
    expect(md).toContain("refuses any account the manifest does not declare");
    expect(md).toContain("module.exports = async function run(ctx, input)");
    expect(md).toContain("ctx.checkpoint(");
  });

  it("says what each surface renders, and that window tools follow the member's surface", () => {
    expect(md).toContain("## Surfaces: the desktop and the web share ONE library");
    expect(md).toContain("render ONLY on the desktop");
    expect(md).toContain("render on BOTH surfaces");
    expect(md).toContain("A workspace with no `surface` is a desktop one");
    expect(md).toContain("**Window tools follow the member's surface.**");
    expect(md).toContain("never reach for their desktop from a web session");
  });

  it("puts tool search first and names no withdrawn house app", () => {
    expect(md).toContain("TOOL SEARCH FIRST");
    expect(md).toContain("**Search first, then discover.**");
    for (const gone of ["THE HOUSE APPS", "save_image", "generate_image", "Images app", "Drive app", "Slides app"]) expect(md).not.toContain(gone);
    for (const slug of ["images", "video", "audio", "drive", "design", "slides"]) expect(md).not.toContain(`app: "${slug}"`);
  });

  it("teaches powers and super powers: the words, the recipe, the tools", () => {
    expect(md).toContain("## Powers and super powers - the words the user hears");
    expect(md).toContain("### Build a super power");
    expect(md).toContain("never a power alone");
    expect(md).toContain("`agent_save { name, description, powers, connections");
    expect(md).toContain("`super_power_avatar { agent }`");
    for (const gone of ["Settings → Build", "every CLI", "Claude Code, Codex and Gemini", "## Connect", "${ENDPOINT}", "configured CLI agents"]) expect(md).not.toContain(gone);
  });
});
