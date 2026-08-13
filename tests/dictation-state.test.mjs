import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DictationEvent, DictationStatus, transitionStatus } from "../src/shared/dictation-state.js";

describe("dictation state transitions", () => {
  it("walks the current Phase 5 pipeline", () => {
    let status = DictationStatus.IDLE;
    status = transitionStatus(status, DictationEvent.START_REQUESTED);
    assert.equal(status, DictationStatus.STARTING);
    status = transitionStatus(status, DictationEvent.TARGET_READY);
    assert.equal(status, DictationStatus.STARTING);
    status = transitionStatus(status, DictationEvent.RECORDING_STARTED);
    assert.equal(status, DictationStatus.RECORDING);
    status = transitionStatus(status, DictationEvent.STOP_REQUESTED);
    assert.equal(status, DictationStatus.STOPPING);
    status = transitionStatus(status, DictationEvent.STOPPED);
    assert.equal(status, DictationStatus.TRANSCRIBING);
    status = transitionStatus(status, DictationEvent.TRANSCRIPT_READY);
    assert.equal(status, DictationStatus.IMPROVING);
    status = transitionStatus(status, DictationEvent.IMPROVED_TEXT_READY);
    assert.equal(status, DictationStatus.INSERTING);
    status = transitionStatus(status, DictationEvent.INSERTION_DONE);
    assert.equal(status, DictationStatus.SUCCESS);
  });

  it("completes after insertion work finishes", () => {
    let status = DictationStatus.INSERTING;
    status = transitionStatus(status, DictationEvent.INSERTION_DONE);
    assert.equal(status, DictationStatus.SUCCESS);
  });

  it("routes raw transcript fallback into insertion when LLM improvement fails after STT", () => {
    const status = transitionStatus(
      DictationStatus.IMPROVING,
      DictationEvent.IMPROVEMENT_FAILED_WITH_FALLBACK
    );
    assert.equal(status, DictationStatus.INSERTING);
  });

  it("routes non-fallback improvement failures to error", () => {
    const status = transitionStatus(DictationStatus.IMPROVING, DictationEvent.FAILED);
    assert.equal(status, DictationStatus.ERROR);
  });

  it("can wait for visible microphone permission during startup", () => {
    const status = transitionStatus(
      DictationStatus.STARTING,
      DictationEvent.MICROPHONE_PERMISSION_REQUIRED
    );

    assert.equal(status, DictationStatus.WAITING_FOR_MICROPHONE);
  });

  it("starts recording after visible microphone permission succeeds", () => {
    const status = transitionStatus(
      DictationStatus.WAITING_FOR_MICROPHONE,
      DictationEvent.RECORDING_STARTED
    );

    assert.equal(status, DictationStatus.RECORDING);
  });

  it("rejects invalid transitions", () => {
    assert.throws(
      () => transitionStatus(DictationStatus.IDLE, DictationEvent.STOP_REQUESTED),
      {
        code: "INVALID_SESSION_TRANSITION",
        status: DictationStatus.IDLE,
        event: DictationEvent.STOP_REQUESTED
      }
    );
  });
});
