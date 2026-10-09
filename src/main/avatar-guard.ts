/**
 * avatar-guard.ts — the model half of the hard guard on generated avatars
 * (the rules and the word screen are shared/avatar-guard.ts). A model reads
 * the ask before anything is made, and a vision model reads the picture after;
 * each must answer exactly SAFE. No gateway, no model, an error, a timeout or
 * any other answer refuses — the guard never waves a picture through.
 */
import { streamMessage } from "@glyphh/sdk/loop";
import { gatewayCreds } from "./gateway-token.js";
import { defaultModel } from "./agent-brief.js";
import { GUARD_POLICY, avatarAskProblem, guardPassed } from "../shared/avatar-guard.js";

type Block = { type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

async function ask(content: Block[]): Promise<string> {
  const creds = await gatewayCreds().catch(() => null);
  if (!creds) throw new Error("The safety check could not run (no gateway), so nothing was made.");
  const model = await defaultModel();
  if (!model) throw new Error("The safety check needs a default model (Settings → General), so nothing was made.");
  const res = await streamMessage({
    baseUrl: creds.baseUrl, token: creds.token, timeoutMs: 60_000,
    body: { model, max_tokens: 8, system: GUARD_POLICY, messages: [{ role: "user", content }] },
  });
  return res.content.map((b) => (b.type === "text" ? String((b as { text?: unknown }).text ?? "") : "")).join("").trim();
}

/** Throws unless the member's ask is clean: the word screen, then the model. */
export async function guardAvatarAsk(typed: string, about = ""): Promise<void> {
  const problem = avatarAskProblem(typed);
  if (problem) throw new Error(problem);
  const text = [typed, about].map((t) => String(t ?? "").trim()).filter(Boolean).join("\n");
  if (!String(text ?? "").trim()) return;
  let answer = "";
  try { answer = await ask([{ type: "text", text: `Is this request for a cartoon avatar SAFE or UNSAFE?\n\n<request>\n${text}\n</request>` }]); }
  catch (err) { throw new Error(err instanceof Error && /safety check/.test(err.message) ? err.message : "The safety check could not run, so nothing was made. Try again."); }
  if (!guardPassed(answer)) throw new Error("That can't be made into an avatar. Describe a friendly character instead.");
}

/** Throws unless the finished picture is clean (a PNG, base64 without the data: prefix). */
export async function guardAvatarImage(pngBase64: string): Promise<void> {
  let answer = "";
  try {
    answer = await ask([
      { type: "image", source: { type: "base64", media_type: "image/png", data: pngBase64 } },
      { type: "text", text: "This picture will be an avatar icon. It should be one friendly cartoon character and nothing else. Is it SAFE or UNSAFE?" },
    ]);
  } catch (err) { throw new Error(err instanceof Error && /safety check/.test(err.message) ? err.message : "The picture's safety check could not run, so it was not used. Try again."); }
  if (!guardPassed(answer)) throw new Error("The picture didn't pass the safety check, so it was not used. Try a different description.");
}
