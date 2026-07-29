import { Plugin, ServerAPI } from "@signalk/server-api";
import esl from "@rhizomatics/signalk-einklabel-plugin";
import { defaultConfig, PluginConfig } from "./config";
import { createTemplateProvider } from "./templateProvider";

export function createPlugin(app: ServerAPI): Plugin {
  // Updated by `start()` on every (re)start - `createTemplateProvider`'s functions all read through
  // this closure rather than capturing one fixed config object, so a saved config change takes effect
  // on the *next* repaint without needing the core plugin (which holds the actual repaint schedule) to
  // know or care that anything changed on this side.
  let currentConfig: PluginConfig = defaultConfig();

  esl.registerTemplateProvider(createTemplateProvider(() => currentConfig));

  return {
    id: "signalk-einklabel-genai-plugin",
    name: "eInk Label GenAI Rendering",
    description: "Contributes LLM-generated prompts as an alternative to hand-authored SVG templates for signalk-einklabel-plugin",
    schema: () => ({
      type: "object",
      properties: {
        llmProvider: {
          type: "string",
          title: "LLM provider",
          description:
            'Which LLM gateway to call - "OpenRouter" is bundled and needs no extra install; every other option ' +
            "(other than local/ollama) needs its own optional npm package installed, e.g. `npm install ai @ai-sdk/anthropic` " +
            '(see README). "Ollama" defaults to a local Ollama server with no further config; "Local" is any other ' +
            'OpenAI-compatible endpoint (e.g. LM Studio) and needs "LLM base URL" below.',
          enum: ["openrouter", "openai", "anthropic", "google", "xai", "deepseek", "moonshotai", "ollama", "local"],
          default: "openrouter",
        },
        llmApiKey: {
          type: "string",
          title: "LLM API key",
          description: 'Not required for "ollama"/"local" unless the server itself checks one.',
        },
        llmModel: {
          type: "string",
          title: "LLM model",
          description:
            'Provider-specific model id/name, e.g. "gpt-4o", "claude-sonnet-4-5", "gemini-2.5-flash", "grok-4", or an Ollama/local model tag.',
        },
        llmBaseUrl: {
          type: "string",
          title: 'LLM base URL (required if LLM provider is "local")',
          description:
            'An OpenAI-compatible endpoint. Optional for "ollama" (defaults to "http://localhost:11434/v1") - set this only if Ollama runs elsewhere.',
        },
        llmTimeoutSeconds: {
          type: "number",
          title: "LLM call timeout (seconds)",
          description: "How long to wait for the LLM's response before giving up on an attempt.",
          minimum: 1,
          default: defaultConfig().llmTimeoutSeconds,
        },
        llmRetries: {
          type: "number",
          title: "LLM call retries",
          description:
            "How many times to attempt the LLM call (including the first try) before giving up - the core plugin then shows " +
            "its own generic fallback warning instead of leaving stale content on screen.",
          minimum: 1,
          default: defaultConfig().llmRetries,
        },
        promptsDir: {
          type: "string",
          title: "Prompts directory",
          description:
            "Relative path from ~/.signalk, or an absolute path. Leave empty for the default. Holds .md prompt files - a prompt " +
            "here with the same name as a bundled one takes priority. Prompts show up in the core plugin's own Template " +
            'picker, suffixed "(GenAI)".',
          default: defaultConfig().promptsDir,
        },
      },
    }),
    uiSchema: () => ({ llmApiKey: { "ui:widget": "password" } }),
    start(config: object) {
      currentConfig = { ...defaultConfig(), ...(config as Partial<PluginConfig>) };
      app.debug(`eInk Label GenAI plugin started (llmProvider=${currentConfig.llmProvider ?? "openrouter"})`);
    },
    stop() {},
  };
}
