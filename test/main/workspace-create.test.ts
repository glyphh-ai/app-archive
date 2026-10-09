import { describe, it, expect } from "vitest";
import { workspaceFormError } from "../../src/renderer/help/workspace-form.js";

describe("the Create workspace modal's check (his order, 2026-10-08)", () => {
  it("needs a name", () => {
    expect(workspaceFormError("", [])).toMatch(/name/i);
    expect(workspaceFormError("   ", [])).toMatch(/name/i);
  });
  it("refuses a name that exists, whatever its case", () => {
    expect(workspaceFormError("Dev", ["dev"])).toMatch(/already exists/);
  });
  it("takes a new name", () => {
    expect(workspaceFormError("Mail", ["dev"])).toBeNull();
  });
});
