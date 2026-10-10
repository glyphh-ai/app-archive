/**
 * THE SCOPE (his order, 2026-10-10: "the LOOP MUST MUST respect it at all
 * costs... NO EXCEPTIONS"): a super power reaches only what its powers list
 * holds, Glyphh everything but what was withheld, and nothing a turn starts
 * or makes reaches further than the turn.
 */
import { describe, it, expect } from "vitest";
import { accountConnection, glyphhReach, holdsFolder, scopeRefusal, superPowerReach, type ScopeCallLike, type ScopeLookups } from "../../src/shared/turn-scope.js";

const look: ScopeLookups = {
  taskConnections: (slug) => (slug === "digest" ? ["gmail"] : slug === "poster" ? ["slack"] : null),
  scheduleTarget: (id) => (id === "s1" ? { kind: "task", target: "poster" } : null),
};
const marketer = superPowerReach({
  slug: "marketer", name: "Marketer", model: "anthropic::claude-sonnet-5", models: ["gpt-5"],
  connections: ["gmail"], skills: ["skill:digest", "task:poster"], superPowers: ["writer"], folders: ["/work/site"],
});
const glyphh = glyphhReach("Glyphh", { connections: ["slack"], superPowers: ["intruder"], folders: ["/private"], models: ["o9"] });
const call = (kind: ScopeCallLike["kind"], tool: string, input: Record<string, unknown> = {}, family?: string): ScopeCallLike => ({ kind, tool, input, ...(family ? { family } : {}) });
const ok = (c: ScopeCallLike, chain = [marketer]): string | null => scopeRefusal(c, chain, look);

describe("a super power holds its list and nothing else", () => {
  it("connections: the account lane, the custom-connection catalog and Glyphh's connector tools", () => {
    expect(ok(call("account", "pd_o1a2b3__gmail-send-email"))).toBeNull();
    expect(ok(call("account", "pd_o1a2b3__gmail__u_6d6c1f0e-send-email"))).toBeNull();
    expect(ok(call("account", "pd_o1a2b3__slack-post"))).toMatch(/Marketer doesn't hold the connection "slack"/);
    expect(ok(call("catalog", "crm_lookup", {}, "connection: crm"))).toMatch(/connection "crm"/);
    expect(ok(call("belt", "connector_call", { app: "gmail" }))).toBeNull();
    expect(ok(call("belt", "connector_call", { app: "slack" }))).not.toBeNull();
    expect(ok(call("catalog", "connections_call_tool", { connection: "crm" }))).not.toBeNull();
  });

  it("powers, super powers and models", () => {
    expect(ok(call("catalog", "skill_run", { slug: "digest" }))).toBeNull();
    expect(ok(call("catalog", "skill_run", { slug: "other" }))).toMatch(/power "other"/);
    expect(ok(call("spawn", "writer"))).toBeNull();
    expect(ok(call("spawn", "intruder"))).toMatch(/super power "intruder"/);
    expect(ok(call("belt", "hand_off", { member: "intruder" }))).not.toBeNull();
    expect(ok(call("catalog", "image_generate", { model: "gpt-5" }))).toBeNull();
    expect(ok(call("catalog", "image_generate", { model: "dall-e-9" }))).toMatch(/model "dall-e-9"/);
  });

  it("an empty list holds nothing", () => {
    const bare = superPowerReach({ slug: "bare", name: "Bare", model: "", models: [], connections: [], skills: [], superPowers: [], folders: [] });
    expect(ok(call("account", "pd_o1__gmail-send"), [bare])).not.toBeNull();
    expect(ok(call("spawn", "writer"), [bare])).not.toBeNull();
    expect(holdsFolder(bare, "/anything")).toBe(false);
  });

  it("works inside its folders only", () => {
    expect(holdsFolder(marketer, "/work/site")).toBe(true);
    expect(holdsFolder(marketer, "/work/site/blog")).toBe(true);
    expect(holdsFolder(marketer, "/work/sitemap")).toBe(false);
    expect(ok(call("catalog", "run_outside_sandbox", { command: "ls ~" }))).not.toBeNull();
  });
});

describe("nothing reaches further than the turn", () => {
  it("a task runs only when its declared connections are held, by name or by schedule", () => {
    expect(ok(call("catalog", "task_run", { slug: "digest" }))).toBeNull();
    expect(ok(call("catalog", "task_run", { slug: "poster" }))).toMatch(/connection "slack"/);
    expect(ok(call("catalog", "schedule_run", { id: "s1" }))).toMatch(/connection "slack"/);
    expect(ok(call("catalog", "schedule_save", { kind: "task", target: "poster" }))).toMatch(/connection "slack"/);
  });

  it("no turn edits the record that scopes it, and a super power edits none", () => {
    expect(ok(call("catalog", "agent_save", { agent: "marketer", connections: ["slack"] }))).toMatch(/can't change its own powers/);
    expect(ok(call("catalog", "agent_save", { agent: "writer" }))).toMatch(/only Glyphh/);
    expect(ok(call("catalog", "agent_save", { agent: "glyphh" }), [glyphh])).toMatch(/can't change its own powers/);
  });

  it("Glyphh can't mint a super power holding what Glyphh was denied", () => {
    expect(ok(call("catalog", "agent_save", { name: "New", connections: ["slack"] }), [glyphh])).toMatch(/connection "slack"/);
    expect(ok(call("catalog", "agent_save", { name: "New", connections: ["gmail"], folders: ["/private/keys"] }), [glyphh])).toMatch(/folder/);
    expect(ok(call("catalog", "agent_save", { name: "New", connections: ["gmail"] }), [glyphh])).toBeNull();
    expect(ok(call("catalog", "skill_save", { type: "task", connections: ["slack"] }), [glyphh])).toMatch(/connection "slack"/);
  });

  it("a sub-agent is held to its own list AND the turn that started it", () => {
    const writer = superPowerReach({ slug: "writer", name: "Writer", model: "", models: [], connections: ["gmail", "slack"], skills: [], superPowers: [], folders: [] });
    expect(ok(call("account", "pd_o1__slack-post"), [writer])).toBeNull();
    expect(ok(call("account", "pd_o1__slack-post"), [marketer, writer])).toMatch(/Marketer doesn't hold/);
    expect(ok(call("account", "pd_o1__gmail-send"), [marketer, writer])).toBeNull();
  });
});

describe("Glyphh holds everything but what was withheld", () => {
  it("allows the rest and refuses the withheld", () => {
    expect(ok(call("account", "pd_o1__gmail-send"), [glyphh])).toBeNull();
    expect(ok(call("account", "pd_o1__slack-post"), [glyphh])).toMatch(/Glyphh doesn't hold the connection "slack"/);
    expect(ok(call("spawn", "intruder"), [glyphh])).not.toBeNull();
    expect(ok(call("spawn", "writer"), [glyphh])).toBeNull();
    expect(holdsFolder(glyphh, "/private/notes")).toBe(false);
    expect(holdsFolder(glyphh, "/work")).toBe(true);
  });

  it("an unreadable scope refuses", () => {
    expect(scopeRefusal(call("builtin", "read_file"), [], look)).not.toBeNull();
  });
});

describe("account tool names", () => {
  it("name their connection", () => {
    expect(accountConnection("pd_o1a2b3__google_sheets-add-row")).toBe("google_sheets");
    expect(accountConnection("pd_o1a2b3__gmail__u_6d6c1f0e-send")).toBe("gmail");
    expect(accountConnection("pd_o1a2b3__gmail__support_inbox-send")).toBe("gmail");
    expect(accountConnection("mcp_o1a2b3__billing_api-lookup")).toBe("billing_api");
    expect(accountConnection("plain_server-tool")).toBe("plain_server");
  });
});
