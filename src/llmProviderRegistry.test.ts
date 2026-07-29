import test from "node:test";
import assert from "node:assert/strict";
import { getLlmProvider, registerLlmProvider } from "./llmProviderRegistry";

test("llmProviderRegistry", async (t) => {
  await t.test("returns undefined for a provider name nothing has registered", () => {
    assert.equal(getLlmProvider("definitely-not-registered"), undefined);
  });

  await t.test("returns the registered factory for an exact provider name", () => {
    const factory = () => "fake-model";
    registerLlmProvider("my-custom-provider", factory);
    assert.equal(getLlmProvider("my-custom-provider"), factory);
  });

  await t.test("a later registration for the same name replaces the earlier one", () => {
    registerLlmProvider("replaceable", () => "first");
    const second = () => "second";
    registerLlmProvider("replaceable", second);
    assert.equal(getLlmProvider("replaceable"), second);
  });
});
