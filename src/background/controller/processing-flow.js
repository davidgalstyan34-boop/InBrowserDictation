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
  speechToText,
  textImprovement,
  sessions
}) {
  return {
    processStoppedRecording
  };

  /**
   * Transcribes stopped audio, improves text, and inserts final output.
   */
  async function processStoppedRecording(audio) {
    const transcribingSession = sessions.markTranscribing(audio);
    await showTranscribingState(content, transcribingSession);

    const transcription = await speechToText.transcribe({
      audio: transcribingSession.audio
    });
    const improvingSession = sessions.markTranscriptReady(transcription);

    await showImprovingState(content, improvingSession);
    await improveTextForCurrentSession(improvingSession);
  }

  /**
   * Runs text improvement, then inserts improved text or raw fallback text.
   */
  async function improveTextForCurrentSession(session) {
    let insertingSession = null;

    try {
      const improvement = await textImprovement.improveText({
        text: session.transcription?.transcript ?? ""
      });
      insertingSession = sessions.markImprovedTextReady(improvement);

    } catch (error) {
      console.warn("[In-Browser Dictation] Text improvement failed; using raw transcript.", {
        sessionId: session.id,
        code: error.code || "LLM_FAILED",
        message: error.message
      });

      insertingSession = sessions.markRawTranscriptFallback(error);
    }

    await showInsertionReadyState(content, insertingSession);
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
    await showInsertionCompleteState(content, completedSession);
  }
}
