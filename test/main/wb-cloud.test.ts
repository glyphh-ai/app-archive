/**
 * wb-cloud.test.ts — the desktop's routed workbench bridge (help/wb-cloud.ts):
 * a LOCAL session's Files / Diff / Editor calls go to the machine's wb and
 * never touch the cloud lane; a CLOUD session's go to the lane scoped to the
 * session; the verbs the pod does not serve say so in one line; a session
 * switch re-binds the live watchers and re-roots the workbench onto the new
 * far side; and the cloud wb's poll maps the pod's events onto the panels'
 * file / git / cwd signals — the web's wb-pod pipeline, on the desktop.
 */
import { describe, expect, it, vi } from "vitest";
import { CLOUD_FS_NOT_YET, CLOUD_FS_NO_MKDIR, type PanelFsRoute } from "../../src/renderer/help/panel-fs-route";
import { WB_LOCUS_EVENT, createCloudWb, createWbRouter, type CloudFsLaneApi, type PanelWb } from "../../src/renderer/help/wb-cloud";

function fakeLane(): CloudFsLaneApi & { calls: Record<string, ReturnType<typeof vi.fn>> } {
  const calls = {
    cloudFsInfo: vi.fn(async (scope: string) => ({ root: `/ws/${scope}`, isRepo: true, branch: "main" })),
    cloudFsList: vi.fn(async (scope: string, dir?: string) => ({ entries: [{ name: "a.ts", path: `${dir ?? `/ws/${scope}`}/a.ts`, kind: "file" }] })),
    cloudFsRead: vi.fn(async () => ({ content: "cloud text" })),
    cloudFsWrite: vi.fn(async () => ({ ok: true })),
    cloudFsSearch: vi.fn(async () => ({ entries: [] })),
    cloudFsEvents: vi.fn(async (scope: string) => ({ seq: 1, root: `/ws/${scope}`, events: [] })),
    cloudGitInfo: vi.fn(async () => ({ isRepo: true, branch: "feature" })),
    cloudGitDiff: vi.fn(async () => ({ text: "diff --git a/a b/a\n" })),
  };
  return { ...calls, calls };
}

/** The machine's wb (the preload) as a spy: every call is recorded, nothing is read. */
function fakeLocal(): PanelWb & { calls: Record<string, ReturnType<typeof vi.fn>>; fire: { file: (p: string) => void; git: () => void; cwd: (c: string) => void } } {
  const fileSubs = new Set<(p: string) => void>();
  const gitSubs = new Set<() => void>();
  const cwdSubs = new Set<(c: string | null) => void>();
  const calls = {
    getCwd: vi.fn(async () => "/Users/me/app"),
    setCwd: vi.fn(async (d: string) => d),
    getCwdRecents: vi.fn(async () => ["/Users/me/app"]),
    pickCwd: vi.fn(async () => null),
    pickFile: vi.fn(async () => null),
    gitInfo: vi.fn(async () => ({ isRepo: true, branch: "local-branch" })),
    listDir: vi.fn(async (dir: string) => ({ entries: [{ name: "local.ts", path: `${dir}/local.ts`, kind: "file" }] })),
    searchFiles: vi.fn(async () => ({ entries: [] })),
    readFile: vi.fn(async () => ({ content: "local text" })),
    writeFile: vi.fn(async () => ({ ok: true })),
    gitDiff: vi.fn(async () => ({ text: "local diff" })),
    mkdir: vi.fn(async () => ({ ok: true })),
    deletePath: vi.fn(async () => ({ ok: true })),
    renamePath: vi.fn(async () => ({ ok: true })),
    previewNative: vi.fn(async () => ({ ok: true, method: "quicklook" })),
    convertPreview: vi.fn(async () => ({ pdfPath: "/tmp/x.pdf" })),
    onCwdChanged: vi.fn((cb: (c: string | null) => void) => { cwdSubs.add(cb); return () => { cwdSubs.delete(cb); }; }),
    onFileChanged: vi.fn((cb: (p: string) => void) => { fileSubs.add(cb); return () => { fileSubs.delete(cb); }; }),
    onGitChanged: vi.fn((cb: () => void) => { gitSubs.add(cb); return () => { gitSubs.delete(cb); }; }),
  };
  return {
    ...calls,
    calls,
    fire: {
      file: (p) => { for (const cb of fileSubs) cb(p); },
      git: () => { for (const cb of gitSubs) cb(); },
      cwd: (c) => { for (const cb of cwdSubs) cb(c); },
    },
  };
}

/** A bare event target standing in for window. */
function fakeTarget() {
  const subs = new Map<string, Array<() => void>>();
  return {
    addEventListener(type: string, cb: () => void) { subs.set(type, [...(subs.get(type) ?? []), cb]); },
    dispatch(type: string) { for (const cb of subs.get(type) ?? []) cb(); },
  };
}

function setup(initial: PanelFsRoute) {
  let route = initial;
  const lane = fakeLane();
  const local = fakeLocal();
  const target = fakeTarget();
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const cloud = createCloudWb({
    lane,
    getScope: () => (route.route === "cloud" ? route.scope : ""),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => undefined,
  });
  const wb = createWbRouter<PanelWb>({ local, cloud, route: () => route, target });
  const switchTo = (r: PanelFsRoute): void => { route = r; target.dispatch(WB_LOCUS_EVENT); };
  const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  return { wb, lane, local, cloud, switchTo, timers, flush };
}

const noLaneCall = (lane: ReturnType<typeof fakeLane>): void => {
  for (const [name, fn] of Object.entries(lane.calls)) expect(fn, name).not.toHaveBeenCalled();
};

describe("a local session never hits the cloud lane", () => {
  it("every panel verb goes to the machine's wb", async () => {
    const { wb, lane, local } = setup({ route: "local" });
    expect(await wb.getCwd()).toBe("/Users/me/app");
    expect((await wb.listDir("/Users/me/app")).entries[0].name).toBe("local.ts");
    expect(await wb.readFile("/Users/me/app/a.ts")).toEqual({ content: "local text" });
    expect(await wb.writeFile("/Users/me/app/a.ts", "x")).toEqual({ ok: true });
    expect(await wb.gitDiff("/Users/me/app")).toEqual({ text: "local diff" });
    expect(await wb.gitInfo("/Users/me/app")).toEqual({ isRepo: true, branch: "local-branch" });
    expect(await wb.searchFiles("/Users/me/app", "a")).toEqual({ entries: [] });
    expect(await wb.mkdir("/Users/me/app/d")).toEqual({ ok: true });
    expect(await wb.deletePath("/Users/me/app/d")).toEqual({ ok: true });
    expect(await wb.renamePath("/a", "/b")).toEqual({ ok: true });
    expect(await wb.previewNative("/a")).toEqual({ ok: true, method: "quicklook" });
    expect(local.calls.writeFile).toHaveBeenCalledWith("/Users/me/app/a.ts", "x");
    noLaneCall(lane);
  });
  it("the watchers are the machine's, and its signals pass through", () => {
    const { wb, lane, local } = setup({ route: "local" });
    const files: string[] = []; let gits = 0; const cwds: Array<string | null> = [];
    wb.onFileChanged((p) => files.push(p));
    wb.onGitChanged!(() => { gits += 1; });
    wb.onCwdChanged((c) => cwds.push(c));
    local.fire.file("/Users/me/app/a.ts"); local.fire.git(); local.fire.cwd("/Users/me/other");
    expect(files).toEqual(["/Users/me/app/a.ts"]);
    expect(gits).toBe(1);
    expect(cwds).toEqual(["/Users/me/other"]);
    noLaneCall(lane);
  });
  it("the web's relay route is 'not cloud' here too", async () => {
    const { wb, lane } = setup({ route: "relay-desktop" });
    expect(await wb.getCwd()).toBe("/Users/me/app");
    noLaneCall(lane);
  });
});

describe("a cloud session's panels read its workspace, scoped to the session", () => {
  it("getCwd is the pod root; list / read / write / diff / git info carry the scope", async () => {
    const { wb, lane, local } = setup({ route: "cloud", scope: "th-1" });
    expect(await wb.getCwd()).toBe("/ws/th-1");
    expect(lane.calls.cloudFsInfo).toHaveBeenCalledWith("th-1");
    expect((await wb.listDir("/ws/th-1")).entries[0].name).toBe("a.ts");
    expect(lane.calls.cloudFsList).toHaveBeenCalledWith("th-1", "/ws/th-1");
    expect(await wb.readFile("/ws/th-1/a.ts")).toEqual({ content: "cloud text" });
    expect(lane.calls.cloudFsRead).toHaveBeenCalledWith("th-1", "/ws/th-1/a.ts");
    expect(await wb.writeFile("/ws/th-1/a.ts", "edited")).toEqual({ ok: true });
    expect(lane.calls.cloudFsWrite).toHaveBeenCalledWith("th-1", "/ws/th-1/a.ts", "edited");
    expect(await wb.gitDiff("/ws/th-1")).toEqual({ text: "diff --git a/a b/a\n" });
    expect(lane.calls.cloudGitDiff).toHaveBeenCalledWith("th-1");
    expect(await wb.gitInfo("/ws/th-1")).toEqual({ isRepo: true, branch: "feature" });
    expect(lane.calls.cloudGitInfo).toHaveBeenCalledWith("th-1");
    await wb.searchFiles("/ws/th-1", "a");
    expect(lane.calls.cloudFsSearch).toHaveBeenCalledWith("th-1", "a");
    for (const [name, fn] of Object.entries(local.calls)) expect(fn, name).not.toHaveBeenCalled();
  });
  it("a re-entered space is scoped to the space, not the thread", async () => {
    const { wb, lane } = setup({ route: "cloud", scope: "th-space" });
    await wb.readFile("/ws/th-space/a.ts");
    expect(lane.calls.cloudFsRead).toHaveBeenCalledWith("th-space", "/ws/th-space/a.ts");
  });
  it("the pod root is asked once per scope", async () => {
    const { wb, lane } = setup({ route: "cloud", scope: "th-1" });
    await wb.getCwd(); await wb.getCwd(); await wb.getCwdExplicit!();
    expect(lane.calls.cloudFsInfo).toHaveBeenCalledTimes(1);
  });
  it("what the pod does not serve says so in one line — never local data", async () => {
    const { wb, local } = setup({ route: "cloud", scope: "th-1" });
    expect(await wb.mkdir("/ws/th-1/d")).toEqual({ ok: false, error: CLOUD_FS_NO_MKDIR });
    expect(await wb.deletePath("/ws/th-1/a.ts")).toEqual({ ok: false, error: CLOUD_FS_NOT_YET });
    expect(await wb.renamePath("/ws/th-1/a.ts", "/ws/th-1/b.ts")).toEqual({ ok: false, error: CLOUD_FS_NOT_YET });
    expect(await wb.previewNative("/ws/th-1/a.ts")).toEqual({ ok: false, error: CLOUD_FS_NOT_YET });
    expect(await wb.convertPreview("/ws/th-1/a.pptx")).toEqual({ error: "no-converter" });
    expect(await wb.pickCwd()).toBeNull();
    expect(await wb.pickFile()).toBeNull();
    expect(await wb.getCwdRecents()).toEqual([]);
    expect(local.calls.mkdir).not.toHaveBeenCalled();
    expect(local.calls.deletePath).not.toHaveBeenCalled();
    expect(local.calls.renamePath).not.toHaveBeenCalled();
  });
  it("a lane failure rides in the shape", async () => {
    const { wb, lane } = setup({ route: "cloud", scope: "th-1" });
    lane.calls.cloudFsRead.mockRejectedValueOnce(new Error("503 worker_unavailable"));
    expect(await wb.readFile("/ws/th-1/a.ts")).toEqual({ content: "", error: "503 worker_unavailable" });
    lane.calls.cloudFsInfo.mockResolvedValueOnce({ root: "", error: "signed out" });
    expect(await createCloudWb({ lane, getScope: () => "th-x" }).getCwd()).toBe("");
  });
});

describe("the cloud wb's poll maps the pod's events onto the panels", () => {
  it("file-changed → onFileChanged, git-changed → onGitChanged, a new root → onCwdChanged", async () => {
    const { cloud, lane, timers, flush } = setup({ route: "cloud", scope: "th-1" });
    lane.calls.cloudFsEvents.mockResolvedValueOnce({ seq: 4, root: "/ws/th-1", events: [{ type: "file-changed", path: "/ws/th-1/a.ts" }, { type: "git-changed" }] });
    const files: string[] = []; let gits = 0; const cwds: string[] = [];
    cloud.onFileChanged((p) => files.push(p));
    cloud.onGitChanged!(() => { gits += 1; });
    cloud.onCwdChanged((c) => cwds.push(c as string));
    await flush();
    expect(lane.calls.cloudFsEvents).toHaveBeenCalledWith("th-1", -1);
    expect(files).toEqual(["/ws/th-1/a.ts"]);
    expect(gits).toBe(1);
    expect(cwds).toEqual(["/ws/th-1"]);
    expect(timers[timers.length - 1].ms).toBe(2000);
    // The next poll rides the cursor the pod returned.
    timers[timers.length - 1].fn();
    await flush();
    expect(lane.calls.cloudFsEvents).toHaveBeenLastCalledWith("th-1", 4);
  });
  it("a pod that cannot be reached is retried quietly", async () => {
    const { cloud, lane, timers, flush } = setup({ route: "cloud", scope: "th-1" });
    lane.calls.cloudFsEvents.mockRejectedValueOnce(new Error("asleep"));
    cloud.onFileChanged(() => undefined);
    await flush();
    expect(timers[timers.length - 1].ms).toBe(6000);
  });
});

describe("a session switch re-routes the live panels", () => {
  it("local → cloud re-binds the watchers to the lane and re-roots onto the pod root", async () => {
    const { wb, lane, local, switchTo, flush } = setup({ route: "local" });
    const cwds: Array<string | null> = []; const files: string[] = [];
    wb.onCwdChanged((c) => cwds.push(c));
    wb.onFileChanged((p) => files.push(p));
    expect(local.calls.onFileChanged).toHaveBeenCalledTimes(1);
    switchTo({ route: "cloud", scope: "th-1" });
    await flush();
    expect(cwds).toEqual(["/ws/th-1"]);                   // the workbench re-roots in place
    expect(lane.calls.cloudFsEvents).toHaveBeenCalled();  // the lane's poll is live
    local.fire.file("/Users/me/app/a.ts");                // the machine's watcher is unbound
    expect(files).toEqual([]);
    expect(await wb.readFile("/ws/th-1/a.ts")).toEqual({ content: "cloud text" });
  });
  it("cloud → local re-binds to the machine, re-roots onto its folder, and asks nothing of the lane after", async () => {
    const { wb, lane, local, switchTo, flush } = setup({ route: "cloud", scope: "th-1" });
    const files: string[] = []; const cwds: Array<string | null> = [];
    wb.onFileChanged((p) => files.push(p));
    wb.onCwdChanged((c) => cwds.push(c));
    await flush();
    const before = lane.calls.cloudFsEvents.mock.calls.length;
    switchTo({ route: "local" });
    await flush();
    expect(cwds[cwds.length - 1]).toBe("/Users/me/app");  // the machine's folder, even if main never re-broadcast it
    local.fire.file("/Users/me/app/b.ts");
    expect(files).toEqual(["/Users/me/app/b.ts"]);
    expect(await wb.gitDiff("/Users/me/app")).toEqual({ text: "local diff" });
    expect(lane.calls.cloudGitDiff).not.toHaveBeenCalled();
    expect(lane.calls.cloudFsEvents.mock.calls.length).toBe(before);
  });
  it("cloud A → cloud B re-roots onto B's workspace", async () => {
    const { wb, lane, switchTo, flush } = setup({ route: "cloud", scope: "th-a" });
    const cwds: Array<string | null> = [];
    wb.onCwdChanged((c) => cwds.push(c));
    await flush();
    switchTo({ route: "cloud", scope: "th-b" });
    await flush();
    expect(cwds).toContain("/ws/th-b");
    await wb.readFile("/ws/th-b/x");
    expect(lane.calls.cloudFsRead).toHaveBeenLastCalledWith("th-b", "/ws/th-b/x");
  });
  it("the same locus announced twice does nothing", async () => {
    const { wb, local, switchTo, flush } = setup({ route: "local" });
    wb.onFileChanged(() => undefined);
    switchTo({ route: "local" });
    await flush();
    expect(local.calls.onFileChanged).toHaveBeenCalledTimes(1);
  });
  it("with no live panel a switch binds nothing", async () => {
    const { lane, local, switchTo, flush } = setup({ route: "local" });
    switchTo({ route: "cloud", scope: "th-1" });
    await flush();
    expect(local.calls.onFileChanged).not.toHaveBeenCalled();
    noLaneCall(lane);
  });
});
