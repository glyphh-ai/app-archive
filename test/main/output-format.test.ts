import { describe, expect, it } from "vitest";
import { appOutputId, appOutputKey, appStandingLine, isAppOutput, isStoredOutputFormat, noteOutputAppUse, orderedOutputApps, outputChipLabel, outputFormatOf, outputStandingLine, ARTIFACT_STANDING_LINE, type OutputApp } from "../../src/renderer/help/output-format.js";

const APPS: OutputApp[] = [
  { key: "notes~u1", slug: "notes", name: "Notes", tools: ["add_note"] },
  { key: "crm", slug: "crm", name: "CRM", tools: ["add_lead", "find_lead"] },
  { key: "zeta~u1", slug: "zeta", name: "Zeta", tools: [] },
  { key: "alpha", slug: "alpha", name: "Alpha", tools: ["a"] },
  { key: "beta", slug: "beta", name: "Beta", tools: [] },
  { key: "gamma", slug: "gamma", name: "Gamma", tools: [] },
  { key: "delta", slug: "delta", name: "Delta", tools: [] },
];

describe("APPS AS OUTPUT TARGETS (2026-10-07)", () => {
  it("an app pick is stored as app:<key>; anything else folds to Auto as before", () => {
    expect(isAppOutput("app:crm")).toBe(true);
    expect(isAppOutput("app:")).toBe(false);
    expect(appOutputKey("app:notes~u1")).toBe("notes~u1");
    expect(appOutputId("crm")).toBe("app:crm");
    expect(isStoredOutputFormat("app:crm")).toBe(true);
    expect(outputFormatOf("app:crm")).toBe("app:crm");
    expect(outputFormatOf("docs")).toBe("auto");
    expect(outputChipLabel("app:crm", APPS)).toBe("CRM");
    expect(outputChipLabel("app:gone", APPS)).toBe("App");
    expect(outputChipLabel("artifact")).toBe("Artifact");
  });
  it("the drop-up shows this member's recent picks first, then the rest by name, five then More", () => {
    const { top, rest } = orderedOutputApps(APPS, ["crm", "zeta~u1", "missing"]);
    expect(top.map((a) => a.key)).toEqual(["crm", "zeta~u1", "alpha", "beta", "delta"]);
    expect(rest.map((a) => a.key)).toEqual(["gamma", "notes~u1"]);
    expect(orderedOutputApps(APPS, [], 3).top.map((a) => a.name)).toEqual(["Alpha", "Beta", "CRM"]);
    expect(noteOutputAppUse(["crm", "alpha"], "alpha")).toEqual(["alpha", "crm"]);
    expect(noteOutputAppUse([], "x", 1)).toEqual(["x"]);
    expect(noteOutputAppUse(["a", "b"], "c", 2)).toEqual(["c", "a"]);
  });
  it("the standing line puts the app and its tools front and center; the Artifact line is unchanged", () => {
    const line = outputStandingLine("app:crm", APPS[1]);
    expect(line).toMatch(/^OUTPUT TARGET: the CRM app \(instance key "crm"\)/);
    expect(line).toContain('app_call_tool { app: "crm", tool, args }');
    expect(line).toContain("Its tools: add_lead, find_lead.");
    expect(outputStandingLine("app:notes~u1", null)).toContain('the notes app (instance key "notes~u1")');
    expect(outputStandingLine("artifact")).toBe(ARTIFACT_STANDING_LINE);
    expect(outputStandingLine("auto")).toBe("");
    expect(appStandingLine({ key: "zeta~u1", slug: "zeta", name: "Zeta", tools: [] })).not.toContain("Its tools:");
  });
});
