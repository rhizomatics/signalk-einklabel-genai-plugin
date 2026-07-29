import { readFileSync } from "fs";
import { join } from "path";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { PluginConfig } from "./config";
import { getLlmProvider, listRegisteredProviders, LlmSettings as RegistryLlmSettings } from "./llmProviderRegistry";

// `llmTimeoutSeconds` is optional here (unlike on `PluginConfig`, where `defaultConfig()` always sets
// it) since `callLlm` below defaults it itself - useful for the CLI's `generate` command and tests that
// only care about the other settings.
export type LlmSettings = RegistryLlmSettings & { llmTimeoutSeconds?: number };

/**
 * `ai` and every `@ai-sdk/*`/`ai-sdk-ollama` provider package (other than `@openrouter/ai-sdk-provider`,
 * see below) are `optionalDependencies` (see package.json), not plain `dependencies` - user picks
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
 * OpenRouter's own free-tier routing alias - picks a random model from whichever free models are
 * currently available, no paid account needed (see README's "Working Example"). Used as `llmModel`'s
 * fallback only when the provider is (or defaults to) `"openrouter"` - see `resolveModel` below - since
 * it's meaningless for any other provider.
 */
const DEFAULT_OPENROUTER_MODEL = "openrouter/free";

/** Whether `moduleName` resolves at all - cheaper than `loadOptional`, since it never actually evaluates the module. */
export function isPackageInstalled(moduleName: string): boolean {
  try {
    require.resolve(moduleName);
    return true;
  } catch {
    return false;
  }
}

/**
 * A package name from this plugin's own `optionalDependencies` doesn't always match the `llmProvider`
 * id `resolveModel`'s switch uses it for: `ai-sdk-ollama` isn't under the `@ai-sdk/` scope at all, and
 * `@ai-sdk/openai-compatible` backs `"local"`, not a provider literally named "openai-compatible".
 * Every other optional package *does* match `@ai-sdk/<id>` (see `resolveModel`'s cases), so only these
 * two irregular ones need spelling out - everything else is derived by stripping the scope below.
 */
const PACKAGE_TO_PROVIDER_ID: Record<string, string> = {
  "ai-sdk-ollama": "ollama",
  "@ai-sdk/openai-compatible": "local",
};

/** Preferred dropdown order - purely cosmetic; anything not listed here (a future package, a custom-registered name) sorts after these, alphabetically. */
const PROVIDER_DISPLAY_ORDER = ["openrouter", "openai", "anthropic", "google", "xai", "deepseek", "moonshotai", "ollama", "local"];

function byDisplayOrder(a: string, b: string): number {
  const ai = PROVIDER_DISPLAY_ORDER.indexOf(a);
  const bi = PROVIDER_DISPLAY_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1 || bi === -1) return ai === -1 ? 1 : -1;
  return ai - bi;
}

/**
 * Every `llmProvider` name actually usable right now, for the plugin config screen's `llmProvider`
 * dropdown (`plugin.ts`'s `schema()`) - so a provider whose package isn't installed doesn't even show
 * up as pickable. Rather than a second hardcoded provider-to-package table duplicating `resolveModel`'s
 * switch, this reads this plugin's own `optionalDependencies` straight out of `package.json` (the
 * actual, already-curated list of installable provider packages - `require.resolve`-able but never
 * `require()`'d, so a failed optional install can't crash this) and checks each with `isPackageInstalled`.
 * `"openrouter"` is always included (it's a regular `dependency`, see this module's top doc comment);
 * any name added via `registerLlmProvider` is included unconditionally too, since there's no package to
 * check for those.
 */
export function availableProviders(): string[] {
  const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as {
    optionalDependencies?: Record<string, string>;
  };
  const installed = Object.keys(packageJson.optionalDependencies ?? {})
    .filter(isPackageInstalled)
    .map((pkg) => PACKAGE_TO_PROVIDER_ID[pkg] ?? pkg.replace(/^@ai-sdk\//, ""));
  return [...new Set(["openrouter", ...installed, ...listRegisteredProviders()])].sort(byDisplayOrder);
}

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
  const provider = settings.llmProvider ?? "openrouter";
  const model = settings.llmModel ?? (provider === "openrouter" ? DEFAULT_OPENROUTER_MODEL : undefined);
  if (!model) {
    throw new Error("no LLM model configured (llmModel)");
  }

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
