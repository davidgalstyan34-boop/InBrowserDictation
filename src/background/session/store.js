import { DictationEvent, DictationStatus, transitionStatus } from "../../shared/dictation-state.js";
import {
  createIdleSession,
  createInsertionResult,
  createOutputText,
  createRecoveredRecordingSession,
  createStartedSession
} from "./session-shape.js";
import { toPublicSession } from "./session-public-view.js";

/**
 * Owns the authoritative background session object.
 *
 * This store is intentionally synchronous. Browser API calls happen in
 * clients/controllers, while this module only applies state-machine events and
 * stores private session data needed by later lifecycle phases.
 */
export function createSessionStore() {
  let session = createIdleSession();

  return {
    get: () => session,
    start,
    markTargetReady,
    markMicrophonePermissionNeeded,
    markRecording,
    markStopping,
    markTranscribing,
    markTranscriptReady,
    markImprovedTextReady,
    markRawTranscriptFallback,
    markInsertionDone,
    recoverRecording,
    fail,
    reset,
    toPublicSession: () => toPublicSession(session)
  };

  /**
   * Creates a fresh session after the user starts dictation.
   */
  function start({ id, tabId, startedAt = Date.now() }) {
    session = createStartedSession({ id, tabId, startedAt });
    return session;
  }

  /**
   * Stores the serializable target summary returned by the content script.
   *
   * Actual DOM nodes/ranges stay in the content script because they cannot be
   * passed to the service worker and should not outlive the page context.
   */
  function markTargetReady(target) {
    session = {
      ...session,
      status: transitionStatus(session.status, DictationEvent.TARGET_READY),
      target
    };
    return session;
  }

  /**
   * Pauses startup until a visible extension page obtains microphone access.
   */
  function markMicrophonePermissionNeeded() {
    session = {
      ...session,
      status: transitionStatus(session.status, DictationEvent.MICROPHONE_PERMISSION_REQUIRED)
    };
    return session;
  }

  /**
   * Stores start metadata returned by the offscreen recorder.
   */
  function markRecording(recording) {
    session = {
      ...session,
      status: transitionStatus(session.status, DictationEvent.RECORDING_STARTED),
      recording
    };
    return session;
  }

  /**
   * Moves the session into STOPPING while the recorder finalizes chunks.
   */
  function markStopping() {
    session = {
      ...session,
      status: transitionStatus(session.status, DictationEvent.STOP_REQUESTED)
    };
    return session;
  }

  /**
   * Stores final audio and advances into transcription work.
   *
   * The private session keeps the data URL for the STT provider; public session
   * snapshots expose only audio metadata.
   */
  function markTranscribing(audio) {
    session = {
      ...session,
      status: transitionStatus(session.status, DictationEvent.STOPPED),
      audio
    };
    return session;
  }

  /**
   * Stores the transcript privately and advances into text improvement.
   */
  function markTranscriptReady(transcription, completedAt = Date.now()) {
    session = {
      ...session,
      status: transitionStatus(session.status, DictationEvent.TRANSCRIPT_READY),
      transcription,
      completedAt
    };
    return session;
  }

  /**
   * Stores improved text privately and advances into insertion.
   */
  function markImprovedTextReady(improvement, completedAt = Date.now()) {
    session = {
      ...session,
      status: transitionStatus(session.status, DictationEvent.IMPROVED_TEXT_READY),
      improvement,
      outputText: createOutputText({
        text: improvement?.text,
        source: improvement?.source ?? "llm",
        styleId: improvement?.styleId ?? null,
        providerMeta: improvement?.providerMeta ?? null
      }),
      completedAt,
      warning: null
    };
    return session;
  }

  /**
   * Advances insertion with the raw transcript when LLM improvement fails.
   */
  function markRawTranscriptFallback(error, completedAt = Date.now()) {
    const transcript = session.transcription?.transcript ?? "";
    session = {
      ...session,
      status: transitionStatus(session.status, DictationEvent.IMPROVEMENT_FAILED_WITH_FALLBACK),
      outputText: createOutputText({
        text: transcript,
        source: "raw-transcript",
        styleId: "raw",
        providerMeta: session.transcription?.providerMeta ?? null
      }),
      completedAt,
      warning: {
        code: error?.code ?? "LLM_FAILED",
        message: error?.message ?? "Text improvement failed. The raw transcript is still available."
      }
    };
    return session;
  }

  /**
   * Stores insertion metadata after content-side target insertion or fallback.
   */
  function markInsertionDone(insertion, completedAt = Date.now()) {
    session = {
      ...session,
      status: transitionStatus(session.status, DictationEvent.INSERTION_DONE),
      insertion: createInsertionResult(insertion),
      completedAt
    };
    return session;
  }

  /**
   * Rebuilds enough session state to stop an already-active offscreen recorder
   * after service-worker suspension.
   */
  function recoverRecording({ recording, tabId }) {
    session = createRecoveredRecordingSession({ recording, tabId });
    return session;
  }

  /**
   * Records a normalized user-facing failure on the active session.
   */
  function fail(error) {
    session = {
      ...session,
      status: DictationStatus.ERROR,
      error
    };
    return session;
  }

  /**
   * Clears transient session data so a new shortcut starts a fresh session.
   */
  function reset() {
    session = createIdleSession();
    return session;
  }
}
