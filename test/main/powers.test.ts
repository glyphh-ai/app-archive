import { describe, it, expect } from "vitest";
import { POWERS, powerById, powerOfChat, powerChatId, modelsForPower, pickPowerModel, safeSaveName } from "../../src/shared/powers.js";

describe("Glyphh's powers (his order, 2026-10-09: powers are singular things)", () => {
  it("are Images, Video and Audio, each owning one tool and a mascot", () => {
    expect(POWERS.map((p) => p.id)).toEqual(["images", "video", "audio"]);
    expect(POWERS.map((p) => p.tool)).toEqual(["image_generate", "video_generate", "audio_generate"]);
    for (const p of POWERS) { expect(p.brief.length).toBeGreaterThan(40); expect(p.avatar.color).toMatch(/^#/); }
  });

  it("each power talks in its own thread, powers/<id>", () => {
    expect(powerChatId("images")).toBe("powers/images");
    expect(powerOfChat("powers/video")?.name).toBe("Video");
    expect(powerOfChat("bots/shine")).toBeNull();
    expect(powerOfChat("powers/nope")).toBeNull();
    expect(powerById("audio")?.tool).toBe("audio_generate");
  });

  it("finds a power's models in the catalog by modality, in order, once each", () => {
    const catalog = [
      { id: "openai::gpt-image-1", modality: "image" }, { id: "openai::gpt-5", modality: "chat" },
      { id: "google::imagen-4", modality: "image_generation" }, { id: "runway::gen4", modality: "video" },
      { id: "openai::gpt-image-1", modality: "image" },
    ];
    expect(modelsForPower(powerById("images")!, catalog)).toEqual(["openai::gpt-image-1", "google::imagen-4"]);
    expect(modelsForPower(powerById("video")!, catalog)).toEqual(["runway::gen4"]);
    expect(modelsForPower(powerById("audio")!, catalog)).toEqual([]);
  });

  it("runs on the model asked for when the power has it, else its first", () => {
    const models = ["openai::gpt-image-1", "google::imagen-4"];
    expect(pickPowerModel(models, "imagen-4")).toBe("google::imagen-4");
    expect(pickPowerModel(models, "google::imagen-4")).toBe("google::imagen-4");
    expect(pickPowerModel(models, "flux")).toBe("openai::gpt-image-1");
    expect(pickPowerModel(models)).toBe("openai::gpt-image-1");
    expect(pickPowerModel([], "x")).toBeNull();
  });

  it("writes only inside the member's folder", () => {
    expect(safeSaveName("brand/hero.png")).toBe("brand/hero.png");
    for (const bad of ["", "../etc/passwd", "/abs.png", "a/../../b", "c:\\x.png", "x?.png"]) expect(safeSaveName(bad)).toBeNull();
  });
});
