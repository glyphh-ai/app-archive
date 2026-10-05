/**
 * app-data-rules.test.ts — WHERE AN APP'S DATA LIVES (his verdict,
 * 2026-10-05: the author declares `data` in the manifest; the user never
 * picks; "Local is local, cloud is cloud"). The badge, the install route by
 * data and desktop presence, the disabled line, the web's lines for a local
 * app, the Apps page's marks and the Move-to-the-cloud rule.
 */
import { describe, expect, it } from "vitest";
import {
  APP_LOCUS_TITLE, LOCAL_APP_DESKTOP_OFFLINE, LOCAL_APP_RUNS_ON_DESKTOP, LOCAL_NEEDS_DESKTOP_LINE,
  appDataBadge, appDataOf, appLocusOf, installButton, installRoute, isLocalAppAnswer, keepsLocalData, localAppWebLine,
} from "../../src/renderer/help/app-data-rules.js";

describe("appDataOf — the manifest's word, read off whatever carries it", () => {
  it("defaults to cloud; local and per-home are the only other words", () => {
    expect(appDataOf(null)).toBe("cloud");
    expect(appDataOf({})).toBe("cloud");
    expect(appDataOf({ data: "cloud" })).toBe("cloud");
    expect(appDataOf({ data: "local" })).toBe("local");
    expect(appDataOf({ data: "per-home" })).toBe("per-home");
    expect(appDataOf({ data: "LOCAL" })).toBe("cloud");
    expect(appDataOf({ data: 42 })).toBe("cloud");
  });
  it("reads a hub row's manifest and a tab's launchConfig when the row itself says nothing", () => {
    expect(appDataOf({ manifest: { data: "local" } })).toBe("local");
    expect(appDataOf({ launchConfig: { data: "per-home" } })).toBe("per-home");
    expect(appDataOf({ data: "local", manifest: { data: "cloud" } })).toBe("local");
  });
  it("keepsLocalData: local and per-home keep a store on the machine", () => {
    expect(keepsLocalData("cloud")).toBe(false);
    expect(keepsLocalData("local")).toBe(true);
    expect(keepsLocalData("per-home")).toBe(true);
  });
});

describe("the badge — a badge of honor for local data", () => {
  it("Local data / Local + cloud / nothing", () => {
    expect(appDataBadge("local")).toMatchObject({ label: "Local data" });
    expect(appDataBadge("per-home")).toMatchObject({ label: "Local + cloud" });
    expect(appDataBadge("cloud")).toBeNull();
  });
});

describe("installRoute — routed by data, the user never asked", () => {
  it("cloud installs as a cloud instance everywhere, desktop or not", () => {
    for (const surface of ["web", "desktop"] as const) for (const attached of [true, false]) {
      expect(installRoute("cloud", surface, attached)).toEqual({ cloud: true, local: null });
    }
  });
  it("local: the desktop's own host; the web only through a connected desktop, else disabled with the line", () => {
    expect(installRoute("local", "desktop", false)).toEqual({ cloud: false, local: "host" });
    expect(installRoute("local", "web", true)).toEqual({ cloud: false, local: "relay" });
    expect(installRoute("local", "web", false)).toEqual({ cloud: false, local: null, disabled: LOCAL_NEEDS_DESKTOP_LINE });
    expect(LOCAL_NEEDS_DESKTOP_LINE).toBe("Local data — installs on your desktop; connect it to install from here");
  });
  it("per-home: both on the desktop; on the web the cloud plus the desktop when connected, the cloud alone otherwise — never an error", () => {
    expect(installRoute("per-home", "desktop", false)).toEqual({ cloud: true, local: "host" });
    expect(installRoute("per-home", "web", true)).toEqual({ cloud: true, local: "relay" });
    expect(installRoute("per-home", "web", false)).toEqual({ cloud: true, local: null });
  });
});

describe("installButton — the button's face", () => {
  it("installed wins; a disabled route is the desktop line; otherwise Add with where it goes", () => {
    expect(installButton(installRoute("local", "web", false), true, true)).toEqual({ label: "Added", disabled: true, title: "Already in your apps" });
    expect(installButton(installRoute("local", "web", false), false, true)).toEqual({ label: "Installs on your desktop", disabled: true, title: LOCAL_NEEDS_DESKTOP_LINE });
    expect(installButton(installRoute("local", "web", false), false, false)).toMatchObject({ label: "Desktop", disabled: true });
    expect(installButton(installRoute("cloud", "web", false), false, true)).toEqual({ label: "Add", disabled: false, title: "Install in the cloud" });
    expect(installButton(installRoute("local", "web", true), false, false)).toEqual({ label: "+", disabled: false, title: "Install on your desktop" });
    expect(installButton(installRoute("per-home", "web", true), false, true).title).toBe("Install in the cloud and on your desktop");
    expect(installButton(installRoute("per-home", "desktop", false), false, true).title).toBe("Install here and in the cloud");
    expect(installButton(installRoute("local", "desktop", false), false, true).title).toBe("Install on this machine");
  });
});

describe("a local app on the web", () => {
  it("says it runs on the Mac, or that the Mac is offline", () => {
    expect(localAppWebLine(true)).toBe(LOCAL_APP_RUNS_ON_DESKTOP);
    expect(localAppWebLine(false)).toBe(LOCAL_APP_DESKTOP_OFFLINE);
    expect(LOCAL_APP_RUNS_ON_DESKTOP).toBe("Runs on your Mac — open Glyphh Desktop");
    expect(LOCAL_APP_DESKTOP_OFFLINE).toBe("your Mac is offline");
  });
  it("isLocalAppAnswer flags the shim's answer and nothing else", () => {
    expect(isLocalAppAnswer({ ok: false, localApp: true, error: "x" })).toBe(true);
    expect(isLocalAppAnswer({ ok: false, error: "x" })).toBe(false);
    expect(isLocalAppAnswer({ ok: true })).toBe(false);
    expect(isLocalAppAnswer(null)).toBe(false);
  });
});

describe("the Apps page", () => {
  it("appLocusOf: an instance card is the cloud; a local or per-home folder is the desktop; a stated locus wins", () => {
    expect(appLocusOf({ id: "app-instance:notes~u1" })).toBe("cloud");
    expect(appLocusOf({ id: "app:notes", data: "local" })).toBe("local");
    expect(appLocusOf({ id: "app:notes", data: "per-home" })).toBe("local");
    expect(appLocusOf({ id: "app:notes" })).toBe("cloud");
    expect(appLocusOf({ id: "app:notes", locus: "cloud", data: "local" })).toBe("cloud");
    expect(APP_LOCUS_TITLE).toEqual({ cloud: "Data in the cloud", local: "Data on this desktop" });
  });
});
