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
  RECORDING_STARTED: "RECORDING_STARTED",
  MICROPHONE_PERMISSION_REQUIRED: "MICROPHONE_PERMISSION_REQUIRED",
  STOP_REQUESTED: "STOP_REQUESTED",
  STOPPED: "STOPPED",
  TRANSCRIPT_READY: "TRANSCRIPT_READY",
  IMPROVED_TEXT_READY: "IMPROVED_TEXT_READY",
  IMPROVEMENT_FAILED_WITH_FALLBACK: "IMPROVEMENT_FAILED_WITH_FALLBACK",
  INSERTION_DONE: "INSERTION_DONE",
  FAILED: "FAILED",
  RESET: "RESET"
});

const transitionTable = Object.freeze({
  [DictationStatus.IDLE]: {
    [DictationEvent.START_REQUESTED]: DictationStatus.STARTING
  },
  [DictationStatus.STARTING]: {
    [DictationEvent.TARGET_READY]: DictationStatus.STARTING,
    [DictationEvent.RECORDING_STARTED]: DictationStatus.RECORDING,
    [DictationEvent.MICROPHONE_PERMISSION_REQUIRED]: DictationStatus.WAITING_FOR_MICROPHONE,
    [DictationEvent.FAILED]: DictationStatus.ERROR,
    [DictationEvent.RESET]: DictationStatus.IDLE
  },
  [DictationStatus.WAITING_FOR_MICROPHONE]: {
    [DictationEvent.RECORDING_STARTED]: DictationStatus.RECORDING,
    [DictationEvent.FAILED]: DictationStatus.ERROR,
    [DictationEvent.RESET]: DictationStatus.IDLE
  },
  [DictationStatus.RECORDING]: {
    [DictationEvent.MICROPHONE_PERMISSION_REQUIRED]: DictationStatus.WAITING_FOR_MICROPHONE,
    [DictationEvent.STOP_REQUESTED]: DictationStatus.STOPPING,
    [DictationEvent.FAILED]: DictationStatus.ERROR
  },
  [DictationStatus.STOPPING]: {
    [DictationEvent.STOPPED]: DictationStatus.TRANSCRIBING,
    [DictationEvent.FAILED]: DictationStatus.ERROR,
    [DictationEvent.RESET]: DictationStatus.IDLE
  },
  [DictationStatus.TRANSCRIBING]: {
    [DictationEvent.TRANSCRIPT_READY]: DictationStatus.IMPROVING,
    [DictationEvent.FAILED]: DictationStatus.ERROR
  },
  [DictationStatus.IMPROVING]: {
    [DictationEvent.IMPROVED_TEXT_READY]: DictationStatus.INSERTING,
    [DictationEvent.IMPROVEMENT_FAILED_WITH_FALLBACK]: DictationStatus.INSERTING,
    [DictationEvent.FAILED]: DictationStatus.ERROR
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
 */
export function transitionStatus(status, event) {
  const nextStatus = transitionTable[status]?.[event];
  if (nextStatus) {
    return nextStatus;
  }

  throw createInvalidTransitionError(status, event);
}

function createInvalidTransitionError(status, event) {
  const error = new Error(`Invalid dictation session transition: ${status} -> ${event}.`);
  error.code = "INVALID_SESSION_TRANSITION";
  error.status = status;
  error.event = event;
  return error;
}
