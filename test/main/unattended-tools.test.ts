import { describe, expect, it } from "vitest";
import { UNATTENDED_HIDDEN, isScreenFamily } from "../../src/main/unattended-tools.js";

describe("unattended runs get no screen (his report, 2026-10-08)", () => {
  it("names what is hidden: the panel, workspace and settings doors and all of RPA", () => {
    for (const t of ["panels_open", "panels_switch", "panels_close", "layouts_open", "settings_open", "rpa_pick", "rpa_run", "rpa_sequence_run", "rpa_screenshot"]) expect(UNATTENDED_HIDDEN.has(t), t).toBe(true);
    for (const t of ["panels_list", "panels_available", "skill_get", "task_run", "app_call_tool", "memory_pages"]) expect(UNATTENDED_HIDDEN.has(t), t).toBe(false);
    expect(isScreenFamily("rpa: Gmail")).toBe(true);
    expect(isScreenFamily("app: Images")).toBe(false);
  });
});
