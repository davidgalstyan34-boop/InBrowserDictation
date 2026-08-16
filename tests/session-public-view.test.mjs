import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DictationStatus } from "../src/shared/dictation-state.js";
import { toPublicSession } from "../src/background/session/session-public-view.js";

// This module is the boundary that keeps dictated content inside the service
// worker. Everything the popup and diagnostics can see passes through it, so
// these tests assert on absence as much as on shape.
const privateSession = Object.freeze({
  id: "session-1",
  status: DictationStatus.SUCCESS,
  tabId: 7,
  startedAt: 1000,
  target: { kind: "textarea", reason: null, descriptor: "textarea#notes" },
  recording: { startedAt: 1100, tabId: 7, mimeType: "audio/webm" },
  audio: {
    mimeType: "audio/webm",
    sizeBytes: 4096,
    durationMs: 2000,
    capturedAt: 3000,
    dataUrl: "data:audio/webm;base64,SECRETAUDIO"
  },
  transcription: {
    transcript: "the quick brown fox",
    providerMeta: { provider: "deepgram", model: "nova-3", requestId: "r-1", confidence: 0.98 }
  },
  improvement: {
    text: "The quick brown fox.",
    source: "llm",
    styleId: "default",
    providerMeta: { provider: "gemini", model: "gemini-test", responseId: "g-1", finishReason: "STOP" }
  },
  outputText: {
    text: "The quick brown fox.",
    source: "llm",
    styleId: "default",
    providerMeta: { provider: "gemini" }
  },
  insertion: {
    method: "target",
    strategy: null,
    targetKind: "textarea",
    textLength: 20,
    fallbackReason: null
  },
  updatedAt: 4000,
  warning: null,
  error: null
});

describe("public session view", () => {
  it("never exposes transcript, improved, output, or audio content", () => {
    const serialized = JSON.stringify(toPublicSession(privateSession));

    assert.doesNotMatch(serialized, /quick brown fox/);
    assert.doesNotMatch(serialized, /SECRETAUDIO/);
    assert.equal(serialized.includes("\"text\""), false);
    assert.equal(serialized.includes("dataUrl"), false);
    assert.equal(serialized.includes("transcript\":"), false);
  });

  it("reports lengths and provider metadata instead of content", () => {
    const view = toPublicSession(privateSession);

    assert.equal(view.transcription.textLength, "the quick brown fox".length);
    assert.equal(view.improvement.textLength, "The quick brown fox.".length);
    assert.equal(view.outputText.textLength, "The quick brown fox.".length);
    assert.deepEqual(view.audio, {
      mimeType: "audio/webm",
      sizeBytes: 4096,
      durationMs: 2000,
      capturedAt: 3000
    });
    assert.deepEqual(view.transcription.providerMeta, {
      provider: "deepgram",
      model: "nova-3",
      requestId: "r-1",
      confidence: 0.98
    });
  });

  it("drops provider metadata fields it does not recognize", () => {
    const view = toPublicSession({
      ...privateSession,
      transcription: {
        transcript: "hello",
        providerMeta: {
          provider: "deepgram",
          model: "nova-3",
          apiKey: "leaked-key",
          rawResponse: { transcript: "hello" }
        }
      }
    });

    assert.deepEqual(view.transcription.providerMeta, {
      provider: "deepgram",
      model: "nova-3"
    });
  });

  it("returns a provider-only shape for an unknown provider", () => {
    const view = toPublicSession({
      ...privateSession,
      transcription: {
        transcript: "hello",
        providerMeta: { provider: "mystery", secret: "do not surface" }
      }
    });

    assert.deepEqual(view.transcription.providerMeta, { provider: "mystery" });
  });

  it("passes through nulls for an idle session", () => {
    const view = toPublicSession({
      id: null,
      status: DictationStatus.IDLE,
      tabId: null,
      startedAt: null,
      target: null,
      recording: null,
      audio: null,
      transcription: null,
      improvement: null,
      outputText: null,
      insertion: null,
      updatedAt: null,
      warning: null,
      error: null
    });

    assert.equal(view.status, DictationStatus.IDLE);
    assert.equal(view.transcription, null);
    assert.equal(view.outputText, null);
    assert.equal(view.audio, null);
  });
});
