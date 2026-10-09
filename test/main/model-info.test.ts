/**
 * model-info.test.ts — a model in the powers modal (his order, 2026-10-09):
 * its type, its pricing lines, and the monthly cap a super power holds it to.
 */
import { describe, expect, it } from "vitest";
import { capText, isChatModel, modelTypeLabel, parseCap, priceLines, tokensShort, usd } from "../../src/renderer/help/model-info.js";
import { cleanModelCaps } from "../../src/shared/member-library.js";

describe("a model's type", () => {
  it("says LiteLLM's mode word plainly", () => {
    expect(modelTypeLabel("chat")).toBe("Chat");
    expect(modelTypeLabel("image_generation")).toBe("Image");
    expect(modelTypeLabel("audio_speech")).toBe("Text to speech");
    expect(modelTypeLabel(undefined)).toBe("Chat");
    expect(modelTypeLabel("brand_new_mode")).toBe("Brand new mode");
    expect(isChatModel({ modality: "chat" })).toBe(true);
    expect(isChatModel({ modality: "image_generation" })).toBe(false);
  });
});

describe("pricing", () => {
  it("reads every rate in its own unit", () => {
    expect(priceLines({ name: "m", prices: { input_cost_per_token: 3e-6, output_cost_per_token: 1.5e-5, cache_read_input_token_cost: 3e-7 } })).toEqual([
      { label: "Input", value: "$3 / 1M tokens" },
      { label: "Output", value: "$15 / 1M tokens" },
      { label: "Cached input", value: "$0.3 / 1M tokens" },
    ]);
    expect(priceLines({ name: "img", prices: { output_cost_per_image: 0.04 } })).toEqual([{ label: "Per image", value: "$0.04 / image" }]);
    expect(priceLines({ name: "m", inputUsdPerMTok: 1, outputUsdPerMTok: 2 })).toEqual([
      { label: "Input", value: "$1 / 1M tokens" }, { label: "Output", value: "$2 / 1M tokens" },
    ]);
    expect(priceLines({ name: "m", prices: { input_cost_per_token_above_200k_tokens: 6e-6, input_cost_per_token: 3e-6 } })).toEqual([{ label: "Input", value: "$3 / 1M tokens" }]);
    expect(priceLines({ name: "m" })).toEqual([]);
  });
  it("writes dollars and token counts short", () => {
    expect(usd(3)).toBe("$3");
    expect(usd(0.15)).toBe("$0.15");
    expect(usd(0.0004)).toBe("$0.0004");
    expect(tokensShort(200000)).toBe("200K");
    expect(tokensShort(1000000)).toBe("1M");
    expect(tokensShort(null)).toBe("");
  });
});

describe("the monthly cap", () => {
  it("is a positive dollar amount or no limit", () => {
    expect(parseCap("20")).toBe(20);
    expect(parseCap("$1,250.505")).toBe(1250.51);
    expect(parseCap("0")).toBeNull();
    expect(parseCap("-5")).toBeNull();
    expect(parseCap("abc")).toBeNull();
    expect(capText(20)).toBe("$20/month cap");
    expect(capText(null)).toBe("No limit");
  });
  it("is stored per model, positive dollars only", () => {
    expect(cleanModelCaps({ m1: 20, m2: "5.555", m3: 0, m4: -1, " ": 3, m5: "x" })).toEqual({ m1: 20, m2: 5.56 });
    expect(cleanModelCaps(null)).toEqual({});
    expect(cleanModelCaps([1, 2])).toEqual({});
  });
});
