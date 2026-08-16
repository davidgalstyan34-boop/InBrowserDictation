import {
  DictationEvent,
  DictationStatus,
  transitionStatus
} from "../../shared/dictation-state.js";
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
 *
 * Every mutator takes the id of the session it believes it is advancing and
 * returns `null` when that session has already been replaced. Lifecycle flows
 * are long chains of awaits, so a late callback from a superseded session must
 * not mutate its successor. Callers treat `null` as "stop quietly", not as an
 * error: the work was simply abandoned.
 */
export function createSessionStore({ onChange = () => {} } = {}) {
  let session = createIdleSession();

  const mutators = {
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
    reset
  };

  return {
    get: () => session,
    ...notifyAfterEach(mutators, () => onChange(session)),
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
  function markTargetReady(sessionId, target) {
    if (!ownsSession(sessionId, "markTargetReady")) {
      return null;
    }

    const status = nextStatus(DictationEvent.TARGET_READY);
    session = {
      ...session,
      status,
      target
    };
    return session;
  }

  /**
   * Pauses startup until a visible extension page obtains microphone access.
   */
  function markMicrophonePermissionNeeded(sessionId) {
    if (!ownsSession(sessionId, "markMicrophonePermissionNeeded")) {
      return null;
    }

    const status = nextStatus(DictationEvent.MICROPHONE_PERMISSION_REQUIRED);
    session = {
      ...session,
      status
    };
    return session;
  }

  /**
   * Stores start metadata returned by the offscreen recorder.
   */
  function markRecording(sessionId, recording) {
    if (!ownsSession(sessionId, "markRecording")) {
      return null;
    }

    const status = nextStatus(DictationEvent.RECORDING_STARTED);
    session = {
      ...session,
      status,
      recording
    };
    return session;
  }

  /**
   * Moves the session into STOPPING while the recorder finalizes chunks.
   */
  function markStopping(sessionId) {
    if (!ownsSession(sessionId, "markStopping")) {
      return null;
    }

    const status = nextStatus(DictationEvent.STOP_REQUESTED);
    session = {
      ...session,
      status
    };
    return session;
  }

  /**
   * Stores final audio and advances into transcription work.
   *
   * The private session keeps the data URL for the STT provider; public session
   * snapshots expose only audio metadata.
   */
  function markTranscribing(sessionId, audio) {
    if (!ownsSession(sessionId, "markTranscribing")) {
      return null;
    }

    const status = nextStatus(DictationEvent.STOPPED);
    session = {
      ...session,
      status,
      audio
    };
    return session;
  }

  /**
   * Stores the transcript privately and advances into text improvement.
   */
  function markTranscriptReady(sessionId, transcription, updatedAt = Date.now()) {
    if (!ownsSession(sessionId, "markTranscriptReady")) {
      return null;
    }

    const status = nextStatus(DictationEvent.TRANSCRIPT_READY);
    session = {
      ...session,
      status,
      transcription,
      updatedAt
    };
    return session;
  }

  /**
   * Stores improved text privately and advances into insertion.
   */
  function markImprovedTextReady(sessionId, improvement, updatedAt = Date.now()) {
    if (!ownsSession(sessionId, "markImprovedTextReady")) {
      return null;
    }

    const status = nextStatus(DictationEvent.IMPROVED_TEXT_READY);
    session = {
      ...session,
      status,
      improvement,
      outputText: createOutputText({
        text: improvement?.text,
        source: improvement?.source ?? "llm",
        styleId: improvement?.styleId ?? null,
        providerMeta: improvement?.providerMeta ?? null
      }),
      updatedAt,
      warning: null
    };
    return session;
  }

  /**
   * Advances insertion with the raw transcript when LLM improvement fails.
   */
  function markRawTranscriptFallback(sessionId, error, updatedAt = Date.now()) {
    if (!ownsSession(sessionId, "markRawTranscriptFallback")) {
      return null;
    }

    const status = nextStatus(DictationEvent.IMPROVEMENT_FAILED_WITH_FALLBACK);
    const transcript = session.transcription?.transcript ?? "";
    session = {
      ...session,
      status,
      outputText: createOutputText({
        text: transcript,
        source: "raw-transcript",
        styleId: "raw",
        providerMeta: session.transcription?.providerMeta ?? null
      }),
      updatedAt,
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
  function markInsertionDone(sessionId, insertion, updatedAt = Date.now()) {
    if (!ownsSession(sessionId, "markInsertionDone")) {
      return null;
    }

    const status = nextStatus(DictationEvent.INSERTION_DONE);
    session = {
      ...session,
      status,
      insertion: createInsertionResult(insertion),
      updatedAt
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
   *
   * A failure that arrives after the session already reached SUCCESS or ERROR
   * is kept but not reapplied, so the first terminal reason is the one the user
   * sees.
   */
  function fail(sessionId, error) {
    if (!ownsSession(sessionId, "fail")) {
      return null;
    }

    if (isTerminalStatus(session.status)) {
      return session;
    }

    const status = nextStatus(DictationEvent.FAILED);
    session = {
      ...session,
      status,
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

  function nextStatus(event) {
    return transitionStatus(session.status, event);
  }

  /**
   * Reports whether the caller is still advancing the current session.
   */
  function ownsSession(sessionId, mutation) {
    if (sessionId && session.id === sessionId) {
      return true;
    }

    console.warn("[In-Browser Dictation] Ignoring a mutation from a superseded session.", {
      mutation,
      requestedSessionId: sessionId ?? null,
      currentSessionId: session.id
    });
    return false;
  }
}

function isTerminalStatus(status) {
  return status === DictationStatus.SUCCESS || status === DictationStatus.ERROR;
}

/**
 * Wraps every mutator so state observers see each committed change.
 *
 * A single hook here keeps lifecycle flows from having to remember to announce
 * their own transitions, which is the kind of bookkeeping that rots.
 */
function notifyAfterEach(mutators, notify) {
  return Object.fromEntries(
    Object.entries(mutators).map(([name, mutate]) => [
      name,
      (...args) => {
        const result = mutate(...args);
        notify();
        return result;
      }
    ])
  );
}
