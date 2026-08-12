import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DictationEvent, DictationStatus, transitionStatus } from "../src/shared/dictation-state.js";

describe("dictation state transitions", () => {
  it("walks the nominal P0 pipeline", () => {
    let status = DictationStatus.IDLE;
    status = transitionStatus(status, DictationEvent.START_REQUESTED);
    assert.equal(status, DictationStatus.STARTING);
    status = transitionStatus(status, DictationEvent.TARGET_READY);
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

  it("falls through to insertion when LLM improvement fails after STT", () => {
    const status = transitionStatus(DictationStatus.IMPROVING, DictationEvent.FAILED);
    assert.equal(status, DictationStatus.INSERTING);
  });
});
