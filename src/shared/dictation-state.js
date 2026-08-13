/**
 * Shared dictation state machine vocabulary.
 *
 * The service worker owns the active state, while content and offscreen
 * contexts receive state updates through messages. Keeping statuses/events in
 * one module avoids string drift as later phases add STT, LLM, and insertion.
 */
export const DictationStatus = Object.freeze({
  IDLE: "IDLE",
  STARTING: "STARTING",
  WAITING_FOR_MICROPHONE: "WAITING_FOR_MICROPHONE",
  RECORDING: "RECORDING",
  STOPPING: "STOPPING",
  TRANSCRIBING: "TRANSCRIBING",
  IMPROVING: "IMPROVING",
  INSERTING: "INSERTING",
  SUCCESS: "SUCCESS",
  ERROR: "ERROR"
});

export const DictationEvent = Object.freeze({
  START_REQUESTED: "START_REQUESTED",
  TARGET_READY: "TARGET_READY",
  MICROPHONE_PERMISSION_REQUIRED: "MICROPHONE_PERMISSION_REQUIRED",
  STOP_REQUESTED: "STOP_REQUESTED",
  RECORDING_READY: "RECORDING_READY",
  STOPPED: "STOPPED",
  TRANSCRIPT_READY: "TRANSCRIPT_READY",
  IMPROVED_TEXT_READY: "IMPROVED_TEXT_READY",
  INSERTION_DONE: "INSERTION_DONE",
  FAILED: "FAILED",
  RESET: "RESET"
});

const transitionTable = Object.freeze({
  [DictationStatus.IDLE]: {
    [DictationEvent.START_REQUESTED]: DictationStatus.STARTING
  },
  [DictationStatus.STARTING]: {
    [DictationEvent.TARGET_READY]: DictationStatus.RECORDING,
    [DictationEvent.MICROPHONE_PERMISSION_REQUIRED]: DictationStatus.WAITING_FOR_MICROPHONE,
    [DictationEvent.FAILED]: DictationStatus.ERROR,
    [DictationEvent.RESET]: DictationStatus.IDLE
  },
  [DictationStatus.WAITING_FOR_MICROPHONE]: {
    [DictationEvent.FAILED]: DictationStatus.ERROR,
    [DictationEvent.RESET]: DictationStatus.IDLE
  },
  [DictationStatus.RECORDING]: {
    [DictationEvent.MICROPHONE_PERMISSION_REQUIRED]: DictationStatus.WAITING_FOR_MICROPHONE,
    [DictationEvent.STOP_REQUESTED]: DictationStatus.STOPPING,
    [DictationEvent.FAILED]: DictationStatus.ERROR
  },
  [DictationStatus.STOPPING]: {
    // Phase 2 completes once a usable audio blob exists. Later phases should
    // use STOPPED to continue into STT without changing the recording module.
    [DictationEvent.RECORDING_READY]: DictationStatus.SUCCESS,
    [DictationEvent.STOPPED]: DictationStatus.TRANSCRIBING,
    [DictationEvent.FAILED]: DictationStatus.ERROR,
    [DictationEvent.RESET]: DictationStatus.IDLE
  },
  [DictationStatus.TRANSCRIBING]: {
    // Phase 3 completes once STT returns a transcript. Phase 4 should route
    // this event into IMPROVING when the LLM provider is implemented.
    [DictationEvent.TRANSCRIPT_READY]: DictationStatus.SUCCESS,
    [DictationEvent.FAILED]: DictationStatus.ERROR
  },
  [DictationStatus.IMPROVING]: {
    [DictationEvent.IMPROVED_TEXT_READY]: DictationStatus.INSERTING,
    [DictationEvent.FAILED]: DictationStatus.INSERTING
  },
  [DictationStatus.INSERTING]: {
    [DictationEvent.INSERTION_DONE]: DictationStatus.SUCCESS,
    [DictationEvent.FAILED]: DictationStatus.ERROR
  },
  [DictationStatus.SUCCESS]: {
    [DictationEvent.RESET]: DictationStatus.IDLE
  },
  [DictationStatus.ERROR]: {
    [DictationEvent.RESET]: DictationStatus.IDLE
  }
});

/**
 * Applies one state-machine event to the current status.
 *
 * Unknown transitions intentionally leave the status unchanged. That lets the
 * controller safely ignore repeated shortcut presses during busy states.
 */
export function transitionStatus(status, event) {
  return transitionTable[status]?.[event] ?? status;
}
