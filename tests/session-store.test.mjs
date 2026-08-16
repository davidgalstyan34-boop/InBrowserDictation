import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DictationEvent, DictationStatus } from "../src/shared/dictation-state.js";
import { createSessionStore } from "../src/background/session/store.js";

describe("session store", () => {
  it("keeps startup busy until recorder metadata arrives", () => {
    const sessions = createSessionStore();

    const started = sessions.start({ id: "session-1", tabId: 10, startedAt: 1000 });
    assert.equal(started.status, DictationStatus.STARTING);

    const prepared = sessions.markTargetReady("session-1", { kind: "textarea" });
    assert.equal(prepared.status, DictationStatus.STARTING);

    const recording = sessions.markRecording("session-1", { startedAt: 1100, tabId: 10, mimeType: "audio/webm" });
    assert.equal(recording.status, DictationStatus.RECORDING);
    assert.equal(recording.recording.tabId, 10);
    assert.deepEqual(sessions.toPublicSession().recording, {
      startedAt: 1100,
      tabId: 10,
      mimeType: "audio/webm"
    });

    const stopping = sessions.markStopping("session-1");
    assert.equal(stopping.status, DictationStatus.STOPPING);
  });

  it("tracks the Phase 5 transcription, improvement, and insertion lifecycle without exposing text", () => {
    const sessions = createSessionStore();

    sessions.start({ id: "session-4", tabId: 44, startedAt: 1000 });
    sessions.markTargetReady("session-4", { kind: "textarea" });
    sessions.markRecording("session-4", { startedAt: 1100, mimeType: "audio/webm" });
    sessions.markStopping("session-4");

    const transcribing = sessions.markTranscribing("session-4", {
      mimeType: "audio/webm",
      sizeBytes: 4096,
      durationMs: 2000,
      capturedAt: 3000,
      dataUrl: "data:audio/webm;base64,abc"
    });

    assert.equal(transcribing.status, DictationStatus.TRANSCRIBING);
    assert.equal(transcribing.audio.dataUrl, "data:audio/webm;base64,abc");

    const improving = sessions.markTranscriptReady("session-4", {
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

    const inserting = sessions.markImprovedTextReady("session-4", {
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

    const completed = sessions.markInsertionDone("session-4", {
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
    sessions.markTargetReady("session-5", { kind: "textarea" });
    sessions.markRecording("session-5", { startedAt: 1100, mimeType: "audio/webm" });
    sessions.markStopping("session-5");
    sessions.markTranscribing("session-5", {
      mimeType: "audio/webm",
      sizeBytes: 4096,
      durationMs: 2000,
      capturedAt: 3000,
      dataUrl: "data:audio/webm;base64,abc"
    });
    sessions.markTranscriptReady("session-5", {
      transcript: "raw transcript",
      providerMeta: {
        provider: "deepgram"
      }
    });

    const inserting = sessions.markRawTranscriptFallback("session-5", {
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

    const completed = sessions.markInsertionDone("session-5", {
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
    sessions.markTargetReady("session-3", { kind: "input" });

    const waiting = sessions.markMicrophonePermissionNeeded("session-3");

    assert.equal(waiting.status, DictationStatus.WAITING_FOR_MICROPHONE);
    assert.equal(waiting.target.kind, "input");
  });

  it("rejects invalid lifecycle mutations before changing session data", () => {
    const sessions = createSessionStore();
    sessions.start({ id: "session-invalid", tabId: 55 });

    assert.throws(
      () => sessions.markStopping("session-invalid"),
      {
        code: "INVALID_SESSION_TRANSITION",
        status: DictationStatus.STARTING,
        event: DictationEvent.STOP_REQUESTED
      }
    );

    assert.equal(sessions.get().status, DictationStatus.STARTING);
    assert.equal(sessions.get().recording, null);
  });

  it("ignores mutations from a superseded session", () => {
    const sessions = createSessionStore();
    sessions.start({ id: "session-old", tabId: 70 });
    sessions.start({ id: "session-new", tabId: 71 });

    const stale = withMutedConsole(() => sessions.markTargetReady("session-old", {
      kind: "textarea"
    }));

    assert.equal(stale, null);
    assert.equal(sessions.get().id, "session-new");
    assert.equal(sessions.get().target, null);
    assert.equal(sessions.get().status, DictationStatus.STARTING);
  });

  it("ignores mutations aimed at an idle store", () => {
    const sessions = createSessionStore();

    const stale = withMutedConsole(() => sessions.fail("session-gone", {
      code: "LATE_FAILURE",
      message: "Nothing is running."
    }));

    assert.equal(stale, null);
    assert.equal(sessions.get().status, DictationStatus.IDLE);
    assert.equal(sessions.get().error, null);
  });

  it("keeps terminal sessions stable when late failures arrive", () => {
    const sessions = createSessionStore();

    sessions.start({ id: "session-terminal", tabId: 66 });
    sessions.markTargetReady("session-terminal", { kind: "textarea" });
    sessions.markRecording("session-terminal", { startedAt: 1100, mimeType: "audio/webm" });
    sessions.markStopping("session-terminal");
    sessions.markTranscribing("session-terminal", {
      mimeType: "audio/webm",
      sizeBytes: 4096,
      durationMs: 2000,
      capturedAt: 3000,
      dataUrl: "data:audio/webm;base64,abc"
    });
    sessions.markTranscriptReady("session-terminal", {
      transcript: "hello world",
      providerMeta: { provider: "deepgram" }
    });
    sessions.markImprovedTextReady("session-terminal", {
      text: "Hello world.",
      source: "llm",
      styleId: "default",
      providerMeta: { provider: "gemini" }
    });
    const completed = sessions.markInsertionDone("session-terminal", {
      method: "target",
      targetKind: "textarea",
      textLength: 12
    });

    const afterLateFailure = sessions.fail("session-terminal", {
      code: "LATE_FAILURE",
      message: "A late failure should not overwrite success."
    });

    assert.equal(afterLateFailure, completed);
    assert.equal(afterLateFailure.status, DictationStatus.SUCCESS);
    assert.equal(afterLateFailure.error, null);
  });
});

function withMutedConsole(action) {
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    return action();
  } finally {
    console.warn = originalWarn;
  }
}
