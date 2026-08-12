import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createAudioMetadata,
  createMediaRecorderOptions,
  createRecordingError,
  describeAudioMetadata,
  isMicrophonePermissionError,
  isUsableRecordingSize,
  normalizeRecordingError,
  selectSupportedAudioMimeType
} from "../src/shared/audio-recording.js";

describe("audio recording helpers", () => {
  it("chooses the first supported MIME type", () => {
    const mediaRecorder = {
      isTypeSupported: (mimeType) => mimeType === "audio/webm"
    };

    assert.equal(selectSupportedAudioMimeType(mediaRecorder), "audio/webm");
  });

  it("falls back to browser defaults when support cannot be inspected", () => {
    assert.equal(selectSupportedAudioMimeType({}), "");
    assert.deepEqual(createMediaRecorderOptions(""), {});
  });

  it("detects tiny recordings before provider work begins", () => {
    assert.equal(isUsableRecordingSize(511), false);
    assert.equal(isUsableRecordingSize(512), true);
  });

  it("keeps audio metadata small and displayable", () => {
    const metadata = createAudioMetadata({
      mimeType: "audio/webm",
      sizeBytes: 2048,
      durationMs: 3200,
      capturedAt: 1000
    });

    assert.deepEqual(metadata, {
      mimeType: "audio/webm",
      sizeBytes: 2048,
      durationMs: 3200,
      capturedAt: 1000
    });
    assert.equal(describeAudioMetadata(metadata), "3s captured (2.0 KB)");
  });

  it("normalizes common microphone permission errors", () => {
    const denied = new DOMException("Permission denied", "NotAllowedError");
    assert.deepEqual(normalizeRecordingError(denied), {
      code: "MICROPHONE_PERMISSION_DENIED",
      message: "Microphone permission was denied."
    });
  });

  it("preserves explicit recording error codes", () => {
    const error = createRecordingError("RECORDING_EMPTY", "Recording was empty.");
    assert.deepEqual(normalizeRecordingError(error), {
      code: "RECORDING_EMPTY",
      message: "Recording was empty."
    });
  });

  it("identifies permission failures that should open the visible grant page", () => {
    assert.equal(isMicrophonePermissionError({ code: "MICROPHONE_PERMISSION_DENIED" }), true);
    assert.equal(isMicrophonePermissionError(new DOMException("Denied", "NotAllowedError")), true);
    assert.equal(isMicrophonePermissionError({ code: "MICROPHONE_UNAVAILABLE" }), false);
  });
});
