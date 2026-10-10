/**
 * THE ONE CHIP (his decision, 2026-10-10): `machine · project · branch`. A
 * project not made yet is a New project, never "workspace"; a Glyphh machine
 * that is asleep says so and offers Wake; waking shows until it is up.
 */
import { describe, expect, it } from "vitest";
import { NEW_PROJECT, gitLaneFor, machineStateOf, projectLabel } from "../../src/renderer/help/where-card";
import { GLYPHH_MACHINE_WORKSPACE } from "../../src/renderer/help/session-locus";

describe("the project's name on the chip", () => {
  it("is the folder's own name", () => {
    expect(projectLabel({ kind: "local", path: "/Users/c/code/cli" }, "/Users/c/code/cli")).toBe("cli");
    expect(projectLabel({ kind: "local", path: "", machine: "lunar-robin" }, "/data/workspace/my-app/")).toBe("my-app");
  });
  it("is a New project on the Glyphh machine's bare workspace (his pick, not 'workspace')", () => {
    expect(projectLabel({ kind: "local", path: GLYPHH_MACHINE_WORKSPACE, machine: "lunar-robin" }, GLYPHH_MACHINE_WORKSPACE)).toBe(NEW_PROJECT);
    expect(NEW_PROJECT).toBe("New project");
  });
  it("is a New project for a cloud folder before its first send, and the repo or folder after", () => {
    expect(projectLabel({ kind: "cloud-new" }, "")).toBe(NEW_PROJECT);
    expect(projectLabel({ kind: "cloud-space", space: "s1" }, "")).toBe(NEW_PROJECT);
    expect(projectLabel({ kind: "cloud-space", space: "s1", label: "notes" }, "")).toBe("notes");
    expect(projectLabel({ kind: "cloud-repo", repo: "glyphh-ai/site" }, "")).toBe("site");
    expect(projectLabel({ kind: "cloud-new", dir: "apps/web" }, "")).toBe("web");
  });
  it("is Home on this desktop with no folder picked (where the turn really runs)", () => {
    expect(projectLabel({ kind: "local", path: "" }, "")).toBe("Home");
  });
});

describe("the machine's state on the chip", () => {
  it("this desktop, an attached desktop and the cloud are ready", () => {
    for (const kind of ["local", "desktop", "cloud"]) expect(machineStateOf({ kind }, "", false)).toBe("ready");
  });
  it("a Glyphh machine not attached is asleep, starting, or waking while we wake it", () => {
    expect(machineStateOf({ kind: "glyphh" }, "stopped", false)).toBe("asleep");
    expect(machineStateOf({ kind: "glyphh" }, "", false)).toBe("asleep");
    expect(machineStateOf({ kind: "glyphh" }, "starting", false)).toBe("starting");
    expect(machineStateOf({ kind: "glyphh" }, "running", false)).toBe("starting");
    expect(machineStateOf({ kind: "glyphh" }, "stopped", true)).toBe("waking");
  });
  it("a machine no longer listed is gone", () => {
    expect(machineStateOf(null, "", false)).toBe("gone");
  });
});

describe("where git runs", () => {
  it("a cloud copy has no branch to change here, and says why", () => {
    const r = gitLaneFor({ kind: "cloud-new" }, "");
    expect(r.lane).toBeNull();
    expect(r.why).toMatch(/cloud copy/);
  });
  it("no folder, no git", () => {
    expect(gitLaneFor({ kind: "local", path: "" }, "").lane).toBeNull();
  });
});
