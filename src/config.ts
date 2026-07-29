import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join } from "path";

export interface PluginConfig {
  /**
   * Which LLM gateway a prompt is sent to - see `./llmGateway.ts`. `"ollama"`/`"local"` both go through
   * the generic OpenAI-compatible provider; any other value not in this list is looked up in the
   * `registerLlmProvider` registry (`./llmProviderRegistry.ts`) before giving up - so someone keen can
   * add support for another provider entirely without forking this plugin. Defaults to `"openrouter"`,
   * the only provider bundled as a regular `dependency` rather than an `optionalDependency` - see
   * `./llmGateway.ts`'s top doc comment.
   */
  llmProvider?: "openrouter" | "openai" | "anthropic" | "google" | "xai" | "deepseek" | "moonshotai" | "ollama" | "local";
  /** Ignored for `llmProvider: "ollama"`/`"local"` unless the server itself requires one. */
  llmApiKey?: string;
  /** Provider-specific model id, e.g. `"gpt-4o"`, `"claude-sonnet-4-5"`, `"gemini-2.5-flash"`, or an Ollama/local model tag. */
  llmModel?: string;
  /**
   * An OpenAI-compatible endpoint. Optional for `llmProvider: "ollama"` - defaults to Ollama's own
   * standard local address, `http://localhost:11434/v1`; only needed there to point at a differently
   * configured/remote Ollama instance. Required for `llmProvider: "local"` (any other OpenAI-compatible
   * server, e.g. LM Studio/vLLM), which has no such universal default.
   */
  llmBaseUrl?: string;
  /** How long to wait for the LLM's response before giving up on an attempt. */
  llmTimeoutSeconds: number;
  /** How many times to attempt the LLM call (including the first try) before giving up (the core plugin then shows its own generic fallback warning). */
  llmRetries: number;
  /**
   * Directory this plugin scans for `.md` prompt files - same convention as the core plugin's own
   * `templatesDir`: empty for the default, a relative path resolved against `~/.signalk`, or an
   * absolute path. Use `resolvePromptsDir` to turn this into an actual path.
   */
  promptsDir: string;
  /**
   * When `true`, `start()` sends one test message to the configured LLM and reports the result via
   * `app.setPluginStatus`/`setPluginError` (visible on the server's Plugin Config page) - then clears
   * itself back to `false` via `savePluginOptions` so it doesn't refire on every ordinary restart. Not
   * a persistent setting, just a one-shot "test connection now" checkbox - see `plugin.ts`'s `start()`.
   */
  testConnection?: boolean;
}

/**
 * This package's own bundled `prompts/` directory (ships alongside `dist/`, see package.json's
 * `files`) - `forecast.md` (the built-in default) and the always-appended
 * `.assets/target_guidance.md` fragment live here. A same-named file in the user's `promptsDir` takes
 * priority, letting users add or override their own prompts.
 */
export const BUNDLED_PROMPTS_DIR = join(__dirname, "..", "prompts");

/** Bundled prompt used when `promptName` is left unset. */
export const DEFAULT_PROMPT_NAME = "forecast.md";

const SIGNALK_HOME_DIR = join(homedir(), ".signalk");
const DEFAULT_PROMPTS_DIR = join(SIGNALK_HOME_DIR, "einklabel-genai", "prompts");

export function defaultConfig(): PluginConfig {
  return {
    llmTimeoutSeconds: 60,
    llmRetries: 2,
    promptsDir: "",
  };
}

/** Mirrors the core plugin's `resolveTemplatesDir` - see its own doc comment. */
export function resolvePromptsDir(promptsDir: string | undefined): string {
  const trimmed = promptsDir?.trim();
  if (!trimmed) return DEFAULT_PROMPTS_DIR;
  return isAbsolute(trimmed) ? trimmed : join(SIGNALK_HOME_DIR, trimmed);
}

function listMarkdownFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
}

/** Local prompts take priority over a same-named bundled one; both show up as options. */
export function promptNameOptions(promptsDir: string): string[] {
  const local = listMarkdownFiles(promptsDir);
  const bundled = listMarkdownFiles(BUNDLED_PROMPTS_DIR).filter((name) => !local.includes(name));
  return [...local, ...bundled];
}

/**
 * Resolves a prompt name (or the `.assets/target_guidance.md` fragment, passed as
 * `".assets/target_guidance.md"`) to an actual file - a local file under `promptsDir` overrides the
 * bundled one of the same name.
 */
export function resolvePromptPath(promptsDir: string, name: string): string {
  const localPath = join(promptsDir, name);
  return existsSync(localPath) ? localPath : join(BUNDLED_PROMPTS_DIR, name);
}
