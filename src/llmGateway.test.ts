import test from "node:test";
import assert from "node:assert/strict";
import { availableProviders, callLlm, extractSvg, isPackageInstalled, loadOptional } from "./llmGateway";
import { registerLlmProvider } from "./llmProviderRegistry";

test("extractSvg", async (t) => {
  await t.test("returns the svg document unchanged when it's already bare", () => {
    assert.equal(extractSvg("<svg>hi</svg>"), "<svg>hi</svg>");
  });

  await t.test("strips a markdown code fence around the svg", () => {
    assert.equal(extractSvg("```svg\n<svg>hi</svg>\n```"), "<svg>hi</svg>");
  });

  await t.test("strips leading/trailing commentary", () => {
    assert.equal(extractSvg("Here you go:\n<svg>hi</svg>\nHope that helps!"), "<svg>hi</svg>");
  });

  await t.test("throws when there's no <svg>...</svg> document at all", () => {
    assert.throws(() => extractSvg("sorry, I can't do that"), /did not contain/);
  });
});

test("callLlm", async (t) => {
  await t.test(
    "rejects immediately when no model is configured and the provider has no default model, without attempting a network call",
    async () => {
      await assert.rejects(callLlm({ llmProvider: "anthropic" }, "prompt"), /no LLM model configured/);
    },
  );

  await t.test('defaults llmModel to "openrouter/free" when llmProvider is (or defaults to) "openrouter" and none is given', async () => {
    // No real OpenRouter credentials in CI/dev - a short timeout turns the real (network) attempt into a
    // fast, deterministic failure. The only thing under test is that it got past validation into an
    // actual call, rather than throwing "no LLM model configured" synchronously.
    const err = await callLlm({ llmTimeoutSeconds: 1 }, "prompt").catch((e) => e as Error);
    assert.ok(err instanceof Error);
    assert.doesNotMatch(err.message, /no LLM model configured/);
  });

  await t.test('rejects immediately when llmProvider is "local" with no llmBaseUrl', async () => {
    await assert.rejects(callLlm({ llmProvider: "local", llmModel: "llama3.2" }, "prompt"), /llmBaseUrl is required/);
  });

  await t.test('"ollama" needs no llmBaseUrl - defaults to a local Ollama endpoint instead of requiring one', async () => {
    // No Ollama actually running in CI/dev - a short timeout turns the real (network) attempt into a
    // fast, deterministic failure. The only thing under test is that it got past validation into an
    // actual call, rather than throwing the "local" case's "llmBaseUrl is required" synchronously.
    const err = await callLlm({ llmProvider: "ollama", llmModel: "llama3.2", llmTimeoutSeconds: 1 }, "prompt").catch((e) => e as Error);
    assert.ok(err instanceof Error);
    assert.doesNotMatch(err.message, /llmBaseUrl is required/);
  });
});

test("loadOptional", async (t) => {
  await t.test("throws an actionable install instruction naming the missing package, not a bare MODULE_NOT_FOUND", () => {
    assert.throws(
      () => loadOptional("@ai-sdk/definitely-not-installed"),
      (err: unknown) => {
        const message = (err as Error).message;
        assert.match(message, /optional dependency "@ai-sdk\/definitely-not-installed"/);
        assert.match(message, /npm install @ai-sdk\/definitely-not-installed/);
        return true;
      },
    );
  });

  await t.test("returns the module's exports when it is installed", () => {
    const ai = loadOptional<{ generateText: unknown }>("ai");
    assert.equal(typeof ai.generateText, "function");
  });
});

test("isPackageInstalled", async (t) => {
  await t.test("true for a package that resolves", () => {
    assert.equal(isPackageInstalled("ai"), true);
  });

  await t.test("false for a package nothing installed", () => {
    assert.equal(isPackageInstalled("@ai-sdk/definitely-not-installed"), false);
  });
});

test("availableProviders", async (t) => {
  await t.test("always includes openrouter, the one bundled as a regular dependency", () => {
    assert.ok(availableProviders().includes("openrouter"));
  });

  await t.test("includes a built-in provider whose optional package is installed", () => {
    // Every optionalDependency is installed in this dev/CI environment - see package.json.
    assert.ok(availableProviders().includes("anthropic"));
    assert.ok(availableProviders().includes("ollama"));
    assert.ok(availableProviders().includes("local"));
  });

  await t.test("includes a name registered via registerLlmProvider, which has no package to check", () => {
    registerLlmProvider("available-providers-test-custom", () => "fake-model");
    assert.ok(availableProviders().includes("available-providers-test-custom"));
  });
});
