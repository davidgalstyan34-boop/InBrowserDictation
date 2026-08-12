import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DictationStatus } from "../src/shared/dictation-state.js";
import { createSessionStore } from "../src/background/session-store.js";

describe("session store", () => {
  it("tracks the Phase 2 recording lifecycle", () => {
    const sessions = createSessionStore();

    const started = sessions.start({ id: "session-1", tabId: 10, startedAt: 1000 });
    assert.equal(started.status, DictationStatus.STARTING);

    const prepared = sessions.markTargetReady({ kind: "textarea" });
    assert.equal(prepared.status, DictationStatus.RECORDING);

    const recording = sessions.markRecording({ startedAt: 1100, mimeType: "audio/webm" });
    assert.equal(recording.status, DictationStatus.RECORDING);

    const stopping = sessions.markStopping();
    assert.equal(stopping.status, DictationStatus.STOPPING);

    const completed = sessions.markRecordingReady({
      mimeType: "audio/webm",
      sizeBytes: 4096,
      durationMs: 2000,
      capturedAt: 3000,
      dataUrl: "data:audio/webm;base64,abc"
    }, 3100);

    assert.equal(completed.status, DictationStatus.SUCCESS);
    assert.deepEqual(sessions.toPublicSession().audio, {
      mimeType: "audio/webm",
      sizeBytes: 4096,
      durationMs: 2000,
      capturedAt: 3000
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
});
