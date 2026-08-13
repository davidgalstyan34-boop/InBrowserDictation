import { toError } from "../errors.js";
import {
  showImprovingState,
  showInsertionCompleteState,
  showInsertionReadyState,
  showStoppingState,
  showTranscribingState
} from "./overlay-feedback.js";

/**
 * Owns the stop-recording to final-insertion pipeline.
 *
 * Recorder ownership ends as soon as audio is serialized. Provider details stay
 * in delegated clients, while this flow applies the lifecycle ordering.
 */
export function createProcessingFlow({
  content,
  recorder,
  speechToText,
  textImprovement,
  sessions,
  failSession
}) {
  return {
    stopDictationSession
  };

  /**
   * Stops recording, transcribes audio, improves text, and inserts final output.
   */
  async function stopDictationSession() {
    const session = sessions.markStopping();
    console.info("[In-Browser Dictation] Stopping session.", {
      sessionId: session.id,
      tabId: session.tabId
    });

    await showStoppingState(content, session);

    try {
      const recordingResponse = await recorder.stop(session.id);
      if (!recordingResponse?.ok) {
        throw toError(recordingResponse?.error, "Audio recording could not stop.");
      }

      await recorder.close();

      const transcribingSession = sessions.markTranscribing(recordingResponse.audio ?? null);
      await showTranscribingState(content, transcribingSession);

      const transcription = await speechToText.transcribe({
        audio: transcribingSession.audio
      });
      const improvingSession = sessions.markTranscriptReady(transcription);

      await showImprovingState(content, improvingSession);
      await improveTextForCurrentSession(improvingSession);
    } catch (error) {
      console.error("[In-Browser Dictation] Stop failed.", error);
      await failSession(error.code || "DICTATION_STOP_FAILED", error.message);
    } finally {
      await recorder.close();
    }
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
