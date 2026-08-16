import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCodedError, isCodedError } from "../src/shared/extension-error.js";
import {
  createSpeechToTextError,
  normalizeSpeechToTextError
} from "../src/background/providers/speech-to-text-errors.js";
import {
  createTextImprovementError,
  normalizeTextImprovementError
} from "../src/background/providers/text-improvement-errors.js";
import {
  createRecordingError,
  isMicrophonePermissionError,
  normalizeRecordingError
} from "../src/shared/audio-recording.js";
import { toError } from "../src/background/utils/errors.js";

// DOMException carries a legacy numeric `code`. These tests inject real
// DOMExceptions rather than hand-built plain objects, because a plain-object
// stand-in cannot reproduce the bug this module exists to prevent.
describe("coded error identity", () => {
  it("recognizes extension-owned errors", () => {
    assert.equal(isCodedError(createCodedError("STT_TIMEOUT", "Timed out.")), true);
  });

  it("rejects DOMExceptions that carry a legacy numeric code", () => {
    for (const name of ["AbortError", "SecurityError", "NotFoundError", "InvalidStateError"]) {
      const domException = new DOMException(`raw ${name} text`, name);

      assert.equal(typeof domException.code, "number");
      assert.equal(
        isCodedError(domException),
        false,
        `${name} (code ${domException.code}) must not be treated as normalized`
      );
    }
  });

  it("rejects errors with an empty code or message", () => {
    assert.equal(isCodedError(createCodedError("", "Message.")), false);
    assert.equal(isCodedError(createCodedError("CODE", "")), false);
    assert.equal(isCodedError(null), false);
  });
});

describe("speech-to-text error normalization", () => {
  it("maps a real aborted fetch to the timeout code", () => {
    const controller = new AbortController();
    controller.abort();

    const normalized = normalizeSpeechToTextError(controller.signal.reason, { timedOut: true });

    assert.equal(normalized.code, "STT_TIMEOUT");
    assert.match(normalized.message, /timed out/i);
  });

  it("maps a real aborted fetch to the cancelled code", () => {
    const normalized = normalizeSpeechToTextError(new DOMException("aborted", "AbortError"));

    assert.equal(normalized.code, "STT_CANCELLED");
  });

  it("preserves an already-normalized provider error", () => {
    const original = createSpeechToTextError("STT_AUTH_FAILED", "Deepgram rejected the API key.");

    assert.equal(normalizeSpeechToTextError(original), original);
  });
});

describe("text improvement error normalization", () => {
  it("maps a real aborted fetch to the timeout code", () => {
    const normalized = normalizeTextImprovementError(
      new DOMException("aborted", "AbortError"),
      { timedOut: true }
    );

    assert.equal(normalized.code, "LLM_TIMEOUT");
  });

  it("maps a real aborted fetch to the cancelled code", () => {
    const normalized = normalizeTextImprovementError(new DOMException("aborted", "AbortError"));

    assert.equal(normalized.code, "LLM_CANCELLED");
  });

  it("preserves an already-normalized provider error", () => {
    const original = createTextImprovementError("LLM_RATE_LIMITED", "Gemini rate limit reached.");

    assert.equal(normalizeTextImprovementError(original), original);
  });
});

describe("recording error normalization", () => {
  it("maps microphone DOMExceptions to readable codes", () => {
    const cases = [
      ["NotAllowedError", "MICROPHONE_PERMISSION_DENIED"],
      ["SecurityError", "MICROPHONE_PERMISSION_DENIED"],
      ["NotFoundError", "MICROPHONE_UNAVAILABLE"],
      ["NotReadableError", "MICROPHONE_UNAVAILABLE"]
    ];

    for (const [name, expectedCode] of cases) {
      const normalized = normalizeRecordingError(new DOMException("raw browser text", name));

      assert.equal(normalized.code, expectedCode, `${name} should map to ${expectedCode}`);
      assert.notEqual(normalized.message, "raw browser text");
    }
  });

  it("routes a SecurityError to the visible permission page after crossing messaging", () => {
    // The offscreen document normalizes and flattens, the service worker rebuilds
    // an Error, and only then does the permission-recovery check run.
    const flattened = normalizeRecordingError(new DOMException("blocked", "SecurityError"));
    const rebuilt = toError(flattened);

    assert.equal(isMicrophonePermissionError(rebuilt), true);
  });

  it("preserves an already-normalized recorder error", () => {
    const original = createRecordingError("RECORDING_EMPTY", "Recording was too short.");
    const normalized = normalizeRecordingError(original);

    assert.deepEqual(normalized, {
      code: "RECORDING_EMPTY",
      message: "Recording was too short."
    });
  });
});
