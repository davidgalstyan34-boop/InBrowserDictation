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
   * Stores final audio and advances into Phase 3 transcription work.
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
   * Stores improved text privately and advances into Phase 5 insertion.
   *
   * Public snapshots expose only length/source metadata so transcript and
   * improved text do not leak to passive UI polling.
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
   * Advances Phase 5 with the raw transcript when LLM improvement fails.
   */
  function markRawTranscriptFallback(error, completedAt = Date.now()) {
    const transcript = session.transcription?.transcript ?? "";
    session = {
      ...session,
      status: transitionStatus(session.status, DictationEvent.FAILED),
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
    transcription: null,
    improvement: null,
    outputText: null,
    insertion: null,
    completedAt: null,
    warning: null,
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
    transcription: toPublicTranscription(session.transcription),
    improvement: toPublicImprovement(session.improvement),
    outputText: toPublicOutputText(session.outputText),
    insertion: toPublicInsertion(session.insertion),
    completedAt: session.completedAt,
    warning: session.warning,
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

function toPublicTranscription(transcription) {
  if (!transcription) {
    return null;
  }

  return {
    textLength: typeof transcription.transcript === "string" ? transcription.transcript.length : 0,
    providerMeta: transcription.providerMeta ?? null
  };
}

function createOutputText({ text, source, styleId, providerMeta }) {
  return {
    text: typeof text === "string" ? text : "",
    source,
    styleId,
    providerMeta
  };
}

function toPublicImprovement(improvement) {
  if (!improvement) {
    return null;
  }

  return {
    textLength: typeof improvement.text === "string" ? improvement.text.length : 0,
    source: improvement.source ?? "llm",
    styleId: improvement.styleId ?? null,
    providerMeta: improvement.providerMeta ?? null
  };
}

function toPublicOutputText(outputText) {
  if (!outputText) {
    return null;
  }

  return {
    textLength: typeof outputText.text === "string" ? outputText.text.length : 0,
    source: outputText.source,
    styleId: outputText.styleId,
    providerMeta: outputText.providerMeta ?? null
  };
}

function createInsertionResult(insertion) {
  return {
    method: insertion?.method ?? "unknown",
    strategy: insertion?.strategy ?? null,
    targetKind: insertion?.targetKind ?? null,
    textLength: Number.isInteger(insertion?.textLength) ? insertion.textLength : 0,
    fallbackReason: insertion?.fallbackReason ?? null
  };
}

function toPublicInsertion(insertion) {
  if (!insertion) {
    return null;
  }

  return {
    method: insertion.method,
    strategy: insertion.strategy,
    targetKind: insertion.targetKind,
    textLength: insertion.textLength,
    fallbackReason: insertion.fallbackReason
  };
}
