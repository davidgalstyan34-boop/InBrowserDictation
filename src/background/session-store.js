import { DictationEvent, DictationStatus, transitionStatus } from "../shared/dictation-state.js";

/**
 * Owns the authoritative background session object.
 *
 * This store is intentionally small and synchronous. Browser API calls happen
 * in clients/controllers, while this module only applies state-machine events
 * and shapes the public session snapshot.
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
    markRecordingReady,
    recoverRecording,
    fail,
    reset,
    toPublicSession: () => toPublicSession(session)
  };

  /**
   * Creates a fresh session after the user starts dictation.
   */
  function start({ id, tabId, startedAt = Date.now() }) {
    session = {
      ...createIdleSession(),
      id,
      status: transitionStatus(DictationStatus.IDLE, DictationEvent.START_REQUESTED),
      tabId,
      startedAt
    };
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
      status: DictationStatus.RECORDING,
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
   * Stores the final audio payload for Phase 2.
   *
   * The private session may contain a data URL for Phase 3 provider work; the
   * public snapshot below deliberately exposes only metadata.
   */
  function markRecordingReady(audio, completedAt = Date.now()) {
    session = {
      ...session,
      status: transitionStatus(session.status, DictationEvent.RECORDING_READY),
      audio,
      completedAt
    };
    return session;
  }

  /**
   * Rebuilds enough session state to stop an already-active offscreen recorder
   * after service-worker suspension.
   */
  function recoverRecording({ recording, tabId }) {
    session = {
      ...createIdleSession(),
      id: recording.sessionId,
      status: DictationStatus.RECORDING,
      tabId,
      startedAt: recording.startedAt ?? Date.now(),
      recording
    };
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
    completedAt: null,
    error: null
  };
}

/**
 * Produces the session shape that UI or diagnostics can request.
 *
 * Large or sensitive audio data is excluded. Phase 3 provider code should use
 * the private in-memory session, not this public projection.
 */
export function toPublicSession(session) {
  return {
    id: session.id,
    status: session.status,
    tabId: session.tabId,
    startedAt: session.startedAt,
    target: session.target,
    recording: session.recording,
    audio: toPublicAudio(session.audio),
    completedAt: session.completedAt,
    error: session.error
  };
}

function toPublicAudio(audio) {
  if (!audio) {
    return null;
  }

  return {
    mimeType: audio.mimeType,
    sizeBytes: audio.sizeBytes,
    durationMs: audio.durationMs,
    capturedAt: audio.capturedAt
  };
}
