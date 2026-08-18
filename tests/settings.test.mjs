import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_SETTINGS,
  createCustomStyleId,
  getConfigurationRequirements,
  getRewriteStyles,
  normalizeCustomStyles,
  normalizeSettings,
  resolveRewriteStyle,
  validateSettings
} from "../src/shared/settings.js";

describe("settings", () => {
  it("normalizes missing values", () => {
    assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
  });

  it("repairs unsupported provider values to current defaults", () => {
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

  it("keeps keys when provider fields are absent and defaults apply", () => {
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

  it("normalizes custom style ids and keeps them separate from built-ins", () => {
    const normalized = normalizeCustomStyles([
      {
        id: "raw",
        name: "Raw",
        instructions: "Use my custom raw style."
      },
      {
        name: "Engineering Slack",
        instructions: "Write concise technical messages."
      }
    ]);

    assert.equal(normalized[0].id, "raw-2");
    assert.equal(normalized[1].id, "engineering-slack");
    assert.equal(createCustomStyleId("Engineering Slack", new Set(["engineering-slack"])), "engineering-slack-2");
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

    const allStyles = getRewriteStyles({
      ...DEFAULT_SETTINGS,
      customStyles: [
        {
          id: "engineering-slack",
          name: "Engineering Slack",
          instructions: "Write concise technical messages."
        }
      ]
    });
    assert.equal(allStyles.at(-1).id, "engineering-slack");
  });

  it("reports credential requirements for LLM and raw processing paths", () => {
    const defaultRequirements = getConfigurationRequirements({
      ...DEFAULT_SETTINGS,
      sttApiKey: "deepgram-key"
    });

    assert.equal(defaultRequirements.sttApiKey.required, true);
    assert.equal(defaultRequirements.sttApiKey.configured, true);
    assert.equal(defaultRequirements.llmApiKey.required, true);
    assert.equal(defaultRequirements.llmApiKey.configured, false);

    const rawRequirements = getConfigurationRequirements({
      ...DEFAULT_SETTINGS,
      defaultStyleId: "raw"
    });

    assert.equal(rawRequirements.styleId, "raw");
    assert.equal(rawRequirements.llmApiKey.required, false);
  });
});
