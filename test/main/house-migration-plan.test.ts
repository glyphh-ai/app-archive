/**
 * house-migration-plan.test.ts — what the Mac still holds goes up, once
 * (src/main/house-migration-plan.ts; his order, 2026-10-06: migrate the
 * data, delete everything local). Idempotent on the server's ids, live or
 * tombstoned; folders first; a folder the cloud will not have means the root.
 */
import { describe, expect, it } from "vitest";
import { houseMigrationPlan, type ServerRow } from "../../src/main/house-migration-plan";

const local = [
  { kind: "deck" as const, id: "q3.html", folderId: "f1" },
  { kind: "image" as const, id: "a.png", folderId: "f2" },
  { kind: "folder" as const, id: "f1", parentId: null },
  { kind: "folder" as const, id: "f2", parentId: "f-live" },
  { kind: "design" as const, id: "brand.json", folderId: null },
  { kind: "design" as const, id: "brand.json", folderId: null },
  { kind: "video" as const, id: "clip.mp4", folderId: "f-gone" },
  { kind: "folder" as const, id: "f3", parentId: "f-gone" },
];

describe("houseMigrationPlan", () => {
  it("plans every local item the server has no row for, folders first, each once", () => {
    const plan = houseMigrationPlan(local, []);
    expect(plan.map((p) => `${p.kind}/${p.id}`)).toEqual(["folder/f1", "folder/f2", "folder/f3", "design/brand.json", "deck/q3.html", "image/a.png", "video/clip.mp4"]);
  });

  it("skips an id the server holds — live (the member's cloud copy wins) or tombstoned (deleted there stays deleted)", () => {
    const server: ServerRow[] = [{ kind: "deck", id: "q3.html", deleted: false }, { kind: "image", id: "a.png", deleted: true }, { kind: "folder", id: "f1", deleted: false }];
    const plan = houseMigrationPlan(local, server);
    expect(plan.map((p) => `${p.kind}/${p.id}`)).toEqual(["folder/f2", "folder/f3", "design/brand.json", "video/clip.mp4"]);
  });

  it("a second run plans nothing: its own puts are the server's rows now", () => {
    const once = houseMigrationPlan(local, []);
    const server = once.map((p): ServerRow => ({ kind: p.kind, id: p.id, deleted: false }));
    expect(houseMigrationPlan(local, server)).toEqual([]);
  });

  it("a record filed in a folder the cloud will not have lands at the root; one in a planned or live folder keeps it; a folder's parent the same", () => {
    const server: ServerRow[] = [{ kind: "folder", id: "f-live", deleted: false }, { kind: "folder", id: "f-gone", deleted: true }];
    const plan = houseMigrationPlan(local, server);
    const by = Object.fromEntries(plan.map((p) => [`${p.kind}/${p.id}`, p]));
    expect(by["deck/q3.html"]!.folderId).toBe("f1");
    expect(by["folder/f2"]!.parentId).toBe("f-live");
    expect(by["video/clip.mp4"]!.folderId).toBeNull();
    expect(by["folder/f3"]!.parentId).toBeNull();
    expect(by["design/brand.json"]!.folderId).toBeNull();
    expect("folderId" in by["folder/f1"]!).toBe(false);
  });
});
