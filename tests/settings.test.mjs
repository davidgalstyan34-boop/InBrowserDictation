import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  resolveRewriteStyle,
  validateSettings
} from "../src/shared/settings.js";

describe("settings", () => {
  it("normalizes missing values", () => {
    assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  });

  it("repairs obsolete provider values to current defaults", () => {
    assert.deepEqual(normalizeSettings({
      sttProvider: "deepgram",
      sttApiKey: "deepgram-key",
      llmProvider: "openai",
      llmApiKey: "openai-key"
    }), {
      ...DEFAULT_SETTINGS,
      sttApiKey: "deepgram-key"
    });
  });

  it("keeps keys when providers are already current", () => {
    assert.deepEqual(normalizeSettings({
      sttProvider: "deepgram",
      sttApiKey: "deepgram-key",
      llmProvider: "gemini",
      llmApiKey: "gemini-key"
    }), {
      ...DEFAULT_SETTINGS,
      sttApiKey: "deepgram-key",
      llmApiKey: "gemini-key"
    });
  });

  it("keeps keys when old settings omitted provider fields", () => {
    assert.deepEqual(normalizeSettings({
      sttApiKey: "deepgram-key",
      llmApiKey: "gemini-key"
    }), {
      ...DEFAULT_SETTINGS,
      sttApiKey: "deepgram-key",
      llmApiKey: "gemini-key"
    });
  });

  it("accepts the default style", () => {
    const result = validateSettings(DEFAULT_SETTINGS);
    assert.equal(result.ok, true);
  });

  it("rejects an unknown default style", () => {
    const result = validateSettings({
      ...DEFAULT_SETTINGS,
      defaultStyleId: "verbose-sales-letter"
    });

    assert.equal(result.ok, false);
    assert.equal(result.errors.defaultStyleId, "Choose a valid default style.");
  });

  it("accepts a complete custom style as default", () => {
    const result = validateSettings({
      ...DEFAULT_SETTINGS,
      defaultStyleId: "engineering-slack",
      customStyles: [
        {
          id: "engineering-slack",
          name: "Engineering Slack",
          instructions: "Write concise technical messages."
        }
      ]
    });

    assert.equal(result.ok, true);
  });

  it("resolves built-in and custom rewrite style instructions", () => {
    const professional = resolveRewriteStyle({
      ...DEFAULT_SETTINGS,
      defaultStyleId: "professional"
    });
    assert.equal(professional.id, "professional");
    assert.match(professional.instructions, /businesslike/);

    const custom = resolveRewriteStyle({
      ...DEFAULT_SETTINGS,
      defaultStyleId: "engineering-slack",
      customStyles: [
        {
          id: "engineering-slack",
          name: "Engineering Slack",
          instructions: "Write concise technical messages."
        }
      ]
    });
    assert.equal(custom.id, "engineering-slack");
    assert.equal(custom.instructions, "Write concise technical messages.");
  });
});
