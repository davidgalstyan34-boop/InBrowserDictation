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
  async function processStoppedRecording(audio) {
    const requestController = new AbortController();
    activeRequestController = requestController;

    try {
      const transcribingSession = sessions.markTranscribing(audio);
      await showTranscribingState(content, transcribingSession);

      const transcription = await speechToText.transcribe({
        audio: transcribingSession.audio,
        signal: requestController.signal
      });
      throwIfProcessingAborted(requestController.signal);

      const improvingSession = sessions.markTranscriptReady(transcription);
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

      insertingSession = sessions.markImprovedTextReady(improvement);

    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }

      console.warn("[In-Browser Dictation] Text improvement failed; using raw transcript.", {
        sessionId: session.id,
        code: error.code || "LLM_FAILED",
        message: error.message
      });

      insertingSession = sessions.markRawTranscriptFallback(error);
    }

    await showInsertionReadyState(content, insertingSession);
    throwIfProcessingAborted(signal);
    await insertOutputTextForCurrentSession(insertingSession);
  }

  /**
   * Sends private final text to the captured page target and completes insertion.
   */
  async function insertOutputTextForCurrentSession(session) {
    const insertionResponse = await content.insertText(
      session.tabId,
      session.id,
      session.outputText?.text ?? ""
    );

    if (!insertionResponse?.ok) {
      throw toError(insertionResponse?.error, "Text could not be inserted.");
    }

    const completedSession = sessions.markInsertionDone(insertionResponse.insertion);
    await saveRecentResult(completedSession);
    await showInsertionCompleteState(content, completedSession);
  }

  async function saveRecentResult(session) {
    if (!recentResults?.saveFromSession) {
      return;
    }

    try {
      await recentResults.saveFromSession(session);
    } catch (error) {
      console.warn("[In-Browser Dictation] Could not save recent result.", error);
    }
  }
}

function throwIfProcessingAborted(signal) {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("Dictation processing was cancelled.");
  error.code = "DICTATION_PROCESSING_CANCELLED";
  throw error;
}
