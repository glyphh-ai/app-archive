/**
 * host-tools.ts — GLYPHH'S OWN TOOLS, IN THE LOOP (his order, 2026-10-09: "so
 * it is our own agent loop, why do we need an mcp server to reach our own
 * shit?"). These used to be served on a 127.0.0.1 HTTP MCP server that the
 * loop — and any outside client holding a token — connected to. The loop is
 * the only loop now: the same tools are registered here and handed to it in
 * process as catalog entries (glyphh-loop.ts). No port, no tokens, no door.
 *
 * Each tool keeps the shape it had: a name, a description, a zod input shape
 * and a handler answering `{ content: [{ type: "text", text }], isError? }`.
 */

import fs from "node:fs";
import path from "node:path";
import { userScopedPath } from "./app-paths.js";
import { z } from "zod";
import { UNATTENDED_HIDDEN } from "./unattended-tools.js";
import { getPreference, setPreference } from "./stores/preferences-db.js";
import { dispatchRelayMethod } from "./relay-client.js";
import { callInstanceTool, listInstanceTools, installFolderAsInstance, listInstanceReleases, pinInstanceRelease, refuseBase64Flood, readBuildJob, waitBuildJob, logTail } from "./app-instances.js";
import { getExplicitWorkingDirectory } from "./working-directory.js";
import { listConnectionTools, callConnectionTool } from "./mcp-connections.js";
import { listTaskSpecs, getTaskSpec, saveTaskSpec, runTaskAndWait, listTaskRuns } from "./task-runner.js";
import { listSkills, getSkill, installSkill, writeSkillFile, deleteSkill, setSkillEnabled, retypeBundle, type BundleType } from "./skills-fs.js";
import { listSchedulesView, saveSchedule, deleteSchedule, runSchedule, runSkillHeadless, scheduleForTask } from "./local-library.js";
import { WHERE_TO_SEE, hasAppFace, NO_FACE_ERROR, checkBundlePath, checkNoForeignManifest, normalizeConnDeps } from "../shared/bundle-shape.js";
import { SEMANTIC_TOOLS } from "./glyphh-agent-semantic.js";
import { refreshConnectorCatalog, getConnectorCatalog, getCatalogAge, callConnectorTool } from "./connector-tools-client.js";
import { scaffoldAppFolder } from "./app-scaffold.js";

const DEFAULT_PORT = 7860;
const TOKEN_TTL_DAYS = 90;
const SERVER_NAME = "glyphh-local";
const SERVER_VERSION = "1.0.0";

// ── THE TOOLS ────────────────────────────────────────────────────────

/** What a tool answers, as the MCP SDK shaped it (kept so every handler stays as written). */
interface ToolAnswer {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
}
type ToolHandler = (args: any) => Promise<ToolAnswer> | ToolAnswer;   // eslint-disable-line @typescript-eslint/no-explicit-any
/** The one method the tools below were registered through. */
interface ToolRegistrar {
  tool(name: string, description: string, shape: Record<string, z.ZodTypeAny>, handler: ToolHandler): void;
}

function registerTools(mcp: ToolRegistrar): void {
  const via = async (method: string, params: unknown) => {
    try {
      const result = await dispatchRelayMethod(method, params);
      return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
    } catch (err) {
      // Flagged as an error (his report, 2026-09-29): as plain text a failed
      // open drew a ✓ and read to the model as a success.
      return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
    }
  };

  // ── Tasks + skills — Glyphh's OWN primitives, author-grade (the write
  //    path agents lacked: a pipeline built here lands in Glyphh's registry,
  //    schedulable and visible in the UI, not beside it) ─────────────────
  const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v) }] });
  // ── SKILLS ARE FOLDERS (2026-09-17) ────────────────────────────────────
  // An agent that saved a skill used to write a JSON row into a store nothing
  // renders any more, so the skill it just made was nowhere in the app (his
  // report). These write and read the SAME folders the Skills page lists.
  const skillId = (slug: string): string => `glyphh:${String(slug).trim()}`;
  const skillSlug = (name: string): string =>
    name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

  /** ONE HOME (2026-10-09): every power is glyphh:<slug>; an app's source keeps app:<slug>. */
  const idFor = (slug: string, type: BundleType): string => `${type === "app" ? "app" : "glyphh"}:${String(slug).trim()}`;

  /** Find a bundle by slug across every home, whatever its type. */
  function findBundle(slug: string): { id: string; type: BundleType } | null {
    const want = String(slug).trim().toLowerCase();
    for (const sk of listSkills("skill")) {
      if (sk.id.slice(sk.id.indexOf(":") + 1).toLowerCase() === want) return { id: sk.id, type: sk.type };
    }
    return null;
  }

  /** WHAT WAS ACTUALLY MADE (his report, 2026-09-17): an agent said "installed
   *  successfully" about an app the user could find on no page. Every write
   *  answers with the shape, the folder and where to look. */
  const WHERE = WHERE_TO_SEE;
  function describeBundle(id: string, note?: string): Record<string, unknown> {
    const sk = getSkill(id);
    return {
      slug: id.slice(id.indexOf(":") + 1), type: sk.type, name: sk.name, description: sk.description,
      folder: sk.dir, enabled: sk.enabled, files: sk.files.map((f) => f.path),
      where: WHERE[sk.type],
      ...(note ? { note } : {}),
    };
  }

  const MAX_BUNDLE_FILE = 512 * 1024;
  function checkFiles(files: Record<string, string> | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [rel, body] of Object.entries(files ?? {})) {
      const clean = checkBundlePath(rel);
      if (typeof body !== "string") throw new Error(`file "${clean}" must be text`);
      if (Buffer.byteLength(body) > MAX_BUNDLE_FILE) throw new Error(`file "${clean}" is larger than 512 KB`);
      out[clean] = body;
    }
    return out;
  }

  /** THE ONE AUTHORING DOOR (his order, 2026-09-17). Type is required, so no
   *  agent can drift from the shape the user asked for, and each shape carries
   *  what it actually needs — a skill can ship files now, which is why an
   *  agent needing code no longer has to reach for an app bundle. */
  function saveBundle(input: {
    type?: BundleType; slug?: string; name: string; description?: string; prompt?: string;
    files?: Record<string, string>; program?: string; connections?: string[]; schedule?: string;
    slots?: Array<{ name?: string; label?: string; description?: string; agent?: string | null; model?: string }>;
  }): Record<string, unknown> {
    const name = String(input.name ?? "").trim();
    if (!name) throw new Error("a power needs a name");
    // ONE KIND (2026-10-09): what a power CARRIES decides what it does — a
    // program makes it run on its own, a face (ui/) makes it an app's source.
    // A legacy `type` is still honored when given.
    const type: BundleType = input.type
      ?? (input.program || input.schedule || input.slots?.length ? "task"
        : Object.keys(input.files ?? {}).some((r) => r === "app.json" || /^ui\/.*\.html?$/i.test(r)) ? "app" : "skill");
    const slug = (input.slug ? String(input.slug) : skillSlug(name)) || "skill";
    const extra = checkFiles(input.files);
    checkNoForeignManifest(type, Object.keys(extra));

    // A POWER THAT RUNS ON ITS OWN carries a program: task.json, run.js and its
    // slots, in the same one home as every other power.
    if (type === "task") {
      const spec = saveTaskSpec({ slug, name, description: input.description, program: input.program, slots: input.slots, connections: input.connections, schedule: input.schedule });
      const id = idFor(slug, "task");
      if (input.prompt) {
        const sk = getSkill(id);
        writeSkillFile(id, "SKILL.md", `---\nname: ${slug}\ndescription: ${(input.description ?? sk.description ?? name).replace(/\r?\n/g, " ").trim()}\ntype: task\n---\n\n${String(input.prompt).trim()}\n`);
      }
      for (const [rel, body] of Object.entries(extra)) writeSkillFile(id, rel, body);
      const onClock = scheduleForTask(slug);
      return {
        ...describeBundle(id, input.program ? undefined : "no program was given, so run.js is whatever it already was"),
        connections: spec.connections,
        schedule: onClock ? { id: onClock.id, cron: onClock.cron, enabled: onClock.enabled } : null,
        // A run refuses an account the manifest does not declare, so an empty
        // list beside code that calls ctx.connections is the bug to report.
        ...(spec.connections.length ? {} : { connectionsNote: "this task declares no connections; pass `connections` if its program calls ctx.connections.<app>" }),
      };
    }

    // AN APP HAS A FACE. Without one it is a task (headless, on a clock) or a
    // skill (instructions) — name the alternatives rather than accept a lie.
    const existingApp = (() => { try { return getSkill(idFor(slug, "app")); } catch { return null; } })();
    if (type === "app" && !hasAppFace(Object.keys(extra)) && !existingApp) throw new Error(NO_FACE_ERROR);

    const id = idFor(slug, type);
    let existing: ReturnType<typeof getSkill> | null = null;
    try { existing = getSkill(id); } catch { existing = null; }
    const description = String(input.description ?? existing?.description ?? "").replace(/\r?\n/g, " ").trim();
    const body = String(input.prompt ?? existing?.body ?? "").trim();
    // A SKILL'S CONNECTIONS ARE WRITTEN DOWN (his report, 2026-10-09: "shows
    // it needs connections but i don't see the connections tab"): a skill has
    // no manifest, so they ride its SKILL.md header, and the details page
    // reads them back into its Connections tab.
    const conns = (Array.isArray(input.connections) ? input.connections : String(existing?.frontmatter?.connections ?? "").split(","))
      .map((c) => String(c).trim().toLowerCase()).filter((c) => /^[a-z0-9_.-]{1,80}$/.test(c));
    const connLine = type === "skill" && conns.length ? `connections: ${[...new Set(conns)].join(", ")}\n` : "";
    const md = `---\nname: ${slug}\ndescription: ${description || name}\n${type === "app" ? "type: app\n" : ""}${connLine}---\n\n${body || `# ${name}\n`}\n`;
    const files: Record<string, string> = { "SKILL.md": md, ...extra };
    if (type === "app" && !existing && !files["app.json"]) {
      files["app.json"] = JSON.stringify({
        name: slug, ui: Object.keys(extra).find((r) => /\.html?$/i.test(r)) || "ui/index.html",
        tools: "tools/manifest.json", dependencies: { connections: normalizeConnDeps(input.connections) }, screenshots: [],
      }, null, 2) + "\n";
    }
    if (existing) for (const [rel, text] of Object.entries(files)) writeSkillFile(id, rel, text);
    else installSkill(slug, files, type);
    return describeBundle(id);
  }

  // ── AGENTS — the user's own sub-agents (his order, 2026-09-29: "extend the
  //    mcp tools for the app to include generating agents"). The same records
  //    Settings → Build → Agents edits; the Glyphh loop hands work to them with
  //    spawn_agent, and a new one is spawnable from the next turn on. ─────────
  mcp.tool(
    "agents_list",
    "The user's SUPER POWERS — the bots on the rail. Each is a name, a line saying when to use it, a standing brief, a model, and the POWERS it holds (its powers, connections, models and folders). Glyphh hands them work with spawn_agent, and they are the only valid values for a task slot's agent binding and task_run's agent override. Returns [{ agent, name, description, model, role, powers, connections, models, folders, personality, effort, hasBrief }].",
    {},
    async () => via("agents.list", {}),
  );
  mcp.tool(
    "agent_get",
    "One of the user's super powers in full: its brief and the powers it holds. Returns { agent, name, description, model, role, powers, connections, models, folders, personality, effort, hasBrief, brief }.",
    { agent: z.string().describe("The super power's id, from agents_list") },
    async ({ agent }) => via("agents.get", { agent }),
  );
  mcp.tool(
    "agent_save",
    "MAKE or UPDATE one of the user's SUPER POWERS. When the user asks for a super power, this is the call — not skill_save alone. A super power is a bot on the rail: a name, WHEN TO USE IT (`description`), a standing `brief`, and the POWERS it holds: `powers` (power slugs from skills_list — build any it needs first with skill_save, then list them here), `connections` (connected-account app slugs it uses), `models` (models it may use beside its own), `folders` (the first is its working folder), `personality` 1 serious … 5 playful, `effort` (thinking: low … max). Omit `agent` to make a new one (a name already in use is refused — update it instead); pass `agent` to change one (fields you leave out are kept). OMIT `brief` and Glyphh writes one from the name and description. `model` must be one of the user's models (models_available). After making one, offer super_power_avatar for its face. Returns the super power as saved: { agent, name, description, model, role, powers, connections, models, folders, personality, effort, created, generatedBrief, brief }.",
    {
      agent: z.string().optional().describe("The super power to update (its id from agents_list); omit to make a new one"),
      name: z.string().optional().describe("Its name, e.g. \"Video Marketer\" — required for a new super power"),
      description: z.string().optional().describe("When to use it: what it is for, in a sentence"),
      brief: z.string().optional().describe("Its standing instruction, second person. Omit to have Glyphh write it"),
      model: z.string().optional().describe("Its model slot — one of the user's models; omit for the main agent's"),
      // THE BOTS PANEL (his order, 2026-10-08): an orchestrator plans the work and hands it to the other bots.
      role: z.enum(["orchestrator", "worker"]).optional().describe("Its place among the super powers: \"worker\" (default) does one kind of work; \"orchestrator\" plans and hands work to the others"),
      // ITS POWERS (his order, 2026-10-09): what the Edit page sets, so one built in a chat is whole.
      powers: z.array(z.string()).optional().describe("The powers it holds, by slug from skills_list (build missing ones first with skill_save)"),
      connections: z.array(z.string()).optional().describe("Connected-account app slugs it uses — the EXACT slug connector_tools { query } returns, never a guess. The save looks each up in the catalog and maps it to the real slug; one the catalog has nothing for is refused with suggestions — save again with one of them, never drop a connection the job needs"),
      models: z.array(z.string()).optional().describe("Models it may use beside its own, from models_available"),
      folders: z.array(z.string()).optional().describe("Absolute folder paths; the first is its working folder, the rest it can read"),
      personality: z.number().int().min(1).max(5).optional().describe("1 serious … 3 balanced … 5 playful"),
      effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().describe("How hard it thinks: low is fast, max is thorough"),
      superPowers: z.array(z.string()).optional().describe("Other super powers it holds — the only ones it may hand work to, by slug from agents_list. Never itself; no loops (two can't hold each other)"),
    },
    async (input) => via("agents.save", input),
  );
  // A SUPER POWER'S AVATAR (his order, 2026-10-09): the Images power draws it
  // in the Glyphh mascot's style (shared/avatar-style.ts); it lands on the agent.
  mcp.tool(
    "super_power_avatar",
    "Make a new AVATAR for one of the user's super powers (agents) with the Images power, in the Glyphh mascot's style (a black alien-cat sticker), and set it as that super power's icon. `prompt` says what makes this one its own (a prop, a pose, a feature); omit it to draw from the name and description. Returns { agent, model, usd }.",
    {
      agent: z.string().describe("The super power's id, from agents_list"),
      prompt: z.string().optional().describe("What makes this avatar its own, e.g. \"holding a tiny wrench, goggles up\""),
      model: z.string().optional().describe("An image model from powers_list; omit for the default"),
    },
    async ({ agent, prompt, model }) => {
      try {
        const [{ getAgent, saveAgent }, { generateAvatar }] = await Promise.all([import("./local-agents.js"), import("./powers.js")]);
        const row = getAgent(agent);
        const made = await generateAvatar({ name: row.name, description: row.description, ...(prompt ? { prompt } : {}), ...(model ? { model } : {}) });
        const face = row.avatar ?? { variant: 2, color: "#0b0a0f" };
        saveAgent({ slug: row.slug, avatar: { variant: face.variant, color: face.color, image: made.image } });
        return text({ agent: row.slug, model: made.model, usd: made.usd });
      } catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );
  mcp.tool(
    "agent_delete",
    "DELETE one of the user's super powers (and its scheduled tasks). Its powers stay in the library. Only when the user asked for it.",
    { agent: z.string().describe("The super power's id, from agents_list") },
    async ({ agent }) => via("agents.delete", { agent }),
  );
  mcp.tool(
    "tasks_list",
    "List the user's Glyphh TASKS. A task is a BUNDLE the desktop runs itself: a program (run.js) plus the slots it calls agents through, the connections it uses and an optional cron. Returns [{ slug, name, description, program, icon, slots, connections, schedule, enabled }].",
    {},
    async () => text(listTaskSpecs()),
  );
  mcp.tool(
    "task_get",
    "Read one Glyphh task in full — its program (the spec) and its slots.",
    { slug: z.string().describe("Task slug from tasks_list") },
    async ({ slug }) => {
      try { return text(getTaskSpec(slug)); }
      catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );
  mcp.tool(
    "task_run",
    "Run a Glyphh task NOW and wait for it. Returns { status, runId, result, error }; the run's own story is in task_runs.",
    {
      slug: z.string().describe("Task slug from tasks_list"),
      agent: z.string().optional().describe("CLI-agent id override for this run"),
    },
    async ({ slug, agent }) => {
      try { void agent; const r = await runTaskAndWait(slug, {}); return text({ status: r.status, runId: r.id, result: r.result, error: r.error }); }
      catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );
  // SKILL_RUN, LOCAL (his order, 2026-10-07: "give apps, agents, skills,
  // plugins — everything — the ability to call the rpa tooling"): the
  // gateway's copy runs a skill in the cloud, where no RPA lives; this one
  // runs it on the Glyphh loop HERE, with this machine's tools.
  mcp.tool(
    "skill_run",
    "Run a Glyphh SKILL now, on this machine, and wait for the answer: its SKILL.md instructions go through the Glyphh agent with this desktop's tools (the RPA tools included). Returns { ok, text, error }.",
    {
      slug: z.string().describe("Skill slug from skills_list"),
      input: z.string().optional().describe("What to run it on — text handed to the skill under its instructions"),
    },
    async ({ slug, input }) => {
      try { return text(await runSkillHeadless(slug, input)); }
      catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );
  mcp.tool(
    "task_runs",
    "A Glyphh task's recent scheduled runs (newest first): { id, startedAt, durationMs, status, error, output }.",
    { slug: z.string().describe("Task slug") },
    async ({ slug }) => text(listTaskRuns(slug).map((r) => ({ id: r.id, startedAt: r.startedAt, durationMs: r.durationMs, status: r.status, error: r.error, result: r.result, events: r.journal.events.length }))),
  );
  // ── SCHEDULES — anything on a clock (2026-09-17). A task's program runs
  //    itself; a skill's instructions go through an agent. Same rows the
  //    Settings → Customize → Schedules page shows.
  mcp.tool(
    "schedules_list",
    "Everything the user has on a clock: { id, name, kind (task|skill), target, cron, enabled, agentName, lastRunAt, lastStatus }.",
    {},
    async () => text(listSchedulesView()),
  );
  mcp.tool(
    "schedule_save",
    "Put a task or a skill on a clock, or change one already there. A TASK runs its own program; a SKILL's instructions run through an agent, so it needs one. Cron is five fields in the machine's local time (0 8 * * 1-5 = weekdays at 8am).",
    {
      id: z.string().optional().describe("Existing schedule id to change; omit to create"),
      kind: z.enum(["task", "skill"]).describe("What runs: a task bundle, or a skill"),
      target: z.string().describe("The task or skill slug"),
      name: z.string().optional().describe("What to call it; defaults to the target"),
      cron: z.string().describe("Five-field cron, e.g. 0 8 * * 1-5"),
      agentId: z.string().optional().describe("For a skill: the agent whose loop runs it (agents_list)"),
      enabled: z.boolean().optional().describe("Armed? Default true"),
      args: z.record(z.string(), z.unknown()).optional().describe("Input handed to a task's program"),
    },
    async (input) => {
      try { return text(saveSchedule(input)); }
      catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );
  mcp.tool(
    "schedule_delete",
    "Take something off the clock. Its run history stays.",
    { id: z.string().describe("Schedule id from schedules_list") },
    async ({ id }) => {
      try { return text(deleteSchedule(id)); }
      catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );
  mcp.tool(
    "schedule_run",
    "Fire a schedule NOW, outside its clock, to prove it works.",
    { id: z.string().describe("Schedule id from schedules_list") },
    async ({ id }) => {
      try { await runSchedule(id); return text({ id, ran: true }); }
      catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );
  mcp.tool(
    "settings_open",
    "Open the user's Settings on one of its pages so they can see or change something themselves: skills, connections, plugins, tasks, models, members, billing, general, appearance, mcp.",
    { page: z.string().describe("Which page: skills | connections | plugins | tasks | general | appearance | mcp | models | members | billing") },
    async ({ page }) => via("settings.open", { page }),
  );

  mcp.tool(
    "skills_list",
    "List the user's Glyphh SKILLS — folders in the Agent Skills standard, the same ones Settings → Build → Skills shows. Returns summaries; read one with skill_get.",
    {},
    async () => text(listSkills("skill").map((sk) => ({ slug: sk.id.slice(sk.id.indexOf(":") + 1), name: sk.name, description: sk.description, source: sk.source, enabled: sk.enabled, updatedAt: sk.updatedAt }))),
  );
  mcp.tool(
    "skill_get",
    "Read a Glyphh skill in full — its SKILL.md frontmatter and the markdown instructions (prompt) under it.",
    { slug: z.string().describe("Skill slug from skills_list") },
    async ({ slug }) => {
      try {
        const sk = getSkill(skillId(slug));
        return text({ slug, name: sk.name, description: sk.description, prompt: sk.body, frontmatter: sk.frontmatter, files: sk.files.map((f) => f.path), enabled: sk.enabled });
      } catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );
  mcp.tool(
    "skill_save",
    "THE ONE DOOR for making a POWER — the only thing in the user's library. A power is one thing: a SKILL.md folder (its instructions) that carries whatever it needs, and what it carries decides what it can do. "
    + "Instructions an agent follows: pass `prompt` (and any reference files or scripts in `files`). "
    + "Work that runs on its own (on a schedule, as a pipeline): also pass `program` = run.js exporting async run(ctx, input), `slots` for the agents it calls and an optional `schedule`; ctx.decide(state, questions) and ctx.route(state, branches, {minConfidence, fallback}) make deterministic Jev decisions through GlyphhRouter. "
    + "A face (a work panel): pass `files` including ui/index.html. "
    + "Always declare the connected accounts it uses in `connections`. Never ask the user what kind it is. The answer says what was made, its folder, and where the user sees it (Your powers).",
    {
      type: z.enum(["skill", "app", "task"]).optional().describe("Leave it out: what the power carries decides what it does. Old callers may still pass it."),
      slug: z.string().optional().describe("Existing slug to update; omit to create"),
      name: z.string().describe("Name"),
      description: z.string().optional().describe("One line: when an agent should reach for this"),
      prompt: z.string().optional().describe("SKILL.md body — the instructions (every type has one)"),
      files: z.record(z.string(), z.string()).optional().describe("Extra files by relative path, e.g. { \"scripts/report.js\": \"…\", \"ui/index.html\": \"…\" }"),
      program: z.string().optional().describe('For a power that runs on its own — run.js: module.exports = async function run(ctx, input) { … }. ctx: agents.<slot>.run, connections.<app>.call, data(repo).exec, decide(state, questions, {model?}), route(state, branches, {instructions?, minConfidence?, fallback?}), checkpoint, log'),
      schedule: z.string().optional().describe('For a power that runs on its own — a five-field cron in the machine\'s local time ("0 8 * * 1-5" is weekdays at 8am). Setting it puts the power on the clock and it shows on Schedules; change it there afterwards, not here.'),
      connections: z.array(z.string()).optional().describe('The connected accounts it needs, by app slug (e.g. ["gmail","google_calendar"]). REQUIRED whenever the code calls ctx.connections.<app> or the app declares connector tools: a run refuses any account the manifest does not declare.'),
      slots: z.array(z.object({
        name: z.string().optional(),
        label: z.string().optional(),
        description: z.string().optional(),
        agent: z.string().nullable().optional().describe("A super power's slug from agents_list. null = Glyphh on the default model with no brief — never silently the first one."),
        model: z.string().optional().describe("The slot's model; it beats the agent's own. Omit for the agent's, then the org default."),
      })).optional().describe('For a power that runs on its own — the fixed slots the program calls agents through as ctx.agents.<slot>.run(prompt, { schema?, model? }). The program also has ctx.rpa: commands(app), run(app, command, value?), sequence(app, name, args?), read(app, selector?) — the mapped commands of the user\'s tabs (rpa_commands).'),
    },
    async (input) => {
      try { return text(saveBundle(input)); }
      catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );
  mcp.tool(
    "skill_retype",
    "Change what KIND of skill something is, keeping its folder and files: app → task, task → skill, and so on. Use it the moment a bundle turns out to be the wrong shape (an app with no face is a task) instead of deleting and rebuilding. Plugins keep Claude Code's format and cannot be converted.",
    {
      slug: z.string().describe("Slug from skills_list / tasks_list"),
      to: z.enum(["skill", "app", "task"]).describe("The shape it should be"),
    },
    async ({ slug, to }) => {
      try {
        const found = findBundle(slug);
        if (!found) return text(`Error: no skill, app or task named "${slug}"`);
        const s2 = retypeBundle(found.id, to);
        return text(describeBundle(s2.id, `was a ${found.type}, now a ${to}`));
      } catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );
  mcp.tool(
    "skill_enable",
    "Turn a skill, app or task ON or OFF without deleting it. Off means it leaves every CLI's skill directory and an app's tab leaves the dock and the wall; the folder and its files stay, and turning it back on restores them. Prefer this over skill_delete whenever the user says stop using it, hide it, or turn it off.",
    {
      slug: z.string().describe("Slug from skills_list / tasks_list"),
      enabled: z.boolean().describe("true = on, false = off"),
    },
    async ({ slug, enabled }) => {
      try {
        const found = findBundle(slug);
        if (!found) return text(`Error: no skill, app or task named "${slug}"`);
        const s2 = setSkillEnabled(found.id, enabled);
        return text(describeBundle(s2.id, enabled ? "on" : "off — the folder is still there"));
      } catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );
  mcp.tool(
    "skill_delete",
    "Delete a skill, app or task FOR GOOD: the folder, its files, an app's tab and its installed payload all go. This cannot be undone, so when the user means stop using it rather than destroy it, call skill_enable with enabled:false instead. Say plainly which one you did.",
    { slug: z.string().describe("Slug from skills_list / tasks_list") },
    async ({ slug }) => {
      try {
        const found = findBundle(slug);
        if (!found) return text(`Error: no skill, app or task named "${slug}"`);
        const was = describeBundle(found.id);
        deleteSkill(found.id);
        return text({ deleted: true, slug, type: found.type, folder: was.folder, note: "gone for good; disable with skill_enable next time if the user only wanted it off" });
      } catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );

  // ── Custom MCP connections — the user's own servers, aggregated ─────
  // ── Connected APPS (Pipedream Connect, server-executed) ──────────────
  // The org/personal connector reach (Gmail, Slack, 3,500 more) — governed
  // and METERED server-side; this lane just carries the call. Distinct from
  // connections_* below, which are the user's own LOCAL custom MCP servers.
  // NEVER THE WHOLE CATALOG (his report, 2026-09-19: "the tool list is
  // massive for the agents"). Bare, this answers the connected APPS and a
  // count; `app` answers one app's tools; `query` searches names and
  // descriptions across every app. The gateway's own key hands the CLIs two
  // search tools for the same reason; this is the local door's version.
  mcp.tool(
    "connector_tools",
    "The user's CONNECTED APPS (Gmail, Slack, Google Drive — 3,500+ via the org's connections). With no arguments: the apps and how many tools each has. `app`: that app's tools with input schemas. `query`: keyword search across every app's tools (top matches). Governed server-side: this is exactly what YOU may call. Invoke with connector_call.",
    {
      app: z.string().optional().describe("One connection slug (e.g. gmail) — its tools, with schemas"),
      query: z.string().optional().describe("Keywords to find tools by name or description across all apps"),
      top_k: z.number().int().min(1).max(50).optional().describe("Max matches for a query (default 20)"),
    },
    async ({ app, query, top_k }) => {
      const tools = getCatalogAge() < 5 * 60 * 1000 ? getConnectorCatalog() : await refreshConnectorCatalog();
      const shape = (t: typeof tools[number]) => ({ app: t.slug, tool: t.name, description: t.description, inputSchema: t.inputSchema });
      if (app) {
        const slug = app.trim().toLowerCase();
        return text(tools.filter((t) => t.slug.toLowerCase() === slug).map(shape));
      }
      if (query && query.trim()) {
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const score = (t: typeof tools[number]): number => {
          const hay = `${t.slug} ${t.name} ${t.description ?? ""}`.toLowerCase();
          return words.reduce((n: number, w: string) => n + (t.name.toLowerCase().includes(w) ? 3 : t.slug.toLowerCase().includes(w) ? 2 : hay.includes(w) ? 1 : 0), 0);
        };
        return text(tools.map((t) => ({ t, s: score(t) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, top_k ?? 20).map((x) => shape(x.t)));
      }
      const byApp = new Map<string, number>();
      for (const t of tools) byApp.set(t.slug, (byApp.get(t.slug) ?? 0) + 1);
      return text([...byApp.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([slug, count]) => ({ app: slug, tools: count, hint: `connector_tools { app: "${slug}" }` })));
    },
  );
  mcp.tool(
    "connector_call",
    "Call one connected app's tool (from connector_tools). Executes on the Glyphh server under the org's governance — the account binding, allow-lists, and metering all apply there.",
    {
      app: z.string().describe("The connection slug (connector_tools 'app')"),
      tool: z.string().describe("The tool key to invoke"),
      props: z.record(z.string(), z.unknown()).optional().describe("The tool's arguments per its inputSchema"),
    },
    async ({ app, tool, props }) => {
      try { return text(await callConnectorTool(app, tool, props ?? {})); }
      catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    },
  );
  mcp.tool(
    "connections_list_tools",
    "List the tools published by the user's CUSTOM MCP CONNECTIONS (their own servers, dialed locally). Returns [{ connection, name, description, inputSchema }]. Call one with connections_call_tool.",
    {},
    async () => {
      const tools = await listConnectionTools();
      return { content: [{ type: "text" as const, text: JSON.stringify(tools) }] };
    },
  );
  mcp.tool(
    "connections_call_tool",
    "Call a tool on one of the user's custom MCP connections (discover with connections_list_tools).",
    {
      connection: z.string().describe("Connection slug"),
      tool: z.string().describe("Tool name on that connection"),
      args: z.record(z.string(), z.unknown()).optional().describe("Tool arguments"),
    },
    async ({ connection, tool, args }) => {
      try {
        const r = await callConnectionTool(connection, tool, (args as Record<string, unknown>) || {});
        return { content: [{ type: "text" as const, text: typeof r === "string" ? r : JSON.stringify(r) }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  mcp.tool(
    "relay_ping",
    "Diagnostics only: echoes a message back. Never needed before the panel tools, which report their own errors.",
    { message: z.string().optional().describe("Optional message to echo back") },
    async ({ message }) => via("relay.ping", { message: message ?? "ping" }),
  );

  // ── Panel management ─────────────────────────────────
  mcp.tool(
    "panels_list",
    "List the user's OPEN app panels (see panels_available for everything that CAN be opened). Returns app (slug — the key every other panel tool takes), name, current url, page title, and which window is focused.",
    {},
    async () => via("panels.list", {}),
  );
  mcp.tool(
    "panels_switch",
    "Focus an open app's window. Use panels_list to see what's open.",
    { app: z.string().describe("App slug to focus") },
    async ({ app }) => via("panels.switch", { app }),
  );
  mcp.tool(
    "panels_close",
    "Close an app's window.",
    { app: z.string().describe("App slug to close") },
    async ({ app }) => via("panels.close", { app }),
  );
  mcp.tool(
    "panels_available",
    "List the user's SAVED APP LIBRARY — everything panels_open can open (slug, name, url, kind). When the user asks about a site or service (mail, calendar, a dashboard…), check here FIRST and open their saved app for it instead of driving the raw browser.",
    {},
    async () => via("panels.available", {}),
  );
  mcp.tool(
    "panels_open",
    "Open an app as a panel and wait until it is actually showing; an error means nothing opened. `app` is a slug from panels_available (the user's saved app library — PREFER these over the raw browser when one matches the task), or 'browser' / 'terminal'. Pass `url` to open the browser (or a web panel) at an http(s) address in the same call, e.g. a dev server at http://localhost:5173. Re-opening an already-open app focuses it. Installed Glyphh apps MUST open this way (by slug) — a file:// URL in the browser panel gets no glyphh bridge and the app won't work.",
    {
      app: z.string().describe("App to open: a saved-app slug from panels_available, or 'browser' / 'terminal'"),
      url: z.string().optional().describe("Optional http(s) address to show in it once it is open"),
    },
    async ({ app, url }) => via("panels.open", { app, ...(url ? { url } : {}) }),
  );
  mcp.tool(
    "panels_add",
    "SAVE a web page as a tab in the user's app library (Settings → Tabs), so panels_open can open it by slug from now on. Use it when the user asks to add a site, bookmark, dashboard or tool as a tab — it appears on their wall at once. Returns { app, name, url }.",
    {
      name: z.string().describe("Display name for the tab"),
      url: z.string().describe("The http(s) URL the tab opens"),
      slug: z.string().optional().describe("Slug to open it by (defaults to the name, lowercased and hyphenated)"),
    },
    async ({ name, url, slug }) => via("panels.add", { name, url, slug }),
  );
  mcp.tool(
    "panels_remove",
    "REMOVE a saved tab from the user's app library, by its slug from panels_available. Built-in work panels and installed Glyphh apps are not tabs and cannot be removed this way.",
    { app: z.string().describe("Slug of the saved tab to remove") },
    async ({ app }) => via("panels.remove", { app }),
  );
  mcp.tool(
    "models_available",
    "List the models THIS user can actually call, and what each one is registered FOR: `mode` is chat, embedding, image_generation or video_generation. Call this BEFORE trying to generate an image, a video or an embedding — pick a model whose mode matches, then call the gateway `endpoint` this returns (OpenAI-shaped: /v1/chat/completions, /v1/images/generations, /v1/videos/generations) with the desktop's own gateway key. Never go hunting for provider API keys: `lane: \"gateway\"` means Glyphh bills and authenticates it for the user. Returns { endpoint, authenticated, byMode, models: [{ model, provider, mode, lane, contextWindow, maxOutputTokens, pricing }] }.",
    {},
    async () => via("models.available", {}),
  );
  mcp.tool(
    "layouts_open",
    "Open one of the user's saved layouts (a named grid of apps). mode 'window' (default) opens ONE window with the apps tiled inside it; mode 'screen' tiles the whole screen with one native window per app.",
    {
      name: z.string().describe("Saved layout name"),
      mode: z.enum(["window", "screen"]).optional().describe("'window' = tiled inside one window (default); 'screen' = OS-level tiling, one window per app"),
    },
    async ({ name, mode }) => via("layouts.open", { name, mode }),
  );

  // ── Installed Glyphh apps — discover / invoke / deploy. An app is a cloud
  //    instance (his order, 2026-10-06); the same answers the gateway's /mcp gives.
  const cloud = async (fn: () => Promise<unknown>) => {
    try { return text(await fn()); }
    catch (err) { return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true }; }
  };
  mcp.tool(
    "app_list_tools",
    "List the MCP tools exposed by the user's installed Glyphh apps — their org's cloud instances and their own. Returns [{ app (the instance key: the slug, or slug~user for a personal one), name, kind, status, tools: [{ name, description, inputSchema }] }]. Call this to discover what THIS user's Glyphh can do, then invoke with app_call_tool.",
    {},
    async () => cloud(() => listInstanceTools()),
  );
  mcp.tool(
    "app_call_tool",
    "Invoke a tool exposed by an installed Glyphh app. Pass the app key + tool name from app_list_tools and an args object matching the tool's inputSchema. Runs on the app's own cloud machine as the user.",
    {
      app: z.string().describe("App key — from app_list_tools"),
      tool: z.string().describe("Tool name — from app_list_tools"),
      args: z.record(z.string(), z.unknown()).optional().describe("Tool arguments matching the tool's inputSchema"),
    },
    async ({ app, tool, args }) => cloud(() => callInstanceTool(app, tool, args || {})),
  );
  // ONE DOOR, BY PATH (his order, 2026-10-07; punch list 17 + 19): `dir` is a
  // folder on this machine and the runtime zips or builds it itself — a
  // bundle folder (manifest.json + its entry) goes up as a release at once; a
  // project (package.json with a build script) goes up as source and the
  // platform builds it as a JOB answered at once. `bundleBase64` is only for
  // a small bundle handed over from outside; past 64 KB it is refused with the
  // path door named (the base64 flood of 2026-10-07 never rides again).
  mcp.tool(
    "app_install",
    "INSTALL (= Build and run) a Glyphh app as the user's cloud instance from a FOLDER ON THIS MACHINE: `dir` — the app's folder (default: this session's folder). A folder that holds manifest.json + its entry page is zipped and released as it is; a project (package.json with a build script, the Next.js static-export shape) goes up as source and the platform builds it — the answer carries `job` and `release` is null until it is ready (wait: true, the default, follows the build up to `waitSeconds`; app_build_status { job } reads it any time). Re-installing the same slug is the next release of the same instance (data, secrets and schedules kept). Returns { key, mode, release, job, log, tools, url }. NEVER read a bundle into a tool call: `bundleBase64` is only for a small bundle (< 64 KB) handed over from outside. This is not the way to author something new: skill_save makes a skill or a task.",
    {
      dir: z.string().optional().describe("The app's folder on this machine (absolute). Default: this session's working folder"),
      slug: z.string().optional().describe("The app's slug — must match manifest.json's when given"),
      kind: z.enum(["org", "personal"]).optional().describe("Which instance: the organization's (admins) or your personal one. Default: the one that exists, else org then personal"),
      note: z.string().optional().describe("A release note, kept on the release"),
      wait: z.boolean().optional().describe("Follow a source build to its end (default true); false answers at once with the job"),
      waitSeconds: z.number().int().positive().max(600).optional().describe("How long to follow a build before answering with it still running (default 600)"),
      bundleBase64: z.string().optional().describe("A SMALL .glyphh bundle (a zip) as base64, handed over from outside — under 64 KB; otherwise pass `dir`"),
      intent: z.literal("app").optional().describe('Confirm this is meant to be an APP. A skill or a task goes through skill_save.'),
    },
    async ({ dir, slug, kind, note, wait, waitSeconds, bundleBase64 }) => {
      if (bundleBase64) {
        try {
          refuseBase64Flood(bundleBase64);
          const installed = await dispatchRelayMethod("apps.install", { bundleBase64 });
          return text({ installed, where: WHERE.app, convert: 'wrong shape? skill_retype { slug, to: "task" | "skill" }' });
        } catch (err) { return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true }; }
      }
      return cloud(async () => {
        const out = await installFolderAsInstance(dir || getExplicitWorkingDirectory(), {
          ...(slug ? { slug } : {}), ...(kind ? { kind } : {}), ...(note ? { note } : {}),
          wait: wait !== false, ...(waitSeconds ? { waitMs: waitSeconds * 1000 } : {}),
        });
        return { ...out, where: WHERE.app, next: out.release ? "open it: panels_open { app: <slug> }; its tools are in app_list_tools" : `still building: app_build_status { job: "${out.job?.id ?? ""}" }` };
      });
    },
  );
  // THE STARTER (his order, 2026-10-07; punch list 12): the first call of an
  // app build writes a working app into the folder, with the member's real
  // connected-account tool names, and answers the whole spec.
  mcp.tool(
    "glyphh_app_scaffold",
    "START a Glyphh app here — call this FIRST when asked to build one. Writes a working starter into a folder on this machine (manifest.json, worker.js with one handler per tool, app/ pages, next.config.mjs, package.json, SKILL.md, and CONNECTIONS.md with the member's REAL connected-account tool names) and answers the full app spec plus the next steps. Then edit it and Build and run with app_install { dir }.",
    {
      name: z.string().describe("The app's name"),
      slug: z.string().optional().describe("The folder and instance slug (lowercase [a-z0-9_-]); default: from the name"),
      dir: z.string().optional().describe("Where to write it: under this session's folder by default (<folder>/<slug>), or an absolute path"),
      description: z.string().optional().describe("One or two lines of what it does"),
      connections: z.array(z.string()).optional().describe("Connection slugs the app works through (gmail, slack, google_calendar …)"),
      tools: z.array(z.object({ name: z.string(), description: z.string().optional(), inputSchema: z.record(z.string(), z.unknown()).optional() })).optional().describe("The tools the app exposes to the agent; each gets a worker handler"),
    },
    async ({ name, slug, dir, description, connections, tools }) => cloud(async () => {
      const catalog = getCatalogAge() < 5 * 60 * 1000 ? getConnectorCatalog() : await refreshConnectorCatalog().catch(() => getConnectorCatalog());
      return scaffoldAppFolder({
        name, ...(slug ? { slug } : {}), ...(dir ? { dir } : {}), ...(description ? { description } : {}),
        connections: connections ?? [], tools: tools ?? [],
        base: getExplicitWorkingDirectory() || "",
        connectorTools: (app) => catalog.filter((t) => t.slug.toLowerCase() === app).map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}), ...(t.inputSchema ? { inputSchema: t.inputSchema as Record<string, unknown> } : {}) })),
      });
    }),
  );
  mcp.tool(
    "app_build_status",
    "Read a Glyphh app BUILD JOB (app_install on a source folder answers one): { id, key, status: queued | building | ready | failed, log (the tail), release (once ready), error (when failed) }. `waitSeconds` follows it that long before answering.",
    {
      job: z.string().describe("The job id (job_…) from app_install"),
      waitSeconds: z.number().int().positive().max(600).optional().describe("Follow the job up to this long (default: answer at once)"),
    },
    async ({ job, waitSeconds }) => cloud(async () => {
      const j = waitSeconds ? await waitBuildJob(job, { timeoutMs: waitSeconds * 1000 }) : await readBuildJob(job);
      return { ...j, log: logTail(j.log || "") };
    }),
  );
  mcp.tool(
    "app_releases",
    "List an installed Glyphh app's releases, oldest first: [{ n, sha256, sizeBytes, note, at, by, pinned }] — `pinned` marks the one the app server serves. `app` is the instance key from app_list_tools (or the slug).",
    { app: z.string().describe("App key — from app_list_tools (or the slug)") },
    async ({ app }) => cloud(() => listInstanceReleases(app)),
  );
  mcp.tool(
    "app_pin",
    "PIN a release of an installed Glyphh app — rollback = pin n-1 (app_releases lists them). The app server reloads the instance on that release at once; nothing is rebuilt. Returns the instance with its `release`.",
    {
      app: z.string().describe("App key — from app_list_tools (or the slug)"),
      n: z.number().int().positive().describe("The release number to pin"),
    },
    async ({ app, n }) => cloud(() => pinInstanceRelease(app, n)),
  );

  // ── The SEMANTIC STACK — every app's own vector store + knowledge graph
  //    (glyphh-agent-semantic.ts; restored 2026-09-14). The workpanel-app
  //    contract's data plane: loops discover, build, and query an app's
  //    stores through these six; scheduled tasks refresh them.
  const semantic = (name: string, shape: Record<string, z.ZodTypeAny>): void => {
    const def = SEMANTIC_TOOLS.find((t) => t.name === name)!;
    mcp.tool(name, def.doc, shape, async (a: Record<string, unknown>) => {
      try { return text(await def.run(a)); }
      catch (err) { return text(`Error: ${err instanceof Error ? err.message : String(err)}`); }
    });
  };
  const appArg = z.string().describe("Target app slug — the stores travel with the app");
  const collArg = z.string().describe("Vector collection name ([a-zA-Z0-9_-])");
  semantic("semantic_collections", { app: appArg });
  semantic("index_files", {
    app: appArg, collection: collArg,
    paths: z.array(z.string()).describe("Working-folder file paths (max 50, 1MB each)"),
    chunkChars: z.number().optional().describe("Chunk size in chars (200–4000, default 1500)"),
  });
  semantic("index_text", {
    app: appArg, collection: collArg,
    id: z.string().describe("Stable source id for these chunks"),
    text: z.string().describe("Raw text to chunk + embed"),
    chunkChars: z.number().optional(),
  });
  semantic("index_connection", {
    app: appArg, collection: collArg,
    slug: z.string().describe("Connection slug (from the user's connections)"),
    tool: z.string().describe("The connector tool to run"),
    props: z.record(z.string(), z.unknown()).optional().describe("Arguments for the connector tool"),
  });
  semantic("vector_search", {
    app: appArg, collection: collArg,
    query: z.string().describe("Semantic query text"),
    k: z.number().optional().describe("Top-k (1–50, default 8)"),
    filter: z.record(z.string(), z.unknown()).optional().describe("Exact-match metadata filter"),
  });
  semantic("graph_query", {
    app: appArg,
    cypher: z.string().describe("Cypher statement(s) — CREATE NODE TABLE first; Kuzu is schema-full"),
  });

  // ── RPA — drive an open app panel ────────────────────
  mcp.tool(
    "rpa_click",
    "Click inside an open app panel. Pass the panel `app` slug (from panels_list) and EITHER a CSS `selector` (clicked in-page) OR absolute `x`/`y` coordinates (a real input event). Open the panel first with panels_open.",
    { app: z.string(), selector: z.string().optional(), x: z.number().optional(), y: z.number().optional() },
    async (a) => via("rpa.click", a),
  );
  mcp.tool(
    "rpa_type",
    "Type into an element in an open app panel: focuses `selector`, sets its value, fires input/change. Set `submit` to also submit the surrounding form.",
    { app: z.string(), selector: z.string(), text: z.string(), submit: z.boolean().optional() },
    async (a) => via("rpa.type", a),
  );
  mcp.tool(
    "rpa_read",
    "Read text or HTML from an open app panel — a `selector`'s content, or the whole page when omitted. `as` is 'text' (default) or 'html'.",
    { app: z.string(), selector: z.string().optional(), as: z.enum(["text", "html"]).optional() },
    async (a) => via("rpa.read", a),
  );
  mcp.tool(
    "rpa_screenshot",
    "See an open app panel: returns a screenshot of its current frame as an image.",
    { app: z.string() },
    // An IMAGE, not a data URL in text (his audit, 2026-09-29: the base64 text
    // of one screenshot was a 96,667-token call that showed the model nothing).
    async (a) => {
      try {
        const { dataUrl } = await dispatchRelayMethod("rpa.screenshot", a) as { dataUrl: string };
        const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl);
        if (!m) return { content: [{ type: "text" as const, text: "Error: the panel returned no image" }], isError: true };
        return { content: [{ type: "text" as const, text: `Screenshot of ${a.app}` }, { type: "image" as const, data: m[2], mimeType: m[1] }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    },
  );
  mcp.tool(
    "rpa_goto",
    "Navigate an open app panel to an http(s) URL. To show a page in the Browser, use panels_open { app: \"browser\", url } instead: it opens the page as a tab in the Browser the user sees, in one step.",
    { app: z.string(), url: z.string() },
    async (a) => via("rpa.goto", a),
  );

  // ── RPA ON A TAB (his order, 2026-10-07): the mapped commands and the
  // sequences a saved tab carries, which the agent builds out itself. Every
  // mapped command is also its own tool, <tab>_<key>, in the loop's catalog. ──
  const guideArg = z.object({
    pre: z.string().optional().describe("What must be true before it runs"),
    post: z.string().optional().describe("What to expect after it succeeds"),
    verify: z.string().optional().describe("A selector that must exist afterwards, or the run failed"),
    recover: z.string().optional().describe("What to try when it fails"),
    delay: z.number().optional().describe("Milliseconds to wait after acting, before verifying"),
  }).optional().describe("The guide that makes the command reliable");
  mcp.tool(
    "rpa_commands",
    "The RPA commands and sequences mapped on a saved tab (its slug from panels_available), and whether its panel is open. Map more with rpa_pick + rpa_map; run one with rpa_run, or by its own tool name <tab>_<command>.",
    { app: z.string().describe("The tab's slug") },
    async (a) => via("rpa.commands", a),
  );
  mcp.tool(
    "rpa_pick",
    "Ask the user to point at an element on the tab's panel: a picker overlay appears on the panel on their screen (it opens if it is not up), they click the element, and you get its selector, tag, text and whether it is editable or clickable. Use it when you cannot find a selector by rpa_read; then rpa_map it.",
    { app: z.string().describe("The tab's slug") },
    async (a) => via("rpa.pick", a),
  );
  mcp.tool(
    "rpa_map",
    "Map (or remap) an RPA command on a saved tab: a key, what it does, the action (click, type, read, readHtml, goto, custom) and the selector it acts on. `text`/`url` take {{value}} for the caller's value; `custom` runs `script` in the page with VALUE in scope. Give it a guide (verify selector, delay, recover) so it runs reliably without the user.",
    {
      app: z.string().describe("The tab's slug"),
      key: z.string().describe("The command key: lowercase, digits, _ or -"),
      description: z.string().describe("What it does, for whoever runs it"),
      action: z.enum(["click", "type", "read", "readHtml", "goto", "custom"]),
      selector: z.string().optional().describe("The element (click, type, read, readHtml)"),
      text: z.string().optional().describe("type: the text; {{value}} is the caller's value (default)"),
      url: z.string().optional().describe("goto: the address; {{value}} allowed"),
      script: z.string().optional().describe("custom: JavaScript run in the page; VALUE is in scope"),
      waitFor: z.string().optional().describe("A selector to wait for before acting"),
      guide: guideArg,
    },
    async (a) => via("rpa.map", a),
  );
  mcp.tool(
    "rpa_unmap",
    "Remove an RPA command from a saved tab.",
    { app: z.string(), key: z.string() },
    async (a) => via("rpa.unmap", a),
  );
  mcp.tool(
    "rpa_run",
    "Run one mapped RPA command on the tab's panel, the user watching (the panel opens if it is not up). `value` fills {{value}} for type, goto and custom. A read returns the text.",
    { app: z.string(), command: z.string(), value: z.string().optional() },
    async (a) => via("rpa.run", a),
  );
  mcp.tool(
    "rpa_sequence_save",
    "Save (or replace) an RPA sequence on a saved tab: a shortcut of ordered steps over its mapped commands. A step's `value` may carry {{placeholders}}, filled from rpa_sequence_run's args; a read's result is in scope for later steps as {{<command>}}. The sequence becomes its own tool, <tab>_<name>.",
    {
      app: z.string(), name: z.string().describe("lowercase, digits, _ or -"), description: z.string(),
      steps: z.array(z.object({ command: z.string(), value: z.string().optional(), waitFor: z.string().optional() })).min(1),
    },
    async (a) => via("rpa.sequenceSave", a),
  );
  mcp.tool(
    "rpa_sequence_remove",
    "Remove an RPA sequence from a saved tab.",
    { app: z.string(), name: z.string() },
    async (a) => via("rpa.sequenceRemove", a),
  );
  mcp.tool(
    "rpa_sequence_run",
    "Run a saved RPA sequence on the tab's panel, step by step, the user watching. `args` fills the steps' {{placeholders}}. It stops at the first failing step and says which.",
    { app: z.string(), sequence: z.string(), args: z.record(z.string(), z.unknown()).optional() },
    async (a) => via("rpa.sequenceRun", a),
  );

  // ── Scrape (the runners for saved loops/skills/agents left with the scheduler, 2026-09-21) ──
  // ── Memory pages (his order, 2026-09-20): what the curator skill reads and writes ──
  const memText = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
  mcp.tool(
    "memory_turns",
    "The user's remembered turns on this machine (what they said and what the loop answered), newest first, with the folder and workspace each ran in. Read these to compile memory pages.",
    { limit: z.number().int().min(1).max(500).optional().describe("How many turns (default 100)"), days: z.number().int().min(1).max(365).optional().describe("Only turns from the last N days") },
    async ({ limit, days }) => { const { memoryTurns } = await import("./memory.js"); return memText(memoryTurns({ limit, days })); },
  );
  mcp.tool(
    "memory_pages",
    "The memory pages that exist today: the Profile (section you), topics and areas, each with title, summary and details. Update a page by writing it again with the same title.",
    {},
    async () => { const { memoryPages } = await import("./memory.js"); return memText(memoryPages()); },
  );
  mcp.tool(
    "memory_page_write",
    "Write (or rewrite) one memory page. section: you = the Profile, topic = a recurring subject, area = a project or domain. Keep details to short factual bullets the user actually said; never invent.",
    { section: z.enum(["you", "topic", "area"]), title: z.string().min(1).max(90), summary: z.string().max(140).describe("One line under the title"), details: z.array(z.string()).min(1).max(40) },
    async (input) => { const { writeMemoryPage } = await import("./memory.js"); try { return memText(await writeMemoryPage(input)); } catch (err) { return memText(`Error: ${err instanceof Error ? err.message : String(err)}`); } },
  );
  mcp.tool(
    "memory_page_delete",
    "Delete a memory page by its id (from memory_pages).",
    { id: z.string().min(1) },
    async ({ id }) => { const { deleteMemoryPage } = await import("./memory.js"); return memText(deleteMemoryPage(id)); },
  );
  // ── THE POWERS (his order, 2026-10-09): one tool per power, on the
  //    server's metered media pipeline (main/powers.ts). Glyphh combines them,
  //    a super power's workflow calls them, a member talks to one directly.
  const powerText = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v) }] });
  const powerRun = async (id: "images" | "video" | "audio", input: Record<string, unknown>) => {
    try {
      const { runPower } = await import("./powers.js");
      return powerText(await runPower(id, input as { prompt: string }));
    } catch (err) { return { ...powerText(`Error: ${err instanceof Error ? err.message : String(err)}`), isError: true }; }
  };
  const saveAs = z.string().optional().describe("Also write the file into the member's folder under this name (e.g. \"brand/hero.png\"); never a path outside it.");
  const folder = z.string().optional().describe("The folder saveAs writes into; default the member's working folder.");
  mcp.tool(
    "powers_list",
    "Glyphh's POWERS on this member's plan — Images, Video, Audio — each with its tool and the models it can use. Call it to pick a model for a power or to offer a comparison across models.",
    {},
    async () => { try { const { availablePowers } = await import("./powers.js"); return powerText(await availablePowers()); } catch (err) { return { ...powerText(`Error: ${err instanceof Error ? err.message : String(err)}`), isError: true }; } },
  );
  mcp.tool(
    "image_generate",
    "The Images power: make a picture from a prompt. Answers { model, assetId, url, usd, saved? }; the picture is kept in the member's media library, and in their folder when saveAs is given. model is optional (powers_list names them).",
    { prompt: z.string().min(1), model: z.string().optional(), size: z.string().optional().describe("e.g. 1024x1024, 1024x1536"), title: z.string().optional(), saveAs, folder },
    async (input) => powerRun("images", input),
  );
  mcp.tool(
    "video_generate",
    "The Video power: make a short clip from a prompt, or from a picture (imageUrl). Takes a while. Answers { model, assetId, url, usd, saved? }.",
    { prompt: z.string().min(1), model: z.string().optional(), seconds: z.number().optional(), imageUrl: z.string().optional(), size: z.string().optional(), title: z.string().optional(), saveAs, folder },
    async (input) => powerRun("video", input),
  );
  mcp.tool(
    "audio_generate",
    "The Audio power: make music, a sound effect or spoken voice from a prompt. Answers { model, assetId, url, usd, saved? }.",
    { prompt: z.string().min(1), model: z.string().optional(), seconds: z.number().optional(), voice: z.string().optional(), title: z.string().optional(), saveAs, folder },
    async (input) => powerRun("audio", input),
  );
  mcp.tool(
    "scrape_page",
    "Load an http(s) URL headlessly on the user's machine and return its title, text, and html. `wait` (ms, ≤15000) delays extraction for JS-rendered pages.",
    { url: z.string(), wait: z.number().optional() },
    async ({ url, wait }) => via("scrape.page", { url, wait }),
  );

}

/** One of Glyphh's own tools, ready for the loop's catalog. */
export interface HostTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<{ text: string; failed: boolean; images?: Array<{ type: "image"; source: { type: "base64"; media_type: string; data: string } }> }>;
}

/**
 * Glyphh's tools, built fresh (each run reads the state it needs at call time).
 * `unattended`: the screen-touching ones are left out (unattended-tools.ts) —
 * a schedule or a background build has nobody to look at a panel.
 */
export function hostTools(opts: { unattended?: boolean } = {}): HostTool[] {
  const out: HostTool[] = [];
  registerTools({
    tool(name, description, shape, handler) {
      if (opts.unattended && UNATTENDED_HIDDEN.has(name)) return;
      const schema = z.object(shape);
      let inputSchema: Record<string, unknown> = { type: "object", properties: {} };
      try { inputSchema = z.toJSONSchema(schema) as Record<string, unknown>; } catch { /* a shape zod cannot draw: the model gets the empty object */ }
      out.push({
        name, description, inputSchema,
        async run(args) {
          const parsed = schema.safeParse(args ?? {});
          if (!parsed.success) return { text: `Error: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`, failed: true };
          try {
            const r = await handler(parsed.data);
            const parts = r?.content ?? [];
            const images = parts.flatMap((c) => (c.type === "image" ? [{ type: "image" as const, source: { type: "base64" as const, media_type: c.mimeType, data: c.data } }] : []));
            const text = parts.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
            return { text, failed: !!r?.isError, ...(images.length ? { images } : {}) };
          } catch (err) {
            return { text: `Error: ${err instanceof Error ? err.message : String(err)}`, failed: true };
          }
        },
      });
    },
  });
  return out;
}
