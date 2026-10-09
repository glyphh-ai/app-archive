/**
 * model-info.ts — how a model reads in the powers modal (his order,
 * 2026-10-09: "each model needs a type (from litellm) and a description from
 * the server… a details page… the information about the model, pricing,
 * etc. When the model is added there should be a cap field… no limit or a
 * dollar amount"). Pure: the modal and the super power page both use it.
 */

/** One model as the server's catalog publishes it (desktop.py catalog_rows). */
export interface CatalogModel {
  name: string;
  providerSlug?: string;
  modality?: string;
  description?: string;
  prices?: Record<string, number>;
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  reasoning?: boolean;
  autoRouter?: boolean;
  utility?: boolean;
  active?: boolean;
}

/** LiteLLM's mode word, as people say it. */
const TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  chat: "Chat", responses: "Chat", completion: "Text",
  embedding: "Embedding", rerank: "Rerank", moderation: "Moderation",
  image_generation: "Image", image_edit: "Image editing",
  audio_transcription: "Speech to text", audio_speech: "Text to speech",
  video_generation: "Video", search: "Search", ocr: "OCR",
});
export function modelTypeLabel(modality: string | undefined): string {
  const m = String(modality ?? "").trim();
  if (!m) return "Chat";
  return TYPE_LABELS[m] ?? m.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
/** A model a super power can run on (the loop speaks chat). */
export const isChatModel = (m: Pick<CatalogModel, "modality"> | undefined): boolean => !m?.modality || m.modality === "chat";

/** Dollars, as few digits as the amount needs ($3, $0.15, $0.0004). */
export function usd(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n === 0) return "$0";
  const digits = n >= 1 ? 2 : n >= 0.01 ? 3 : 4;
  return `$${Number(n.toFixed(digits)).toString()}`;
}

/** 200000 → "200K", 1048576 → "1M". */
export function tokensShort(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n)) return "";
  if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0))}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/** The price file's rate names, said plainly, with the unit each is quoted in. */
const RATE: ReadonlyArray<{ key: string; label: string; per: number; unit: string }> = Object.freeze([
  { key: "input_cost_per_token", label: "Input", per: 1_000_000, unit: "1M tokens" },
  { key: "output_cost_per_token", label: "Output", per: 1_000_000, unit: "1M tokens" },
  { key: "cache_read_input_token_cost", label: "Cached input", per: 1_000_000, unit: "1M tokens" },
  { key: "cache_creation_input_token_cost", label: "Cache write", per: 1_000_000, unit: "1M tokens" },
  { key: "output_cost_per_reasoning_token", label: "Reasoning", per: 1_000_000, unit: "1M tokens" },
  { key: "input_cost_per_audio_token", label: "Audio input", per: 1_000_000, unit: "1M tokens" },
  { key: "output_cost_per_audio_token", label: "Audio output", per: 1_000_000, unit: "1M tokens" },
  { key: "output_cost_per_image", label: "Per image", per: 1, unit: "image" },
  { key: "input_cost_per_image", label: "Image input", per: 1, unit: "image" },
  { key: "input_cost_per_second", label: "Input audio", per: 60, unit: "minute" },
  { key: "output_cost_per_second", label: "Output", per: 1, unit: "second" },
  { key: "input_cost_per_character", label: "Input", per: 1000, unit: "1K characters" },
  { key: "output_cost_per_character", label: "Output", per: 1000, unit: "1K characters" },
  { key: "output_cost_per_video_per_second", label: "Video", per: 1, unit: "second" },
  { key: "search_context_cost_per_query", label: "Per search", per: 1, unit: "query" },
]);

/** The rates a model is billed at, each as a line: "Input · $3 / 1M tokens". */
export function priceLines(m: CatalogModel): Array<{ label: string; value: string }> {
  const prices = m.prices && Object.keys(m.prices).length ? m.prices : {
    ...(m.inputUsdPerMTok ? { input_cost_per_token: m.inputUsdPerMTok / 1_000_000 } : {}),
    ...(m.outputUsdPerMTok ? { output_cost_per_token: m.outputUsdPerMTok / 1_000_000 } : {}),
  };
  const out: Array<{ label: string; value: string }> = [];
  const known = new Set<string>();
  for (const r of RATE) {
    const v = prices[r.key];
    if (typeof v !== "number" || v <= 0) continue;
    known.add(r.key);
    out.push({ label: r.label, value: `${usd(v * r.per)} / ${r.unit}` });
  }
  // A rate this page has no words for still shows, in the price file's words.
  for (const [k, v] of Object.entries(prices)) {
    if (known.has(k) || typeof v !== "number" || v <= 0) continue;
    if (/_above_\d+/.test(k)) continue;   // tiered long-context rates: the base rate says enough
    out.push({ label: k.replace(/_/g, " "), value: usd(v) });
  }
  return out;
}

/** A monthly cap as stored: a positive dollar amount, two decimals, or null (no limit). */
export function parseCap(raw: string): number | null {
  const n = Math.round(Number(String(raw ?? "").replace(/[$,\s]/g, "")) * 100) / 100;
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function capText(cap: number | null | undefined): string {
  return cap && cap > 0 ? `${usd(cap)}/month cap` : "No limit";
}
