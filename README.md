# eInk Label GenAI Rendering

A companion plugin for [`@rhizomatics/signalk-einklabel-plugin`](https://github.com/rhizomatics/signalk-einklabel-plugin) that generates a device's content from an LLM prompt, as an alternative to a hand-authored SVG template.

By default it uses [OpenRouter](https://openrouter.ai), however it can use any of the [Vercel AI SDK providers](https://ai-sdk.dev/providers/ai-sdk-providers) directly, including local LLMs like Ollama.

## Working Example

This plugin comes with a marine weather forecast example prompt. When installed, and SignalK server restarted, you should see this appear as a template to choose in the main eInk Label plugin.

### Customizing Prompts

Prompts have the same template syntax as the SVG images, so the weather forecast will give the current GPS position, and the length and type of boat.

All prompts also get a generated appendix to the prompt that gives details about the eInk label, including manufacturer, name, pixel height and width, colour range, and the description provided in the main plugin.

### Full Example

```markdown
Summarize the maritime weather outlook for the next 24 hours, appropriate for the sailor of a 13.6m Sailing craft positioned at latitude 40.689247, longitude -74.044502

Generate an SVG image for the result suitable for a ZhunyCo 4.13" eInk Electronic Shelf Label display with pixel height 240 and width 416. Available colours are black (#000000), white (#FFFFFF), red (#FF0000), yellow (#FFFF00). Fonts available are serif, sans-serif, monospace.

Use graphics to make it easier to read and use the space better, and use colour and layout to draw attention to safety critical information. Include in minimal size font the source of the information.
```

## Installation

Install both plugins from the SignalK AppStore (or `npm install @rhizomatics/signalk-einklabel-plugin @rhizomatics/signalk-einklabel-genai-plugin`), then install whichever LLM provider package(s) you'll actually use - these are `optionalDependencies`, not installed automatically, since a user only ever needs one. `openrouter` is the one exception: `@openrouter/ai-sdk-provider` is a regular `dependency`, so it's already installed and needs no extra step, as is the base `ai` package:

```bash
npm install ai @ai-sdk/openai          # llmProvider: "openai"
npm install ai @ai-sdk/anthropic       # llmProvider: "anthropic"
npm install ai @ai-sdk/google          # llmProvider: "google"
npm install ai @ai-sdk/xai             # llmProvider: "xai"
npm install ai @ai-sdk/deepseek        # llmProvider: "deepseek"
npm install ai @ai-sdk/moonshotai      # llmProvider: "moonshotai"
npm install ai ai-sdk-ollama           # llmProvider: "ollama"
npm install ai @ai-sdk/openai-compatible  # llmProvider: "local" (LM Studio, vLLM, ...)
```

If the package for your configured provider isn't installed, a GenAI-backed device falls back to the core plugin's warning template with a log message naming exactly which package to `npm install`.

## Configuration

- `llmProvider` - `openai`, `anthropic`, `google`, `xai`, `deepseek`, `moonshotai`, `openrouter`, `ollama`, or `local` (any other OpenAI-compatible server)
- `llmApiKey` - not needed for `ollama`/`local` unless your server itself checks one
- `llmModel` - provider-specific model id, e.g. `gpt-4o`, `claude-sonnet-4-5`, `gemini-2.5-flash`, `grok-4`, or an Ollama/local model tag
- `llmBaseUrl` - required for `local`; optional for `ollama` (defaults to `http://localhost:11434/v1`)
- `llmTimeoutSeconds`/`llmRetries` - how long to wait, and how many attempts, before giving up (the core plugin then shows its fallback warning)
- `promptsDir` - where to look for your own `.md` prompt files, same convention as the core plugin's `templatesDir` (empty for the default, a relative path resolves against `~/.signalk`, absolute used as-is)

## Writing Prompts

A prompt (`.md` file) is just prose, with the same `{...}` binding syntax as a template's `<desc>` in the core plugin (see its README, "Template Source Specification") - a bare path like `{design.length.overall}`, or the full `source=...,path=...,format=...` grammar, resolve exactly the way they would in a template. One more source is available here, `source=label`, giving facts about the physical label the LLM needs to design for:

- `path=width`/`path=height` - exact pixel size the returned SVG must match
- `path=colours` - the label's colour palette (add `format=csv` for a plain comma-separated list)
- `path=fonts` - the three font-family keywords the renderer can actually display (also supports `format=csv`)
- `path=description` - the device's own configured Location/description field
- `path=manufacturer`/`path=label` - the panel's real-world brand and its own size label (e.g. `3.7"`)
- `path=position` - the vessel's current GPS position, pre-formatted as decimal degrees with hemisphere letters

A placeholder that doesn't resolve to any value becomes `???` in the prompt text - a visible gap the LLM can reason around, rather than a silent, misleading blank. Add `default=<value>` to any binding to use that value instead when the data is missing.

Every prompt also has a bundled `.assets/target_guidance.md` fragment appended automatically, telling the model the exact size/colour/font constraints and that it must respond with nothing but a single self-contained `<svg>...</svg>` document. Override it the same way you'd override any bundled prompt - put your own `.assets/target_guidance.md` in your `promptsDir`.

## Testing Prompts from the CLI

This plugin contributes `prompt`/`generate` subcommands to the core plugin's `esl-cli`, loaded via `-r`:

```bash
esl-cli -r @rhizomatics/signalk-einklabel-genai-plugin/cli prompt forecast -e examples
esl-cli -r @rhizomatics/signalk-einklabel-genai-plugin/cli generate forecast -e examples -o forecast.png --llm-provider ollama --llm-model llama3.2
```

- `prompt [name]` - resolve a prompt's placeholders against a live SignalK server (or example data) and print the exact text an LLM would be sent, with no LLM call
- `generate [name]` - call the configured LLM and write the rendered SVG's PNG, optionally saving the raw SVG too with `--save-svg`

The optional `[name]` argument names a prompt the same way the config UI's picker does - a full path also works. Use `--help` on either for the full option list.

## Architecture

### Why 2 plugins?

This is deliberately a separate plugin, not a feature of the core one: the core plugin has nothing to do with any LLM SDK or API key, so installing it never pulls in GenAI dependencies unless you also explicitly install and enable this one - useful for anyone on a small/constrained install, or who'd simply rather not have any GenAI code in their install at all.

### How it fits together

This plugin registers a `TemplateProvider` with the core plugin (the same extension mechanism a new vendor's hardware driver uses - see the core plugin's README, "Extending"). Once both plugins are installed and enabled:

- Its prompts show up as ordinary entries in the core plugin's own "Template" picker, suffixed `(GenAI)` - pick one exactly like you'd pick a `.svg` file. No separate "render mode" setting.
- All LLM provider/model/API-key configuration lives in **this** plugin's own config screen - the core plugin knows nothing about any of that.
- If the LLM call fails (network/API error, exhausted retries) or its response isn't a renderable SVG, the **core** plugin pushes its own generic fallback-warning template instead of leaving the previous, possibly now-wrong, content on screen - the same safety net a broken hand-authored template gets. The next scheduled repaint retries automatically.

Since each repaint may call a (usually paid) LLM API, a GenAI-backed device should use Repaint Trigger `interval`, not `subscription`.

### Adding another LLM provider

The provider list above is `resolveModel`'s (`src/llmGateway.ts`) built-in switch, but you're not limited to it: call `registerLlmProvider(name, factory)` (exported from this plugin, mirroring the core plugin's own extension points) from your own SignalK plugin's `start()` to add support for a provider this plugin doesn't bundle, without forking it. A registered name takes priority over the built-in switch, so it can even replace one of the names above.

```ts
import genai from "@rhizomatics/signalk-einklabel-genai-plugin";
genai.registerLlmProvider("my-provider", (settings) => myOwnModelFactory(settings));
```

Declare this package as a regular npm `dependency` (**not** a `peerDependency` - see the core plugin's own README for why) plus `"signalk": { "requires": ["@rhizomatics/signalk-einklabel-genai-plugin"] }` in your extension's `package.json`.
