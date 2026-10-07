import { describe, expect, it } from "vitest";
import { countUpdates } from "../../src/renderer/help/app-updates.js";
import { instanceCardOf, updateOf } from "../../src/shared/app-instances.js";

const base = { key: "notes~u1", slug: "notes", kind: "personal" as const, access: "owner", public: false, status: "ready" as const, members: [], orgConnectionId: null, bundle: { sha256: "a", bytes: 1 }, manifest: { name: "Notes", tools: [], capabilities: [], connectors: [] }, url: "/app-host/notes~u1/" };

describe("APPS CARRY A VERSION (2026-10-07): the card reads its version and the update that waits", () => {
  it("updateOf normalises the server's update block and refuses junk", () => {
    expect(updateOf(null)).toBeNull();
    expect(updateOf({ update: null })).toBeNull();
    expect(updateOf({ update: { available: true, headVersion: "1.2.0", headRelease: 4, itemRef: "glyphh:notes" } })).toEqual({ available: true, headVersion: "1.2.0", headRelease: 4 });
    expect(updateOf({ update: { available: false, headVersion: null, headRelease: 1.5 as number, itemRef: null } })).toEqual({ available: false, headVersion: null, headRelease: null });
  });
  it("the card carries version + update; an instance without them reads null", () => {
    const c = instanceCardOf({ ...base, release: 3, version: "1.1.0", update: { available: true, headVersion: "1.2.0", headRelease: 4, itemRef: null } } as never);
    expect(c.instance.version).toBe("1.1.0");
    expect(c.instance.update).toEqual({ available: true, headVersion: "1.2.0", headRelease: 4 });
    const plain = instanceCardOf({ ...base, release: 1 } as never);
    expect(plain.instance.version).toBeNull();
    expect(plain.instance.update).toBeNull();
  });
  it("countUpdates = the red number on Build: only cards whose update is available", () => {
    expect(countUpdates(null)).toBe(0);
    expect(countUpdates([{ instance: { update: { available: true } } }, { instance: { update: { available: false } } }, { instance: null }, {}])).toBe(1);
  });
});
