import { ServerAPI, Plugin } from "@signalk/server-api";
import { createPlugin } from "./plugin";
import { registerLlmProvider as registerLlmProviderImpl, getLlmProvider as getLlmProviderImpl } from "./llmProviderRegistry";
import type { LlmProviderFactory as LlmProviderFactoryType, LlmSettings as LlmSettingsType } from "./llmProviderRegistry";

/**
 * On `start()`, registers this plugin's `TemplateProvider` with the core `signalk-einklabel-plugin`
 * (`esl.registerTemplateProvider`, see `./templateProvider.ts` and `./plugin.ts`) - so its prompts show
 * up in the core plugin's own "Template" picker, suffixed "(GenAI)".
 */
function plugin(app: ServerAPI): Plugin {
  return createPlugin(app);
}

namespace plugin {
  /**
   * Public extension point for a package adding support for an LLM provider this plugin doesn't
   * already bundle - see `registerLlmProvider`'s own doc comment (`./llmProviderRegistry.ts`) for the
   * full contract, and the core plugin's own `registerVendorDriver` doc comment for the dependency
   * convention to follow (a regular npm `dependency` plus `"signalk": { "requires": [...] }`, **not** a
   * `peerDependency`).
   */
  export const registerLlmProvider = registerLlmProviderImpl;
  export const getLlmProvider = getLlmProviderImpl;

  export type LlmProviderFactory = LlmProviderFactoryType;
  export type LlmSettings = LlmSettingsType;
}

export = plugin;
