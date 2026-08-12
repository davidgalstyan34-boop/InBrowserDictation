export const DictationStatus = Object.freeze({
  IDLE: "IDLE",
  STARTING: "STARTING",
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
  STOP_REQUESTED: "STOP_REQUESTED",
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
    [DictationEvent.FAILED]: DictationStatus.ERROR,
    [DictationEvent.RESET]: DictationStatus.IDLE
  },
  [DictationStatus.RECORDING]: {
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

export function transitionStatus(status, event) {
  return transitionTable[status]?.[event] ?? status;
}

export function canAcceptStart(status) {
  return status === DictationStatus.IDLE;
}

export function canAcceptStop(status) {
  return status === DictationStatus.RECORDING;
}
