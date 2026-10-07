import { describe, expect, it } from "vitest";
import { commentAuthor, decisionNeedsNote, mayRetire, notesRequired, queueForKinds, releaseLine, shareFace, standingLine, versionLabel } from "../../src/renderer/help/publish-desk.js";

describe("the developer's desk (2026-10-07)", () => {
  it("release notes are required on a re-share, never on the first", () => {
    expect(notesRequired(null, null, [])).toBe(false);
    expect(notesRequired(2, null, [])).toBe(true);
    expect(notesRequired(null, 1, [])).toBe(true);
    expect(notesRequired(null, null, [{ version: 1 }])).toBe(true);
  });
  it("the share button says what a share does now", () => {
    expect(shareFace({ head: null, pending: null })).toEqual({ label: "Share", again: false, blocked: "" });
    expect(shareFace({ head: 1, pending: null })).toMatchObject({ label: "Share a new version", again: true });
    expect(shareFace({ head: 1, pending: 2 }).blocked).toMatch(/v2 is on the review desk/);
    expect(shareFace({ head: null, pending: null, changes: 1 }).label).toBe("Share the next version");
    expect(shareFace({ head: null, pending: null, declined: { version: 1 } }).label).toBe("Share again");
  });
  it("the standing line reads the lifecycle first, then the desk", () => {
    expect(standingLine({ head: 1, pending: null, lifecycle: "retired", lifecycleNote: "use Recall 2" })).toMatch(/^Retired — use Recall 2\. No new installs/);
    expect(standingLine({ head: 1, pending: null, lifecycle: "removed" })).toMatch(/^Removed from Discover/);
    expect(standingLine({ head: 1, pending: 2 })).toMatch(/v2 is waiting/);
    expect(standingLine({ head: 1, pending: null, changes: { version: 2, note: "add tests" } })).toMatch(/Changes requested on v2: add tests/);
    expect(standingLine({ head: null, pending: null, declined: { version: 1, summary: "no" } })).toMatch(/v1 was declined: no/);
    expect(standingLine({ head: 3, pending: null })).toMatch(/v3 is live/);
    expect(standingLine({ head: null, pending: null })).toMatch(/^Not shared yet/);
  });
  it("labels: a hub version carries the manifest version it shipped; a release its size and whether it is live", () => {
    expect(versionLabel({ version: 2, notes: "", createdAt: "", status: "approved", manifestVersion: "1.1.0" })).toBe("v2 · 1.1.0 · live");
    expect(versionLabel({ version: 3, notes: "", createdAt: "", status: "changes" })).toBe("v3 · changes requested");
    expect(releaseLine({ n: 4, note: "", at: 0, pinned: true, sizeBytes: 2_200_000 })).toBe("release 4 · live · 2.1 MB");
    expect(releaseLine({ n: 1, note: "", at: 0, pinned: false, sizeBytes: 900 })).toBe("release 1 · 1 KB");
  });
  it("the review desk shows this page's kinds, newest first; a decline or changes needs a note", () => {
    const rows = [
      { id: "a", kind: "skill", version: 1, status: "pending", slug: "a", name: "A", created_at: "2026-10-01" },
      { id: "b", kind: "app", version: 2, status: "pending", slug: "b", name: "B", created_at: "2026-10-05" },
      { id: "c", kind: "task", version: 1, status: "changes", slug: "c", name: "C", created_at: "2026-10-03" },
    ];
    expect(queueForKinds(rows, ["app", "skill"]).map((r) => r.id)).toEqual(["b", "a"]);
    expect(decisionNeedsNote("approve", "")).toBe(false);
    expect(decisionNeedsNote("changes", " ")).toBe(true);
    expect(decisionNeedsNote("reject", "no")).toBe(false);
    expect(commentAuthor({ id: "ai:x", by: "ai", author: "", body: "", createdAt: null })).toBe("Review agent");
    expect(commentAuthor({ id: "1", by: "u1", author: "Ada", body: "", createdAt: null })).toBe("Ada");
    expect(mayRetire({ admin: false, own: true })).toBe(true);
    expect(mayRetire({ admin: false, own: false })).toBe(false);
  });
});
