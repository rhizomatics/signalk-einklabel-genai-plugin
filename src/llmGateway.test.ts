import test from "node:test";
import assert from "node:assert/strict";
import { callLlm, extractSvg, loadOptional } from "./llmGateway";

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
  await t.test("rejects immediately when no model is configured, without attempting a network call", async () => {
    await assert.rejects(callLlm({}, "prompt"), /no LLM model configured/);
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
