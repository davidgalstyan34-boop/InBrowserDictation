import { toError } from "../utils/errors.js";
import {
  showImprovingState,
  showInsertionCompleteState,
  showInsertionReadyState,
  showTranscribingState
} from "./overlay-feedback.js";

/**
 * Owns the stopped-audio to final-insertion pipeline.
 *
 * Recording has already stopped before this flow runs. Provider details stay in
 * delegated clients, while this module applies transcription, improvement, raw
 * transcript fallback, and insertion ordering.
 */
export function createProcessingFlow({
  content,
  recentResults = null,
  speechToText,
  textImprovement,
  sessions
}) {
  let activeRequestController = null;

  return {
    abortActiveRequest,
    processStoppedRecording
  };

  /**
   * Aborts active provider work when the owning tab closes or the session ends.
   */
  function abortActiveRequest() {
    activeRequestController?.abort();
  }

  /**
   * Transcribes stopped audio, improves text, and inserts final output.
   */
  async function processStoppedRecording(sessionId, audio) {
    const requestController = new AbortController();
    activeRequestController = requestController;

    try {
      const transcribingSession = sessions.markTranscribing(sessionId, audio);
      if (!transcribingSession) {
        return;
      }

      await showTranscribingState(content, transcribingSession);

      const transcription = await speechToText.transcribe({
        audio: transcribingSession.audio,
        signal: requestController.signal
      });
      throwIfProcessingAborted(requestController.signal);

      const improvingSession = sessions.markTranscriptReady(sessionId, transcription);
      if (!improvingSession) {
        return;
      }

      await showImprovingState(content, improvingSession);
      await improveTextForCurrentSession(improvingSession, requestController.signal);
    } finally {
      if (activeRequestController === requestController) {
        activeRequestController = null;
      }
    }
  }

  /**
   * Runs text improvement, then inserts improved text or raw fallback text.
   */
  async function improveTextForCurrentSession(session, signal) {
    let insertingSession = null;

    try {
      const improvement = await textImprovement.improveText({
        text: session.transcription?.transcript ?? "",
        signal
      });
      throwIfProcessingAborted(signal);

      insertingSession = sessions.markImprovedTextReady(session.id, improvement);

    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }

      console.warn("[In-Browser Dictation] Text improvement failed; using raw transcript.", {
        sessionId: session.id,
        code: error.code || "LLM_FAILED",
        message: error.message,
        providerStatus: error.providerStatus,
        providerErrorStatus: error.providerErrorStatus,
        providerErrorCode: error.providerErrorCode,
        providerModel: error.providerModel,
        requestShape: error.requestShape
      });

      insertingSession = sessions.markRawTranscriptFallback(session.id, error);
    }

    if (!insertingSession) {
      return;
    }

    await showInsertionReadyState(content, insertingSession);
    throwIfProcessingAborted(signal);

    // Store the result before attempting insertion. Insertion can fail in ways
    // that cannot be retried from the page, and nothing else in the extension
    // holds this text: overlays deliberately never echo it.
    const savedResult = await saveRecentResult(insertingSession);
    await insertOutputTextForCurrentSession(insertingSession, Boolean(savedResult));
  }

  /**
   * Sends private final text to the captured page target and completes insertion.
   */
  async function insertOutputTextForCurrentSession(session, isRecoverable) {
    const insertionResponse = await content.insertText(
      session.tabId,
      session.id,
      session.outputText?.text ?? ""
    );

    if (!insertionResponse?.ok) {
      throw withRecoveryHint(
        toError(insertionResponse?.error, "Text could not be inserted."),
        isRecoverable
      );
    }

    const completedSession = sessions.markInsertionDone(session.id, insertionResponse.insertion);
    if (!completedSession) {
      return;
    }

    await showInsertionCompleteState(content, completedSession);
  }

  async function saveRecentResult(session) {
    if (!recentResults?.saveFromSession) {
      return null;
    }

    try {
      return await recentResults.saveFromSession(session);
    } catch (error) {
      console.warn("[In-Browser Dictation] Could not save recent result.", error);
      return null;
    }
  }
}

/**
 * Tells the user where the text went when it could not reach the page.
 */
function withRecoveryHint(error, isRecoverable) {
  if (!isRecoverable) {
    return error;
  }

  error.message = `${error.message} Open the extension popup to copy it.`;
  return error;
}

function throwIfProcessingAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("Dictation processing was cancelled.");
  error.code = "DICTATION_PROCESSING_CANCELLED";
  throw error;
}
