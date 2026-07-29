import { Plugin, ServerAPI } from "@signalk/server-api";
import esl from "@rhizomatics/signalk-einklabel-plugin";
import { defaultConfig, PluginConfig } from "./config";
import { availableProviders, callLlm } from "./llmGateway";
import { withRetries } from "./retry";
import { createTemplateProvider } from "./templateProvider";

/** Sent by the `testConnection` checkbox - short and cheap on tokens, just enough to prove the round trip works. */
const TEST_PROMPT = 'Reply with exactly the word "OK", nothing else.';

/**
 * Runs one test call against `config`'s LLM settings and reports the outcome via
 * `setPluginStatus`/`setPluginError` - both shown on the server's Plugin Config page - then clears the
 * one-shot `testConnection` flag via `savePluginOptions` so it doesn't refire on the next ordinary
 * restart. Fire-and-forget from `start()`: failures are reported through `setPluginError`, not thrown,
 * since nothing in `start()`'s own contract is waiting on this.
 */
async function runConnectionTest(app: ServerAPI, config: PluginConfig): Promise<void> {
  const label = `${config.llmProvider ?? "openrouter"}/${config.llmModel ?? "(no model configured)"}`;
  try {
    const reply = await withRetries(config.llmRetries, () => callLlm(config, TEST_PROMPT));
    app.setPluginStatus(`LLM test OK (${label}): ${reply.trim().slice(0, 200)}`);
  } catch (err) {
    app.setPluginError(`LLM test failed (${label}): ${(err as Error).message}`);
  } finally {
    app.savePluginOptions({ ...config, testConnection: false }, (err) => {
      if (err) app.debug(`failed to clear testConnection flag: ${err.message}`);
    });
  }
}

export function createPlugin(app: ServerAPI): Plugin {
  // Updated by `start()` on every (re)start - `createTemplateProvider`'s functions all read through
  // this closure rather than capturing one fixed config object, so a saved config change takes effect
  // on the *next* repaint without needing the core plugin (which holds the actual repaint schedule) to
  // know or care that anything changed on this side.
  let currentConfig: PluginConfig = defaultConfig();

  esl.registerTemplateProvider(createTemplateProvider(() => currentConfig));

  return {
    id: "signalk-einklabel-genai-plugin",
    name: "eInk Label GenAI Templates",
    description: "Contributes LLM-generated prompts as an alternative to hand-authored SVG templates for signalk-einklabel-plugin",
    schema: () => ({
      type: "object",
      properties: {
        llmProvider: {
          type: "string",
          title: "LLM provider",
          description:
            "Which LLM gateway to call - only providers whose npm package is actually installed are listed here; " +
            "install another one's optional package (e.g. `npm install ai @ai-sdk/anthropic`, see README) and reopen " +
            'this page to add it. "OpenRouter" is bundled and needs no extra install. "Ollama" defaults to a local ' +
            'Ollama server with no further config; "Local" is any other OpenAI-compatible endpoint (e.g. LM Studio) ' +
            'and needs "LLM base URL" below.',
          enum: availableProviders(),
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
        testConnection: {
          type: "boolean",
          title: "Test connection now",
          description:
            "Check this and save to send one test message to the LLM settings above as soon as the plugin (re)starts. " +
            "Watch this plugin's entry on the Plugin Config page for the result (success or the error) - the checkbox " +
            "clears itself afterwards, so it won't refire on the next ordinary restart.",
          default: false,
        },
      },
    }),
    uiSchema: () => ({ llmApiKey: { "ui:widget": "password" } }),
    start(config: object) {
      currentConfig = { ...defaultConfig(), ...(config as Partial<PluginConfig>) };
      app.debug(`eInk Label GenAI plugin started (llmProvider=${currentConfig.llmProvider ?? "openrouter"})`);
      if (currentConfig.testConnection) {
        runConnectionTest(app, currentConfig).catch((err) => app.debug(`connection test failed unexpectedly: ${(err as Error).message}`));
      }
    },
    stop() {},
  };
}
