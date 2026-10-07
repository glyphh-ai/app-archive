import { describe, expect, it } from "vitest";
import { appBuildIntent, appBuildSteer, appBuildSteerFor, armAppBuildDoor } from "../../src/renderer/help/app-build-steer.js";

describe("THE CONTRACT IS PUSHED INTO THE TURN (2026-10-07)", () => {
  it("knows an app build when the prompt says glyphh app, in any case", () => {
    expect(appBuildIntent("build me a simple glyphh app with my gmail connection")).toBe(true);
    expect(appBuildIntent("Make a Glyphh App that tracks shoes")).toBe(true);
    expect(appBuildIntent("an app for Glyphh please")).toBe(true);
    expect(appBuildIntent("write a slack bot")).toBe(false);
    expect(appBuildIntent("")).toBe(false);
  });
  it("the steer names the scaffold FIRST, the one install door by path, and forbids searching and base64", () => {
    const s = appBuildSteer("/w/inbox");
    expect(s.split("\n")[1]).toMatch(/^1\. FIRST call glyphh_app_scaffold/);
    expect(s).toContain("in /w/inbox");
    expect(s).toContain('app_install { dir: "<the app\'s folder>" }');
    expect(s).toMatch(/do NOT search/);
    expect(s).toMatch(/NEVER tar, zip or base64/);
    expect(s).toContain("app_build_status { job }");
    expect(appBuildSteer(null)).toContain("in this session's folder");
  });
  it("the New app door arms one turn, whatever it says; otherwise only an app prompt steers", () => {
    expect(appBuildSteerFor("fix the tests", "/w")).toBe("");
    armAppBuildDoor();
    expect(appBuildSteerFor("fix the tests", "/w")).not.toBe("");
    expect(appBuildSteerFor("fix the tests", "/w")).toBe("");
    expect(appBuildSteerFor("a glyphh app for notes", null)).toContain("glyphh_app_scaffold");
  });
});
