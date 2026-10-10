/**
 * Swarm mode's reach rule (his order, 2026-10-09: "defined by the super power
 * relationships"; "both… the agent can start it or the user can"): Glyphh
 * hands work to the team's members and the super powers it holds; a held one
 * not yet on the team joins it. Holding none, any super power may be brought in.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("electron", () => ({ ipcMain: { handle: () => {} } }));
vi.mock("../../src/main/glyphh-loop", () => ({ currentTurnChat: () => null, loopSenderOf: () => null }));
vi.mock("../../src/main/agent-ipc", () => ({ storedChat: () => undefined }));
vi.mock("../../src/main/local-agents", () => ({ glyphhRow: () => null, listAgents: () => [] }));

const { teamReach, handOff } = await import("../../src/main/swarm");
const ROSTER = ["ui-builder", "video", "writer"];

describe("who Glyphh may hand work to", () => {
  it("the members, plus what Glyphh holds — a held one joins the team", () => {
    const r = teamReach(["ui-builder"], ["video"], ROSTER);
    expect([...r.allowed].sort()).toEqual(["ui-builder", "video"]);
    expect([...r.joins]).toEqual(["video"]);
  });
  it("nothing withheld, any super power may be brought in", () => {
    const r = teamReach([], null, ROSTER);
    expect([...r.allowed].sort()).toEqual(ROSTER);
    expect([...r.joins].sort()).toEqual(ROSTER);
  });
  it("every one withheld, only the members", () => {
    expect([...teamReach(["writer"], [], ROSTER).allowed]).toEqual(["writer"]);
  });
  it("a held slug that is no super power is ignored", () => {
    expect([...teamReach([], ["ghost"], ROSTER).allowed]).toEqual([]);
  });
  it("hand_off outside a conversation says so instead of running", async () => {
    expect(await handOff({ member: "video", task: "x" })).toMatchObject({ ok: false, error: /inside a conversation/ });
  });
});
