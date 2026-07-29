import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { PluginConfig } from "./config";
import { getLlmProvider, LlmSettings as RegistryLlmSettings } from "./llmProviderRegistry";

// `llmTimeoutSeconds` is optional here (unlike on `PluginConfig`, where `defaultConfig()` always sets
// it) since `callLlm` below defaults it itself - useful for the CLI's `generate` command and tests that
// only care about the other settings.
export type LlmSettings = RegistryLlmSettings & { llmTimeoutSeconds?: number };

/**
 * `ai` and every `@ai-sdk/*`/`ai-sdk-ollama` provider package (other than `@openrouter/ai-sdk-provider`,
 * see below) are `optionalDependencies` (see package.json), not plain `dependencies` - a user picks
 * exactly one provider, so there's no reason to force every one of them to install, and an install that
 * fails to fetch one it doesn't even use (a network hiccup, `npm install --omit=optional`, an unsupported
 * platform) must not break this plugin for everyone else. That means every reference to one of these
 * packages has to be a `require()` reached only when `callLlm` actually needs it - a top-level `import`
 * would be resolved eagerly the moment this module loads, throwing before any config is even read. Types
 * are still fully checked via `typeof import(...)` at each call site, which - unlike a value `import` -
 * is erased entirely at compile time and leaves no runtime trace for `tsc` to eagerly require.
 */
export function loadOptional<M>(moduleName: string): M {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(moduleName) as M;
  } catch (err) {
    throw new Error(
      `LLM provider support needs the optional dependency "${moduleName}", which isn't installed - run "npm install ${moduleName}" (${(err as Error).message})`,
    );
  }
}

/** Ollama's own default local listen address - see the `"ollama"` case in `resolveModel` below. */
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

/**
 * Resolves `settings` to a Vercel AI SDK model handle. Checks `registerLlmProvider`'s registry
 * (`./llmProviderRegistry.ts`) first, by exact `llmProvider` name, before falling through to this
 * built-in switch - so a custom-registered provider can even *replace* one of the names below if it
 * wants to. `"ollama"` uses the dedicated `ai-sdk-ollama` package (defaults its own base URL to Ollama's
 * standard local address, so no config is needed beyond a model tag); `"local"` uses the generic
 * `@ai-sdk/openai-compatible` provider for anything else OpenAI-compatible (LM Studio, vLLM, ...), which
 * has no such universal default, so `llmBaseUrl` is required there.
 *
 * Returns `any` deliberately - this bridges several different concrete SDK provider packages' own
 * model-handle types (each an implementation of `ai`'s `LanguageModel`, but not literally the same
 * type reference) plus the registry's own `unknown`-typed `LlmModel`; `generateText` below still
 * validates the value at the one place it's actually used.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveModel(settings: LlmSettings): any {
  const model = settings.llmModel;
  if (!model) {
    throw new Error("no LLM model configured (llmModel)");
  }
  const provider = settings.llmProvider ?? "openrouter";

  const registered = getLlmProvider(provider);
  if (registered) return registered(settings);

  switch (provider) {
    case "anthropic": {
      const { createAnthropic } = loadOptional<typeof import("@ai-sdk/anthropic")>("@ai-sdk/anthropic");
      return createAnthropic({ apiKey: settings.llmApiKey })(model);
    }
    case "google": {
      const { createGoogleGenerativeAI } = loadOptional<typeof import("@ai-sdk/google")>("@ai-sdk/google");
      return createGoogleGenerativeAI({ apiKey: settings.llmApiKey })(model);
    }
    case "xai": {
      const { createXai } = loadOptional<typeof import("@ai-sdk/xai")>("@ai-sdk/xai");
      return createXai({ apiKey: settings.llmApiKey })(model);
    }
    case "deepseek": {
      const { createDeepSeek } = loadOptional<typeof import("@ai-sdk/deepseek")>("@ai-sdk/deepseek");
      return createDeepSeek({ apiKey: settings.llmApiKey })(model);
    }
    case "moonshotai": {
      const { createMoonshotAI } = loadOptional<typeof import("@ai-sdk/moonshotai")>("@ai-sdk/moonshotai");
      return createMoonshotAI({ apiKey: settings.llmApiKey })(model);
    }
    case "openrouter": {
      return createOpenRouter({ apiKey: settings.llmApiKey })(model);
    }
    case "ollama": {
      const { createOllama } = loadOptional<typeof import("ai-sdk-ollama")>("ai-sdk-ollama");
      return createOllama({ baseURL: settings.llmBaseUrl || DEFAULT_OLLAMA_BASE_URL, apiKey: settings.llmApiKey })(model);
    }
    case "local": {
      if (!settings.llmBaseUrl) {
        throw new Error('llmBaseUrl is required when llmProvider is "local"');
      }
      const { createOpenAICompatible } = loadOptional<typeof import("@ai-sdk/openai-compatible")>("@ai-sdk/openai-compatible");
      return createOpenAICompatible({ name: "local", baseURL: settings.llmBaseUrl, apiKey: settings.llmApiKey })(model);
    }
    case "openai":
    default: {
      const { createOpenAI } = loadOptional<typeof import("@ai-sdk/openai")>("@ai-sdk/openai");
      return createOpenAI({ apiKey: settings.llmApiKey })(model);
    }
  }
}

/**
 * Calls the configured LLM gateway with `prompt`, returning its raw text response - not yet extracted/
 * validated as SVG, see `extractSvg`. Wrapped in its own timeout (`AbortController`) since this is the
 * one genuinely slow/unreliable network call in this plugin.
 */
export async function callLlm(settings: LlmSettings, prompt: string): Promise<string> {
  const model = resolveModel(settings);
  const { generateText } = loadOptional<typeof import("ai")>("ai");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (settings.llmTimeoutSeconds ?? 30) * 1000);
  try {
    const { text } = await generateText({ model, prompt, abortSignal: controller.signal });
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strips everything outside the first `<svg`...last `</svg>` span - a chat model asked for "only raw
 * SVG markup" still often wraps it in a markdown code fence or adds a sentence of commentary either
 * side, despite the target-guidance fragment telling it not to.
 */
export function extractSvg(raw: string): string {
  const start = raw.indexOf("<svg");
  const end = raw.lastIndexOf("</svg>");
  if (start === -1 || end === -1 || end < start) {
    throw new Error('LLM response did not contain a "<svg>...</svg>" document');
  }
  return raw.slice(start, end + "</svg>".length);
}

// Re-exported so callers only need one import for the whole gateway surface.
export type { PluginConfig };
