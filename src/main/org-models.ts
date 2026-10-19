/**
 * org-models — WHAT MODEL A TURN RUNS ON, and the name to send.
 *
 * The user's own providers and models (providers.ts) are the whole answer: a
 * turn that named a model runs on it, one that named none runs on the default
 * chat model. The name sent is the model's full id (`<provider>::<model>`),
 * which the router (@glyphh/sdk/router) resolves to the provider that serves it.
 */
import { defaultModel, hasChatModel } from "./providers.js";

/** A picked model as the router takes it: the stored id, quotes and spaces trimmed. */
export const modelRef = (model: string): string => model.replace(/"/g, "").trim();

/** Can a turn run at all? Yes once a chat model has a provider that can be called. */
export function modelsAvailable(): boolean { return hasChatModel(); }

/** What the renderers are told when any of it moves (model-watch.ts). */
export function orgModelState(): { gatewayOn: boolean; defaultModel: string; connectionsOn: boolean; hasPlan: boolean } {
  return { gatewayOn: modelsAvailable(), defaultModel: defaultChatModel(), connectionsOn: false, hasPlan: true };
}

/** The model a turn runs on when it named none. */
export function defaultChatModel(): string { return defaultModel("chat"); }

/** The server's connections lane does not exist locally. */
export function connectionsAvailable(): boolean { return false; }
