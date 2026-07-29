import { PluginConfig } from "./config";

/**
 * Settings a registered LLM provider factory needs - a subset of `PluginConfig`, shared with the
 * built-in providers in `./llmGateway.ts`.
 */
export type LlmSettings = Pick<PluginConfig, "llmProvider" | "llmApiKey" | "llmModel" | "llmBaseUrl">;

/** Vercel AI SDK's own `LanguageModel` type, loosened to `unknown` here to avoid a hard dependency on `ai`'s types in this always-loaded module - see `./llmGateway.ts`'s `loadOptional`. */
export type LlmModel = unknown;

/** Builds a Vercel AI SDK model handle for one custom provider name - see `registerLlmProvider`. */
export type LlmProviderFactory = (settings: LlmSettings) => LlmModel;

const providers = new Map<string, LlmProviderFactory>();

/**
 * Public extension point mirroring the core `signalk-einklabel-plugin`'s own `registerVendorDriver`/
 * `registerTemplateProvider` pattern, one level down: this plugin already bundles support for several
 * providers (`./llmGateway.ts`'s built-in switch: openai/anthropic/google/xai/deepseek/moonshotai/
 * ollama/local) as `optionalDependencies`, but someone wanting a provider not in that list (a bespoke
 * wrapper, a provider with no official `@ai-sdk/*` package yet) can register one of their own without
 * forking this plugin - `resolveModel` in `./llmGateway.ts` checks this registry first, by `llmProvider`
 * name, before falling through to the built-in switch. Call this from your own SignalK plugin's
 * `start()` (or `esl-cli --require <module>`, loaded before parsing per the core plugin's own CLI
 * extension timing - see its README). Declare this package as a regular npm `dependency` (not a
 * `peerDependency` - see the core plugin's own `registerVendorDriver` doc comment for why) so npm
 * resolves a real copy to register into.
 */
export function registerLlmProvider(name: string, factory: LlmProviderFactory): void {
  providers.set(name, factory);
}

export function getLlmProvider(name: string): LlmProviderFactory | undefined {
  return providers.get(name);
}
