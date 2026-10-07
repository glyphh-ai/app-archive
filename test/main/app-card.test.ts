import { describe, expect, it } from "vitest";
import { appCardFace, buildAndRunPrompt, buildLogOf, cardFromInstallAnswer, cardFromManifestWrite, folderOfPath, logLines, mergeAppCard, parseInstallAnswer } from "../../src/renderer/help/app-card.js";

describe("the app card in the thread (2026-10-07)", () => {
  it("a manifest.json the turn wrote makes a BUILT card for its folder; anything else does not", () => {
    expect(cardFromManifestWrite("write_file", "write_file /w/inbox-pulse/manifest.json", "/w", false)).toEqual({ folder: "/w/inbox-pulse", state: "built" });
    expect(cardFromManifestWrite("edit_file", "edit_file manifest.json", "/w/app", false)).toEqual({ folder: "/w/app", state: "built" });
    expect(cardFromManifestWrite("write_file", "write_file /w/app/worker.js", "/w", false)).toBeNull();
    expect(cardFromManifestWrite("write_file", "write_file /w/app/manifest.json", "/w", true)).toBeNull();
    expect(cardFromManifestWrite("read_file", "read_file /w/app/manifest.json", "/w", false)).toBeNull();
    expect(folderOfPath("/w/app/manifest.json")).toBe("/w/app");
  });
  it("app_install's answer makes the card installed (a release), building (a job) or failed", () => {
    expect(parseInstallAnswer("not json")).toBeNull();
    const a = parseInstallAnswer(JSON.stringify({ key: "recall~u1", mode: "bundle", release: { n: 2 }, job: null, url: "/app-host/recall~u1/ui/", tools: ["ask"] }));
    expect(cardFromInstallAnswer("/w/recall", a, false)).toEqual({ folder: "/w/recall", slug: "recall", key: "recall~u1", url: "/app-host/recall~u1/ui/", release: 2, job: null, tools: ["ask"], state: "installed" });
    const b = parseInstallAnswer(JSON.stringify({ key: "recall", mode: "source", release: null, job: { id: "job_1", status: "queued" }, url: "/app-host/recall/ui/" }));
    expect(cardFromInstallAnswer("/w/recall", b, false)).toMatchObject({ state: "building", job: "job_1", key: "recall", release: null });
    expect(cardFromInstallAnswer("/w/recall", null, true, "the build failed: boom")).toEqual({ folder: "/w/recall", state: "failed", error: "the build failed: boom" });
    expect(cardFromInstallAnswer("/w/recall", {}, false)).toMatchObject({ state: "failed" });
  });
  it("a later card folds into the earlier: the install's key/url/release stay, the state is the latest, a job clears when it is over", () => {
    const installed = cardFromInstallAnswer("/w/recall", { key: "recall", release: { n: 1 }, url: "/app-host/recall/ui/", tools: ["ask"] }, false);
    const rebuilt = mergeAppCard(installed, { folder: "/w/recall", state: "built" });
    expect(rebuilt).toMatchObject({ state: "built", key: "recall", url: "/app-host/recall/ui/", release: 1, tools: ["ask"], job: null });
    const building = mergeAppCard(rebuilt, { folder: "/w/recall", state: "building", job: "job_2" });
    expect(building).toMatchObject({ state: "building", job: "job_2", release: 1 });
    const done = mergeAppCard(building, cardFromInstallAnswer("/w/recall", { key: "recall", release: { n: 2 }, url: "/app-host/recall/ui/" }, false));
    expect(done).toMatchObject({ state: "installed", release: 2, job: null, tools: ["ask"] });
    expect(mergeAppCard(done, { folder: "/w/recall", state: "failed", error: "x" }).error).toBe("x");
  });
  it("the face says the next step: Build and run first, again after; Open and Share only once it runs", () => {
    expect(appCardFace({ folder: "/w/inbox-pulse", state: "built" })).toMatchObject({ title: "inbox-pulse", primary: "Build and run", primaryOn: true, canOpen: false, canShare: false });
    expect(appCardFace({ folder: "/w/x", slug: "recall", state: "installed", release: 3, url: "/app-host/recall/ui/", tools: ["a", "b"] })).toMatchObject({ title: "recall", primary: "Build and run again", canOpen: true, canShare: true });
    expect(appCardFace({ folder: "/w/x", slug: "recall", state: "installed", release: 3, url: "/app-host/recall/ui/", tools: ["a", "b"] }).sub).toMatch(/release 3 · 2 tools/);
    expect(appCardFace({ folder: "/w/x", state: "building", job: "job_1" })).toMatchObject({ primary: "Building…", primaryOn: false });
    expect(appCardFace({ folder: "/w/x", state: "built", release: 1, url: "/app-host/x/ui/" })).toMatchObject({ primary: "Build and run again", canOpen: true, canShare: true });
    expect(appCardFace({ folder: "/w/x", state: "failed", error: "boom" }).sub).toMatch(/boom/);
    expect(buildAndRunPrompt("/w/x")).toMatch(/app_install \{ dir: "\/w\/x" \}/);
  });

  it("THE BUILD LOG IN THE THREAD: a log rides the building card, stays on failure, clears when it runs", () => {
    expect(buildLogOf({ job: "job_1", status: "building", log: "npm ci\n" })).toEqual({ job: "job_1", status: "building", log: "npm ci\n" });
    expect(buildLogOf({ job: 1 })).toBeNull();
    expect(buildLogOf("x")).toBeNull();
    expect(logLines("a\nb\r\n\n c\nd", 2)).toBe(" c\nd");
    const building = mergeAppCard({ folder: "/w", state: "built" }, { folder: "/w", state: "building", job: "job_1", log: "npm ci" });
    expect(building.log).toBe("npm ci");
    const grown = mergeAppCard(building, { folder: "/w", state: "building", job: "job_1" });
    expect(grown.log).toBe("npm ci");
    const failed = mergeAppCard(grown, { folder: "/w", state: "failed", error: "boom" });
    expect(failed.log).toBe("npm ci");
    const ran = mergeAppCard(failed, { folder: "/w", state: "installed", key: "x", release: 1 });
    expect(ran.log).toBeUndefined();
  });
});
