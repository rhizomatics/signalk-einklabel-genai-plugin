import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { defaultConfig, DEFAULT_PROMPT_NAME, promptNameOptions, resolvePromptPath, resolvePromptsDir } from "./config";

test("defaultConfig has sane defaults", () => {
  const defaults = defaultConfig();
  assert.equal(defaults.llmTimeoutSeconds, 30);
  assert.equal(defaults.llmRetries, 2);
  assert.equal(defaults.promptsDir, "");
});

test("resolvePromptsDir", async (t) => {
  await t.test("defaults to ~/.signalk/einklabel-genai/prompts when empty/undefined", () => {
    const expected = join(homedir(), ".signalk", "einklabel-genai", "prompts");
    assert.equal(resolvePromptsDir(undefined), expected);
    assert.equal(resolvePromptsDir(""), expected);
  });

  await t.test("resolves a relative path against ~/.signalk", () => {
    assert.equal(resolvePromptsDir("my-prompts"), join(homedir(), ".signalk", "my-prompts"));
  });

  await t.test("uses an absolute path as-is", () => {
    assert.equal(resolvePromptsDir("/srv/esl/prompts"), "/srv/esl/prompts");
  });
});

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "einklabel-genai-prompts-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("resolvePromptPath", async (t) => {
  await t.test("falls back to the bundled prompts dir when there is no local override", () => {
    withTempDir((dir) => {
      assert.match(resolvePromptPath(dir, DEFAULT_PROMPT_NAME), /[\\/]prompts[\\/]forecast\.md$/);
    });
  });

  await t.test("prefers a local prompt over the bundled one of the same name", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, DEFAULT_PROMPT_NAME), "custom prompt");
      assert.equal(resolvePromptPath(dir, DEFAULT_PROMPT_NAME), join(dir, DEFAULT_PROMPT_NAME));
    });
  });

  await t.test("resolves the bundled .assets/target_guidance.md fragment the same way", () => {
    withTempDir((dir) => {
      assert.match(resolvePromptPath(dir, join(".assets", "target_guidance.md")), /target_guidance\.md$/);
    });
  });
});

test("promptNameOptions", async (t) => {
  await t.test("lists the bundled default prompt when there is no local override", () => {
    withTempDir((dir) => {
      assert.ok(promptNameOptions(dir).includes(DEFAULT_PROMPT_NAME));
    });
  });

  await t.test("lists local prompts, with a local one shadowing a same-named bundled one", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "custom.md"), "a custom prompt");
      const options = promptNameOptions(dir);
      assert.ok(options.includes("custom.md"));
      assert.equal(options.filter((name) => name === DEFAULT_PROMPT_NAME).length, 1);
    });
  });
});
