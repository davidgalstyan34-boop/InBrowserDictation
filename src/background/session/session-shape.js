import { DictationEvent, DictationStatus, transitionStatus } from "../../shared/dictation-state.js";

/**
 * Defines private session/result shapes owned by the background session store.
 *
 * These helpers keep state mutations readable without mixing in public
 * redaction rules or browser-side orchestration.
 */

/**
 * Builds the canonical idle shape so every state has predictable keys.
 */
export function createIdleSession() {
  return {
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
  };
}

/**
 * Builds a fresh session after the user starts dictation.
 */
export function createStartedSession({ id, tabId, startedAt }) {
  return {
    ...createIdleSession(),
    id,
    status: transitionStatus(DictationStatus.IDLE, DictationEvent.START_REQUESTED),
    tabId,
    startedAt
  };
}

/**
 * Builds recovered recording state after MV3 service-worker suspension.
 */
export function createRecoveredRecordingSession({ recording, tabId, recoveredAt = Date.now() }) {
  return {
    ...createIdleSession(),
    id: recording.sessionId,
    status: DictationStatus.RECORDING,
    tabId,
    startedAt: recording.startedAt ?? recoveredAt,
    recording
  };
}

/**
 * Stores final output privately until the content script insertion boundary.
 */
export function createOutputText({ text, source, styleId, providerMeta }) {
  return {
    text: typeof text === "string" ? text : "",
    source,
    styleId,
    providerMeta
  };
}

/**
 * Normalizes insertion metadata reported by the content script.
 */
export function createInsertionResult(insertion) {
  return {
    method: insertion?.method ?? "unknown",
    strategy: insertion?.strategy ?? null,
    targetKind: insertion?.targetKind ?? null,
    textLength: Number.isInteger(insertion?.textLength) ? insertion.textLength : 0,
    fallbackReason: insertion?.fallbackReason ?? null
  };
}
