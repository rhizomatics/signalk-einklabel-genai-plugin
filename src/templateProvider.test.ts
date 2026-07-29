import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_PROMPT_NAME, PluginConfig } from "./config";
import { createTemplateProvider, SUFFIX } from "./templateProvider";

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "einklabel-genai-provider-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("createTemplateProvider", async (t) => {
  await t.test("suffix matches the constant every dropdown entry is annotated with", () => {
    const provider = createTemplateProvider(() => ({ llmTimeoutSeconds: 30, llmRetries: 2, promptsDir: "" }));
    assert.equal(provider.suffix, SUFFIX);
  });

  await t.test("listTemplates offers the bundled default prompt, suffixed", () => {
    withTempDir((promptsDir) => {
      const config: PluginConfig = { llmTimeoutSeconds: 30, llmRetries: 2, promptsDir };
      const provider = createTemplateProvider(() => config);
      assert.ok(provider.listTemplates().includes(`${DEFAULT_PROMPT_NAME} ${SUFFIX}`));
    });
  });

  await t.test("describeBindings finds the bindings the bundled default prompt actually references", () => {
    withTempDir((promptsDir) => {
      const config: PluginConfig = { llmTimeoutSeconds: 30, llmRetries: 2, promptsDir };
      const provider = createTemplateProvider(() => config);
      const templateName = `${DEFAULT_PROMPT_NAME} ${SUFFIX}`;
      const bindings = provider.describeBindings(templateName);
      // The bundled forecast.md references design.length.overall/design.aisShipType.name/navigation.position -
      // this just confirms the file actually got read and parsed as bindings, not the exact set.
      assert.ok(bindings.length > 0);
      assert.ok(bindings.some((binding) => binding.path.startsWith("design.") || binding.path.startsWith("navigation.")));
    });
  });
});
