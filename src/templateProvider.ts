import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import esl from "@rhizomatics/signalk-einklabel-plugin";
import { withRetries } from "./retry";
import { PluginConfig, promptNameOptions, resolvePromptPath, resolvePromptsDir } from "./config";
import { callLlm, extractSvg, LlmSettings } from "./llmGateway";

/** Appended to every prompt name this plugin offers in the core plugin's "Template" dropdown. */
export const SUFFIX = "(GenAI)";

const GUIDANCE_NAME = join(".assets", "target_guidance.md");

/** Strips ` (GenAI)` back off a dropdown entry and restores the `.md` extension hidden from it, e.g. `"forecast (GenAI)"` -> `"forecast.md"`. */
function promptNameFor(templateName: string): string {
  return `${templateName.slice(0, templateName.length - ` ${SUFFIX}`.length)}.md`;
}

/**
 * The `esl.TemplateProvider` this plugin registers with the core plugin (`esl.registerTemplateProvider`,
 * called from `./plugin.ts`'s `start()`). `listTemplates`/`describeBindings`/`render` all resolve the
 * current `promptsDir` fresh each time, rather than once at startup, so adding/editing a `.md` prompt
 * file takes effect without a plugin restart - same as the core plugin's own template directory.
 */
export function createTemplateProvider(getConfig: () => PluginConfig): esl.TemplateProvider {
  function promptsDir(): string {
    return resolvePromptsDir(getConfig().promptsDir);
  }

  function promptPathFor(templateName: string): { promptPath: string; guidancePath: string } {
    const dir = promptsDir();
    return {
      promptPath: resolvePromptPath(dir, promptNameFor(templateName)),
      guidancePath: resolvePromptPath(dir, GUIDANCE_NAME),
    };
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

    async render(request) {
      const { promptPath, guidancePath } = promptPathFor(request.templateName);
      const promptText = readFileSync(promptPath, "utf-8");
      const guidanceText = readFileSync(guidancePath, "utf-8");
      const prompt = `${esl.substituteBindingsInText(promptText, request.context).trim()}\n\n${esl
        .substituteBindingsInText(guidanceText, request.context)
        .trim()}\n`;

      const config = getConfig();
      const llmSettings: LlmSettings = {
        llmProvider: config.llmProvider,
        llmApiKey: config.llmApiKey,
        llmModel: config.llmModel,
        llmBaseUrl: config.llmBaseUrl,
        llmTimeoutSeconds: config.llmTimeoutSeconds,
      };
      const raw = await withRetries(config.llmRetries, () => callLlm(llmSettings, prompt));
      const svg = extractSvg(raw);

      const renderer = new esl.Renderer();
      // `esl.Renderer.render()` reads its template from a file path, not a string - the LLM's SVG is
      // written out as one so the exact same rasterization path a bundled/local template gets is
      // reused unchanged, rather than needing its own copy of that logic.
      const cacheDir = join(promptsDir(), ".genai-cache");
      mkdirSync(cacheDir, { recursive: true });
      const cachePath = join(cacheDir, `${Buffer.from(request.templateName).toString("hex")}.svg`);
      writeFileSync(cachePath, svg);
      return renderer.render(cachePath, request.context, request.width, request.height);
    },
  };
}
