import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SETTINGS, normalizeSettings, validateSettings } from "../src/shared/settings.js";

describe("settings", () => {
  it("normalizes missing values", () => {
    assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
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
});
