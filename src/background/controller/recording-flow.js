import { isMicrophonePermissionError } from "../../shared/audio-recording.js";
import { DictationStatus } from "../../shared/dictation-state.js";
import { createCodedError } from "../../shared/extension-error.js";
import { toError } from "../utils/errors.js";
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
  failSession
}) {
  return {
    cancelRecordingForSession,
    closeRecorder,
    handleMicrophonePermissionResult,
    handleStartFailure,
    prepareSessionForRecording,
    recoverActiveRecording,
    startRecordingForSession,
    stopRecordingForSession
  };

  /**
   * Stops any active recorder for a cancelled session and closes the document.
   */
  async function cancelRecordingForSession(session) {
    if (session?.id && shouldAskRecorderToStop(session.status)) {
      try {
        await recorder.stop(session.id);
      } catch (error) {
        console.info("[In-Browser Dictation] Recorder stop during cancellation was not needed.", {
          sessionId: session.id,
          code: error.code || "RECORDER_CANCEL_STOP_SKIPPED"
        });
      }
    }

    await closeRecorder();
  }

  /**
   * Captures the content-side insertion target before recording begins.
   */
  async function prepareSessionForRecording(session, tabId) {
    await showStartingState(content, session);

    const prepareResponse = await content.prepareDictation(tabId, session.id);
    if (!prepareResponse?.ok) {
      throw toError(prepareResponse?.error, "The page could not prepare for dictation.");
    }

    const target = prepareResponse.target ?? null;
    assertTargetAcceptsDictation(target);

    return sessions.markTargetReady(session.id, target);
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
  async function requestMicrophonePermission(sessionId) {
    const session = sessions.markMicrophonePermissionNeeded(sessionId);
    if (!session) {
      return;
    }

    await showMicrophonePermissionNeededState(content, session);
    await microphonePermission.openPermissionWindow(session.id, session.tabId);
  }

  /**
   * Retries recording after the visible permission page grants microphone access.
   */
  async function processMicrophonePermissionResult(message) {
    const session = resolvePermissionSession(message);

    if (!session) {
      return { ok: false, ignored: true };
    }

    if (!message.payload.granted) {
      await failSession(
        session.id,
        message.payload.error?.code || "MICROPHONE_PERMISSION_DENIED",
        message.payload.error?.message || "Microphone permission was denied."
      );
      return { ok: false };
    }

    try {
      await showMicrophoneAccessGrantedState(content, session);
      await startRecordingForSession(session);
      return { ok: true };
    } catch (error) {
      await recorder.close();
      await failSession(session.id, error.code || "DICTATION_START_FAILED", error.message);
      return { ok: false };
    }
  }

  /**
   * Finds the session a permission result belongs to, rebuilding it if needed.
   *
   * The usual case is the session still parked in WAITING_FOR_MICROPHONE. The
   * other case is an MV3 restart: the worker can be suspended while the user
   * reads Chrome's prompt, which loses the in-memory session. The result echoes
   * back the session id and tab id, and the content script still holds the
   * captured target under that same session id, so the session is rebuilt
   * rather than dropped. A result for a *different* live session is still
   * ignored.
   */
  function resolvePermissionSession(message) {
    const session = sessions.get();

    if (!message.sessionId) {
      return null;
    }

    if (message.sessionId === session.id) {
      return session.status === DictationStatus.WAITING_FOR_MICROPHONE ? session : null;
    }

    // Only a granted permission is worth rebuilding for. If the worker restarted
    // and the user dismissed the window, nothing is wedged and resurrecting the
    // session would only show an error for work the user already abandoned.
    if (session.status !== DictationStatus.IDLE || message.payload?.granted !== true) {
      return null;
    }

    const tabId = message.payload?.tabId;
    if (!Number.isInteger(tabId)) {
      return null;
    }

    console.info("[In-Browser Dictation] Rebuilding a session lost to worker suspension.", {
      sessionId: message.sessionId,
      tabId
    });

    sessions.start({ id: message.sessionId, tabId });
    return sessions.markMicrophonePermissionNeeded(message.sessionId);
  }

  /**
   * Starts the offscreen recorder and shows the recording overlay.
   */
  async function startRecordingForSession(session) {
    const recordingResponse = await recorder.start(session.id, {
      tabId: session.tabId
    });
    if (!recordingResponse?.ok) {
      throw toError(recordingResponse?.error, "Audio recording could not start.");
    }

    const recordingSession = sessions.markRecording(
      session.id,
      recordingResponse.recording ?? null
    );
    if (!recordingSession) {
      // A newer session replaced this one while the recorder was starting.
      await recorder.stop(session.id).catch(() => {});
      return;
    }

    await showRecordingState(content, recordingSession);
  }

  /**
   * Stops the offscreen recorder and returns the serialized audio payload.
   */
  async function stopRecordingForSession(session) {
    const recordingResponse = await recorder.stop(session.id);
    if (!recordingResponse?.ok) {
      throw toError(recordingResponse?.error, "Audio recording could not stop.");
    }

    return recordingResponse.audio ?? null;
  }

  /**
   * Cleans up the offscreen recorder document when a lifecycle phase ends.
   */
  async function closeRecorder() {
    await recorder.close();
  }

  /**
   * Handles recorder startup failures that need recording-specific recovery.
   */
  async function handleStartFailure(sessionId, error) {
    await closeRecorder();

    if (!isMicrophonePermissionError(error)) {
      return false;
    }

    await requestMicrophonePermission(sessionId);
    return true;
  }
}

/**
 * Refuses to record for a target the content script has ruled out.
 *
 * A blocked target is a deliberate refusal (password and hidden inputs), not a
 * missing one. Recording anyway would send that audio to the STT provider and
 * the transcript to the LLM provider, and the final text would then reach the
 * clipboard through the no-target fallback. The session stops here instead, so
 * nothing is captured at all.
 */
function assertTargetAcceptsDictation(target) {
  if (target?.kind !== "blocked") {
    return;
  }

  throw createCodedError(
    "DICTATION_TARGET_BLOCKED",
    target.reason || "This field cannot be used for dictation."
  );
}

function shouldAskRecorderToStop(status) {
  return status === DictationStatus.STARTING
    || status === DictationStatus.RECORDING
    || status === DictationStatus.STOPPING;
}
