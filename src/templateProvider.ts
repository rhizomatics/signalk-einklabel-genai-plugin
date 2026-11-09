import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { ServerAPI } from "@signalk/server-api";
import esl from "@rhizomatics/signalk-einklabel-plugin";
import { withRetries } from "./retry";
import { defaultConfig, PluginConfig, promptNameOptions, resolvePromptPath, resolvePromptsDir } from "./config";
import { callLlm, extractSvg, isOpenRouterProvider, LlmSettings } from "./llmGateway";

/** Appended to every prompt name this plugin offers in the core plugin's "Template" dropdown. */
export const SUFFIX = "(GenAI)";

const GUIDANCE_NAME = join(".assets", "target_guidance.md");

/** Strips ` (GenAI)` back off a dropdown entry and restores the `.md` extension hidden from it, e.g. `"forecast (GenAI)"` -> `"forecast.md"`. */
function promptNameFor(templateName: string): string {
  return `${templateName.slice(0, templateName.length - ` ${SUFFIX}`.length)}.md`;
}

/**
 * The `esl.TemplateProvider` this plugin registers with the core plugin (`esl.registerTemplateProvider`,
 * called when `./plugin.ts`'s `createPlugin` constructs the plugin, whether or not it is enabled). `listTemplates`/`describeBindings`/`render` all resolve the
 * current `promptsDir` fresh each time, rather than once at startup, so adding/editing a `.md` prompt
 * file takes effect without a plugin restart - same as the core plugin's own template directory.
 */
/**
 * `esl.TemplateProvider` with its optional `describeContent` made required, so callers (and tests) can
 * use it without a guard. Core logs it to debug output before each `render()`, so you can see what the
 * LLM is sent; a future core feature (e.g. emailing a label) could reuse it too. Older core versions
 * without `describeContent` simply never call it.
 */
export type GenAiTemplateProvider = esl.TemplateProvider & {
  describeContent(request: esl.TemplateRenderRequest): string;
};

/** `getConfig` returns `undefined` while the plugin isn't running: templates are still listed, but `render()` rejects without calling the LLM. */
export function createTemplateProvider(app: ServerAPI, getConfig: () => PluginConfig | undefined): GenAiTemplateProvider {
  function promptsDir(): string {
    return resolvePromptsDir((getConfig() ?? defaultConfig()).promptsDir);
  }

  function promptPathFor(templateName: string): { promptPath: string; guidancePath: string } {
    const dir = promptsDir();
    return {
      promptPath: resolvePromptPath(dir, promptNameFor(templateName)),
      guidancePath: resolvePromptPath(dir, GUIDANCE_NAME),
    };
  }

  /** Shared by `render` (sent to the LLM) and `describeContent` (for debugging what the LLM is sent) - the prompt+guidance text with every `{...}` placeholder substituted against `context`. */
  function buildPrompt(templateName: string, context: esl.TemplateRenderRequest["context"]): string {
    const { promptPath, guidancePath } = promptPathFor(templateName);
    const promptText = readFileSync(promptPath, "utf-8");
    const guidanceText = readFileSync(guidancePath, "utf-8");
    return `${esl.substituteBindingsInText(promptText, context).trim()}\n\n${esl.substituteBindingsInText(guidanceText, context).trim()}\n`;
  }

  return {
    suffix: SUFFIX,

    listTemplates(): string[] {
      return promptNameOptions(promptsDir()).map((name) => `${name.replace(/\.md$/, "")} ${SUFFIX}`);
    },

    describeBindings(templateName) {
      const { promptPath, guidancePath } = promptPathFor(templateName);
      const promptText = readFileSync(promptPath, "utf-8");
      const guidanceText = readFileSync(guidancePath, "utf-8");
      return esl.findBindingsInText(promptText, guidanceText);
    },

    describeContent(request) {
      return buildPrompt(request.templateName, request.context);
    },

    async render(request) {
      const config = getConfig();
      if (!config) {
        throw new Error('signalk-einklabel-genai-plugin is not running - enable it to render "(GenAI)" templates');
      }
      const prompt = buildPrompt(request.templateName, request.context);

      const llmSettings: LlmSettings = {
        llmProvider: config.llmProvider,
        llmApiKey: config.llmApiKey,
        llmModel: config.llmModel,
        llmBaseUrl: config.llmBaseUrl,
        llmTimeoutSeconds: config.llmTimeoutSeconds,
      };
      // `extractSvg` runs inside the retry loop, not after it - an unparseable response (the model
      // wrapped its SVG oddly, got cut off, whatever) gets a fresh attempt the same way a network/
      // timeout failure does, rather than failing the whole render on one bad completion.
      const {
        text: svg,
        model,
        usage,
      } = await withRetries(config.llmRetries, async () => {
        const result = await callLlm(llmSettings, prompt);
        return { ...result, text: extractSvg(result.text) };
      });
      if (isOpenRouterProvider(config.llmProvider)) {
        app.debug(`openrouter model=${model ?? "unknown"} usage=${JSON.stringify(usage)}`);
      }

      const renderer = new esl.Renderer();
      // `esl.Renderer.render()` reads its template from a file path, not a string - the LLM's SVG is
      // written out as one so the exact same rasterization path a bundled/local template gets is
      // reused unchanged, rather than needing its own copy of that logic.
      const cacheDir = join(promptsDir(), ".genai-cache");
      mkdirSync(cacheDir, { recursive: true });
      // One file per render: core repaints a device's targets in parallel, so a name shared by every
      // render of the same template could be overwritten by another target's SVG before it is read.
      const cachePath = join(cacheDir, `${Buffer.from(request.templateName).toString("hex")}-${randomUUID()}.svg`);
      writeFileSync(cachePath, svg);
      try {
        return await renderer.render(cachePath, request.context, request.width, request.height);
      } finally {
        rmSync(cachePath, { force: true });
      }
    },
  };
}
