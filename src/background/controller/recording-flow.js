import { isMicrophonePermissionError } from "../../shared/audio-recording.js";
import { toError } from "../errors.js";
import {
  showMicrophoneAccessGrantedState,
  showMicrophonePermissionNeededState,
  showRecordingState,
  showStartingState
} from "./overlay-feedback.js";

/**
 * Owns recording startup, permission retry, and MV3 recorder recovery.
 *
 * The content script captures insertion targets, while this flow coordinates
 * active-tab selection and offscreen-recorder startup for the service worker.
 */
export function createRecordingFlow({
  content,
  microphonePermission,
  recorder,
  sessions,
  cryptoApi,
  failSession
}) {
  return {
    handleMicrophonePermissionResult,
    recoverActiveRecording,
    startDictationSession
  };

  /**
   * Starts a new session and asks the offscreen document to record audio.
   */
  async function startDictationSession({ tab: commandTab } = {}) {
    const tab = commandTab ?? await content.getActiveTab();
    const session = sessions.start({
      id: cryptoApi.randomUUID(),
      tabId: tab?.id ?? null
    });

    console.info("[In-Browser Dictation] Starting session.", {
      sessionId: session.id,
      tabId: session.tabId
    });

    if (!tab?.id) {
      await failSession("NO_ACTIVE_TAB", "No active tab is available for dictation.");
      return;
    }

    try {
      await showStartingState(content, session);

      const prepareResponse = await content.prepareDictation(tab.id, session.id);
      if (!prepareResponse?.ok) {
        throw toError(prepareResponse?.error, "The page could not prepare for dictation.");
      }

      const preparedSession = sessions.markTargetReady(prepareResponse.target ?? null);
      await startRecorderForCurrentSession(preparedSession);
    } catch (error) {
      console.error("[In-Browser Dictation] Start failed.", error);
      await recorder.close();

      if (isMicrophonePermissionError(error)) {
        await requestMicrophonePermission();
        return;
      }

      await failSession(error.code || "DICTATION_START_FAILED", error.message);
    }
  }

  /**
   * Handles the result sent by the visible microphone permission page.
   */
  function handleMicrophonePermissionResult({ message, sendResponse }) {
    processMicrophonePermissionResult(message)
      .then((response) => sendResponse(response))
      .catch((error) => {
        console.error("[In-Browser Dictation] Microphone permission result failed.", error);
        sendResponse({
          ok: false,
          error: {
            code: error.code || "MICROPHONE_PERMISSION_RESULT_FAILED",
            message: error.message
          }
        });
      });

    return true;
  }

  /**
   * Rehydrates service-worker state from an already-open offscreen recorder.
   */
  async function recoverActiveRecording() {
    const recording = await recorder.getActiveRecording();
    if (!recording) {
      return false;
    }

    let recoveredTabId = Number.isInteger(recording.tabId) ? recording.tabId : null;
    if (!Number.isInteger(recoveredTabId)) {
      const tab = await content.getActiveTab();
      recoveredTabId = tab?.id ?? null;
    }

    console.info("[In-Browser Dictation] Recovered active offscreen recording.", {
      sessionId: recording.sessionId,
      tabId: recoveredTabId
    });

    sessions.recoverRecording({
      recording,
      tabId: recoveredTabId
    });
    return true;
  }

  /**
   * Requests microphone permission from a visible extension page.
   */
  async function requestMicrophonePermission() {
    const session = sessions.markMicrophonePermissionNeeded();

    await showMicrophonePermissionNeededState(content, session);
    await microphonePermission.openPermissionWindow(session.id);
  }

  /**
   * Retries recording after the visible permission page grants microphone access.
   */
  async function processMicrophonePermissionResult(message) {
    const session = sessions.get();

    if (!message.sessionId || message.sessionId !== session.id) {
      return { ok: false, ignored: true };
    }

    if (!message.payload.granted) {
      await failSession(
        message.payload.error?.code || "MICROPHONE_PERMISSION_DENIED",
        message.payload.error?.message || "Microphone permission was denied."
      );
      return { ok: false };
    }

    try {
      await showMicrophoneAccessGrantedState(content, session);
      await startRecorderForCurrentSession(session);
      return { ok: true };
    } catch (error) {
      await recorder.close();
      await failSession(error.code || "DICTATION_START_FAILED", error.message);
      return { ok: false };
    }
  }

  /**
   * Starts the offscreen recorder and shows the recording overlay.
   */
  async function startRecorderForCurrentSession(session) {
    const recordingResponse = await recorder.start(session.id, {
      tabId: session.tabId
    });
    if (!recordingResponse?.ok) {
      throw toError(recordingResponse?.error, "Audio recording could not start.");
    }

    const recordingSession = sessions.markRecording(recordingResponse.recording ?? null);
    await showRecordingState(content, recordingSession);
  }
}
