import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DictationEvent, DictationStatus } from "../src/shared/dictation-state.js";
import { createSessionStore } from "../src/background/session/store.js";

describe("session store", () => {
  it("keeps startup busy until recorder metadata arrives", () => {
    const sessions = createSessionStore();

    const started = sessions.start({ id: "session-1", tabId: 10, startedAt: 1000 });
    assert.equal(started.status, DictationStatus.STARTING);

    const prepared = sessions.markTargetReady({ kind: "textarea" });
    assert.equal(prepared.status, DictationStatus.STARTING);

    const recording = sessions.markRecording({ startedAt: 1100, tabId: 10, mimeType: "audio/webm" });
    assert.equal(recording.status, DictationStatus.RECORDING);
    assert.equal(recording.recording.tabId, 10);
    assert.deepEqual(sessions.toPublicSession().recording, {
      startedAt: 1100,
      tabId: 10,
      mimeType: "audio/webm"
    });

    const stopping = sessions.markStopping();
    assert.equal(stopping.status, DictationStatus.STOPPING);
  });

  it("tracks the Phase 5 transcription, improvement, and insertion lifecycle without exposing text", () => {
    const sessions = createSessionStore();

    sessions.start({ id: "session-4", tabId: 44, startedAt: 1000 });
    sessions.markTargetReady({ kind: "textarea" });
    sessions.markRecording({ startedAt: 1100, mimeType: "audio/webm" });
    sessions.markStopping();

    const transcribing = sessions.markTranscribing({
      mimeType: "audio/webm",
      sizeBytes: 4096,
      durationMs: 2000,
      capturedAt: 3000,
      dataUrl: "data:audio/webm;base64,abc"
    });

    assert.equal(transcribing.status, DictationStatus.TRANSCRIBING);
    assert.equal(transcribing.audio.dataUrl, "data:audio/webm;base64,abc");

    const improving = sessions.markTranscriptReady({
      transcript: "hello world",
      providerMeta: {
        provider: "deepgram",
        requestId: "request-1"
      }
    }, 3200);

    assert.equal(improving.status, DictationStatus.IMPROVING);
    assert.equal(improving.transcription.transcript, "hello world");
    assert.deepEqual(sessions.toPublicSession().transcription, {
      textLength: 11,
      providerMeta: {
        provider: "deepgram",
        requestId: "request-1"
      }
    });
    assert.equal("transcript" in sessions.toPublicSession().transcription, false);

    const inserting = sessions.markImprovedTextReady({
      text: "Hello world.",
      source: "llm",
      styleId: "default",
      providerMeta: {
        provider: "gemini",
        responseId: "response-1"
      }
    }, 3300);

    assert.equal(inserting.status, DictationStatus.INSERTING);
    assert.equal(inserting.outputText.text, "Hello world.");
    assert.deepEqual(sessions.toPublicSession().outputText, {
      textLength: 12,
      source: "llm",
      styleId: "default",
      providerMeta: {
        provider: "gemini",
        responseId: "response-1"
      }
    });
    assert.equal("text" in sessions.toPublicSession().outputText, false);

    const completed = sessions.markInsertionDone({
      method: "target",
      targetKind: "textarea",
      textLength: 12
    }, 3400);

    assert.equal(completed.status, DictationStatus.SUCCESS);
    assert.deepEqual(sessions.toPublicSession().insertion, {
      method: "target",
      strategy: null,
      targetKind: "textarea",
      textLength: 12,
      fallbackReason: null
    });
  });

  it("completes with raw transcript metadata when text improvement fails", () => {
    const sessions = createSessionStore();

    sessions.start({ id: "session-5", tabId: 55, startedAt: 1000 });
    sessions.markTargetReady({ kind: "textarea" });
    sessions.markRecording({ startedAt: 1100, mimeType: "audio/webm" });
    sessions.markStopping();
    sessions.markTranscribing({
      mimeType: "audio/webm",
      sizeBytes: 4096,
      durationMs: 2000,
      capturedAt: 3000,
      dataUrl: "data:audio/webm;base64,abc"
    });
    sessions.markTranscriptReady({
      transcript: "raw transcript",
      providerMeta: {
        provider: "deepgram"
      }
    });

    const inserting = sessions.markRawTranscriptFallback({
      code: "LLM_RATE_LIMITED",
      message: "Gemini rate limit reached."
    }, 3300);

    assert.equal(inserting.status, DictationStatus.INSERTING);
    assert.equal(inserting.outputText.text, "raw transcript");
    assert.deepEqual(sessions.toPublicSession().outputText, {
      textLength: 14,
      source: "raw-transcript",
      styleId: "raw",
      providerMeta: {
        provider: "deepgram"
      }
    });
    assert.deepEqual(sessions.toPublicSession().warning, {
      code: "LLM_RATE_LIMITED",
      message: "Gemini rate limit reached."
    });

    const completed = sessions.markInsertionDone({
      method: "clipboard",
      strategy: "async-clipboard",
      targetKind: "textarea",
      textLength: 14,
      fallbackReason: "INSERTION_TARGET_STALE"
    }, 3400);

    assert.equal(completed.status, DictationStatus.SUCCESS);
    assert.deepEqual(sessions.toPublicSession().insertion, {
      method: "clipboard",
      strategy: "async-clipboard",
      targetKind: "textarea",
      textLength: 14,
      fallbackReason: "INSERTION_TARGET_STALE"
    });
  });

  it("recovers an active offscreen recording without requiring captured page target state", () => {
    const sessions = createSessionStore();
    const recovered = sessions.recoverRecording({
      tabId: 22,
      recording: {
        sessionId: "session-2",
        startedAt: 2000,
        mimeType: "audio/webm"
      }
    });

    assert.equal(recovered.id, "session-2");
    assert.equal(recovered.status, DictationStatus.RECORDING);
    assert.equal(recovered.target, null);
    assert.equal(recovered.tabId, 22);
  });

  it("can pause startup while microphone permission is requested visibly", () => {
    const sessions = createSessionStore();
    sessions.start({ id: "session-3", tabId: 33 });
    sessions.markTargetReady({ kind: "input" });

    const waiting = sessions.markMicrophonePermissionNeeded();

    assert.equal(waiting.status, DictationStatus.WAITING_FOR_MICROPHONE);
    assert.equal(waiting.target.kind, "input");
  });

  it("rejects invalid lifecycle mutations before changing session data", () => {
    const sessions = createSessionStore();

    assert.throws(
      () => sessions.markStopping(),
      {
        code: "INVALID_SESSION_TRANSITION",
        status: DictationStatus.IDLE,
        event: DictationEvent.STOP_REQUESTED
      }
    );

    assert.equal(sessions.get().status, DictationStatus.IDLE);
    assert.equal(sessions.get().recording, null);
  });

  it("keeps terminal sessions stable when late failures arrive", () => {
    const sessions = createSessionStore();

    sessions.start({ id: "session-terminal", tabId: 66 });
    sessions.markTargetReady({ kind: "textarea" });
    sessions.markRecording({ startedAt: 1100, mimeType: "audio/webm" });
    sessions.markStopping();
    sessions.markTranscribing({
      mimeType: "audio/webm",
      sizeBytes: 4096,
      durationMs: 2000,
      capturedAt: 3000,
      dataUrl: "data:audio/webm;base64,abc"
    });
    sessions.markTranscriptReady({
      transcript: "hello world",
      providerMeta: { provider: "deepgram" }
    });
    sessions.markImprovedTextReady({
      text: "Hello world.",
      source: "llm",
      styleId: "default",
      providerMeta: { provider: "gemini" }
    });
    const completed = sessions.markInsertionDone({
      method: "target",
      targetKind: "textarea",
      textLength: 12
    });

    const afterLateFailure = sessions.fail({
      code: "LATE_FAILURE",
      message: "A late failure should not overwrite success."
    });

    assert.equal(afterLateFailure, completed);
    assert.equal(afterLateFailure.status, DictationStatus.SUCCESS);
    assert.equal(afterLateFailure.error, null);
  });
});
