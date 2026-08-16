import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeInsertionState,
  describeOutputTextState
} from "../src/background/controller/overlay-descriptions.js";

describe("overlay descriptions", () => {
  it("shows a specific Gemini auth warning without exposing transcript text", () => {
    const detail = describeOutputTextState(
      { text: "raw secret transcript", source: "raw-transcript" },
      { code: "LLM_AUTH_FAILED" }
    );

    assert.equal(detail, "Gemini key rejected; inserting raw transcript (21 characters).");
    assert.equal(detail.includes("raw secret transcript"), false);
  });

  it("carries the improvement failure reason into final insertion feedback", () => {
    assert.equal(
      describeInsertionState(
        {
          method: "target",
          targetKind: "textarea",
          textLength: 14
        },
        { code: "LLM_RATE_LIMITED" }
      ),
      "Raw transcript inserted into textarea (14 characters); Gemini rate limit reached."
    );

    assert.equal(
      describeInsertionState(
        {
          method: "clipboard",
          targetKind: "contenteditable",
          textLength: 14
        },
        { code: "LLM_MODEL_UNAVAILABLE" }
      ),
      "Raw transcript copied to clipboard (14 characters); Gemini model unavailable."
    );
  });
});
