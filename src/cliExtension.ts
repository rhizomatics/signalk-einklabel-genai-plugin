/**
 * Contributes `prompt`/`generate` subcommands to the core plugin's `esl-cli`, for testing prompts
 * without a device or a live SignalK server. Load via `esl-cli -r @rhizomatics/signalk-einklabel-genai-plugin/cli prompt ...`
 * (the `./cli` subpath export in package.json, so callers don't need to know this compiles to
 * `dist/cliExtension.js`) - the core CLI pre-scans `-r`/`--require` and loads those modules *before*
 * building its own command tree (see its own README/source for why), which is what makes adding a
 * brand-new subcommand from here possible at all, unlike a module that only registers a vendor
 * driver/template provider.
 *
 * Deliberately NOT loaded from this package's main entry (`./index.ts`, what SignalK server actually
 * requires to load the plugin) - the core CLI module this file requires below calls
 * `program.parseAsync(process.argv)` at the top level as a side effect of being required, which is
 * correct for a CLI invocation but would misfire if pulled into a running SignalK server process.
 *
 * A plain top-level `require()` (rather than a static `import`) of the core CLI module is deliberate -
 * it makes the load-time side effect (adding commands to an already-running CLI process) obvious to a
 * reader, and avoids a static import accidentally triggering a *second*, unrelated full execution of
 * that module (including its own `parseAsync(process.argv)`) if this file were ever `require()`'d
 * outside of `esl-cli -r`'s intended flow - within that flow, the core CLI module is already
 * mid-execution and cached, so this just reads back the shared `program`/helpers it already exported.
 */
import { existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Command } from "commander";
import esl, { Colour, TemplateContext } from "@rhizomatics/signalk-einklabel-plugin";
import { BUNDLED_PROMPTS_DIR, DEFAULT_PROMPT_NAME, resolvePromptPath, resolvePromptsDir } from "./config";
import { callLlm, extractSvg, isOpenRouterProvider, LlmSettings } from "./llmGateway";
import { withRetries } from "./retry";

/** Matches the core plugin's own (not publicly re-exported) `Binding` shape structurally - see `esl.findBindingsInText`'s return type. */
interface BindingLike {
  source: "signalk" | "resources" | "einklabel" | "label";
  context: string;
  path: string;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cli = require("@rhizomatics/signalk-einklabel-plugin/dist/cli/index.js") as {
  program: Command;
  assembleContext(opts: { url?: string; exampleData?: string }, bindings: BindingLike[]): Promise<TemplateContext>;
  parseColours(code: string): Colour[];
  DEFAULT_SIGNALK_URLS: string[];
};

const DEFAULT_GUIDANCE_PATH = join(BUNDLED_PROMPTS_DIR, ".assets", "target_guidance.md");

/** Shared -p/-g/-w/--height/--colours/-d/--manufacturer/--label/-u/-e options for `prompt` and `generate`. */
function addPromptOptions(command: Command): Command {
  return command
    .option("-p, --prompt <path>", "path to a .md prompt file", join(BUNDLED_PROMPTS_DIR, DEFAULT_PROMPT_NAME))
    .option("-g, --guidance <path>", "path to the target-guidance fragment appended after the prompt", DEFAULT_GUIDANCE_PATH)
    .option("-u, --url <url>", "SignalK server base URL - if omitted, tries each of " + cli.DEFAULT_SIGNALK_URLS.join(", ") + " in turn")
    .option("-e, --example-data <dir>", "load vessels/resources from local example JSON files in <dir> instead of a live SignalK server")
    .option("-w, --width <px>", "value for {source=label,path=width}", "416")
    .option("--height <px>", "value for {source=label,path=height}", "240")
    .option("--colours <code>", "value for {source=label,path=colours}: BW, BWR, or BWRY", "BWRY")
    .option("-d, --description <text>", "value for {source=label,path=description} (a label's configured location/notes)")
    .option("--manufacturer <name>", "value for {source=label,path=manufacturer}", "preview")
    .option("--label <name>", "value for {source=label,path=label} (the panel's own size label, e.g. '3.7\"')", "preview");
}

/**
 * Resolves the optional positional `[name]` argument (e.g. `esl-cli prompt forecast`) to a prompt file
 * path, overriding `-p/--prompt` when given - a bare name (no extension) is resolved as a prompt name
 * via `resolvePromptPath`/`resolvePromptsDir` (the same lookup a real device's prompt gets).
 */
function resolvePromptArg(name: string | undefined, promptOption: string): string {
  if (!name) return promptOption;
  if (existsSync(name)) return name;
  const fileName = /\.[a-z0-9]+$/i.test(name) ? name : `${name}.md`;
  return resolvePromptPath(resolvePromptsDir(""), fileName);
}

/**
 * Resolves a prompt+guidance fragment's placeholders against a live SignalK server (or example data),
 * building the same `context.label` (`esl.buildLabel`) a real repaint would - shared by `prompt` and
 * `generate`. `navigation.position` is always fetched (even if no other binding references it) so
 * `{source=label,path=position}` works without the caller needing to name it explicitly.
 */
async function resolvePrompt(opts: {
  prompt: string;
  guidance: string;
  url?: string;
  exampleData?: string;
  width: string;
  height: string;
  colours: string;
  description?: string;
  manufacturer: string;
  label: string;
}): Promise<string> {
  const promptText = await readFile(opts.prompt, "utf-8");
  const guidanceText = await readFile(opts.guidance, "utf-8");
  const positionBinding: BindingLike = { source: "signalk", context: "self", path: "navigation.position" };
  const bindings = [...esl.findBindingsInText(promptText, guidanceText), positionBinding];
  const context = await cli.assembleContext(opts, bindings);
  const rawPosition = (context.signalk as { self?: { navigation?: { position?: unknown } } } | undefined)?.self?.navigation?.position as
    | { latitude?: number; longitude?: number }
    | undefined;
  const position =
    typeof rawPosition?.latitude === "number" && typeof rawPosition?.longitude === "number"
      ? { latitude: rawPosition.latitude, longitude: rawPosition.longitude }
      : undefined;
  const label = esl.buildLabel({
    manufacturer: opts.manufacturer,
    label: opts.label,
    width: Number(opts.width),
    height: Number(opts.height),
    colours: cli.parseColours(opts.colours),
    description: opts.description,
    position,
  });
  const promptContext: TemplateContext = { ...context, label };
  return `${esl.substituteBindingsInText(promptText, promptContext).trim()}\n\n${esl.substituteBindingsInText(guidanceText, promptContext).trim()}\n`;
}

addPromptOptions(
  cli.program
    .command("prompt")
    .argument("[name]", 'prompt name (e.g. "forecast") or path - overrides -p/--prompt if given')
    .description(
      "Resolve a prompt file's placeholders against a live SignalK server (or example data) and print the exact text an LLM would be sent - no LLM call",
    ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
).action(async (name: string | undefined, opts: any) => {
  console.log(await resolvePrompt({ ...opts, prompt: resolvePromptArg(name, opts.prompt) }));
});

addPromptOptions(
  cli.program
    .command("generate")
    .argument("[name]", 'prompt name (e.g. "forecast") or path - overrides -p/--prompt if given')
    .description("Call an LLM with a resolved prompt and write the rendered SVG's PNG, without needing a device"),
)
  .requiredOption("-o, --output <path>", "output PNG path")
  .option(
    "--save-svg <path>",
    "also write the LLM's raw SVG response to this path (feed it straight into the core plugin's `paint -t`/`render -t` afterwards)",
  )
  .option("--llm-provider <name>", "openrouter, openai, anthropic, google, xai, deepseek, moonshotai, ollama, or local", "openrouter")
  .option("--llm-api-key <key>", "LLM API key - falls back to the provider's usual environment variable if omitted")
  .requiredOption(
    "--llm-model <name>",
    "provider-specific model id/name, e.g. gpt-4o, claude-sonnet-4-5, gemini-2.5-flash, grok-4, or a local/ollama model tag",
  )
  .option(
    "--llm-base-url <url>",
    'OpenAI-compatible endpoint - required if --llm-provider is "local"; for "ollama" defaults to http://localhost:11434/v1',
  )
  .option("--llm-timeout <seconds>", "LLM call timeout", "60")
  .option("--llm-retries <n>", "LLM call attempts before giving up", "2")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .action(async (name: string | undefined, opts: any) => {
    const prompt = await resolvePrompt({ ...opts, prompt: resolvePromptArg(name, opts.prompt) });
    const llmSettings: LlmSettings = {
      llmProvider: opts.llmProvider,
      llmApiKey: opts.llmApiKey,
      llmModel: opts.llmModel,
      llmBaseUrl: opts.llmBaseUrl,
      llmTimeoutSeconds: Number(opts.llmTimeout),
    };
    const {
      text: svg,
      model,
      usage,
    } = await withRetries(Number(opts.llmRetries), async () => {
      const result = await callLlm(llmSettings, prompt);
      return { ...result, text: extractSvg(result.text) };
    });
    if (isOpenRouterProvider(llmSettings.llmProvider)) {
      console.log(`openrouter model=${model ?? "unknown"} usage=${JSON.stringify(usage)}`);
    }
    const svgPath = opts.saveSvg ?? join(tmpdir(), `esl-cli-generate-${Date.now()}.svg`);
    await writeFile(svgPath, svg);

    const width = Number(opts.width);
    const height = Number(opts.height);
    const renderer = new esl.Renderer();
    const bitmap = await renderer.render(
      svgPath,
      { meta: { repainted: new Date().toISOString(), description: opts.description ?? "" } },
      width,
      height,
    );
    await writeFile(opts.output, esl.bitmapToPng(bitmap));
    console.log(`wrote ${opts.output} (${bitmap.width}x${bitmap.height})${opts.saveSvg ? `, svg saved to ${opts.saveSvg}` : ""}`);
  });
