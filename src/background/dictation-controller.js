import { describeAudioMetadata, isMicrophonePermissionError } from "../shared/audio-recording.js";
import { DictationStatus } from "../shared/dictation-state.js";
import { MessageType, parseMessageEnvelope } from "../shared/messages.js";
import { createContentClient } from "./content-client.js";
import { toError } from "./errors.js";
import { createMicrophonePermissionClient } from "./microphone-permission-client.js";
import { createOffscreenRecorderClient } from "./offscreen-recorder-client.js";
import { describeRecordingState, describeTranscriptionState } from "./session-descriptions.js";
import { createSessionStore } from "./session-store.js";
import { createSpeechToTextClient } from "./speech-to-text-client.js";

/**
 * Coordinates the background side of one dictation session.
 *
 * The controller knows the order of operations, but delegates concrete work:
 * tab messaging belongs to content-client, session mutation belongs to
 * session-store, and microphone/offscreen details belong to
 * offscreen-recorder-client. Keeping these boundaries explicit prevents the
 * service worker entrypoint from becoming a mixed-responsibility script.
 */
export function createDictationController({ chromeApi, clientsApi, cryptoApi }) {
  const content = createContentClient({ chromeApi });
  const microphonePermission = createMicrophonePermissionClient({ chromeApi });
  const recorder = createOffscreenRecorderClient({ chromeApi, clientsApi });
  const speechToText = createSpeechToTextClient({
    storageArea: chromeApi.storage?.sync,
    fetchApi: globalThis.fetch?.bind(globalThis)
  });
  const sessions = createSessionStore();

  const commandHandlers = Object.freeze({
    "toggle-dictation": handleToggleCommand
  });

  const runtimeMessageHandlers = Object.freeze({
    [MessageType.RUNTIME_GET_STATE]: reportRuntimeState,
    [MessageType.RUNTIME_MICROPHONE_PERMISSION_RESULT]: handleMicrophonePermissionResult
  });

  return {
    handleCommand,
    handleRuntimeMessage
  };

  /**
   * Handles Chrome command names from the service worker entrypoint.
   *
   * Unknown commands are ignored because Chrome can dispatch commands from old
   * manifests while a developer is reloading an unpacked extension.
   */
  async function handleCommand(command, context = {}) {
    const handler = commandHandlers[command];
    if (handler) {
      await handler(context);
    }
  }

  /**
   * Handles runtime messages owned by the background context.
   *
   * The return value follows Chrome's onMessage contract: `false` means no
   * async response is pending. Message types for content/offscreen contexts are
   * intentionally ignored here.
   */
  function handleRuntimeMessage({ rawMessage, sender, sendResponse }) {
    const message = parseMessageEnvelope(rawMessage);
    const handler = message ? runtimeMessageHandlers[message.type] : null;

    if (!handler) {
      return false;
    }

    return handler({ message, sender, sendResponse });
  }

  /**
   * Implements the user-facing shortcut toggle.
   *
   * If the service worker was suspended while recording, the in-memory session
   * can be idle even though the offscreen document still owns a recorder. The
   * recovery check lets the next shortcut stop that recorder instead of trying
   * to create a duplicate microphone session.
   */
  async function handleToggleCommand({ tab } = {}) {
    if (sessions.get().status === DictationStatus.IDLE && await recoverActiveRecording()) {
      await stopDictationSession();
      return;
    }

    const session = sessions.get();
    const toggleActionsByStatus = {
      [DictationStatus.IDLE]: () => startDictationSession({ tab }),
      [DictationStatus.RECORDING]: stopDictationSession,
      [DictationStatus.SUCCESS]: () => replaceTerminalSession({ tab }),
      [DictationStatus.ERROR]: () => replaceTerminalSession({ tab })
    };

    const action = toggleActionsByStatus[session.status] ?? reportBusySession;
    await action();
  }

  /**
   * Starts a new Phase 3 session:
   * 1. capture the active tab;
   * 2. show immediate shortcut feedback;
   * 3. ask the content script to remember the insertion target;
   * 4. start microphone recording in the offscreen document.
   */
  async function startDictationSession({ tab: commandTab } = {}) {
    const tab = commandTab ?? await content.getActiveTab();
    const session = sessions.start({
      id: cryptoApi.randomUUID(),
      tabId: tab?.id ?? null
    });

    console.info("[In-Browser Dictation] Starting session.", {
      sessionId: session.id,
      tabId: session.tabId,
      url: tab?.url
    });

    if (!tab?.id) {
      await failSession("NO_ACTIVE_TAB", "No active tab is available for dictation.");
      return;
    }

    try {
      await content.showState(tab.id, session.id, {
        status: session.status,
        title: "Starting",
        detail: "Shortcut received"
      });

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
   * Stops the active recording and sends the captured audio to STT.
   *
   * Recorder ownership ends as soon as audio is serialized. Provider details
   * stay in the STT client so this method remains lifecycle orchestration.
   */
  async function stopDictationSession() {
    const session = sessions.markStopping();
    console.info("[In-Browser Dictation] Stopping session.", {
      sessionId: session.id,
      tabId: session.tabId
    });

    await content.safeShowState(session.tabId, session.id, {
      status: session.status,
      title: "Stopping",
      detail: "Finalizing audio"
    });

    try {
      const recordingResponse = await recorder.stop(session.id);
      if (!recordingResponse?.ok) {
        throw toError(recordingResponse?.error, "Audio recording could not stop.");
      }

      await recorder.close();

      const transcribingSession = sessions.markTranscribing(recordingResponse.audio ?? null);
      await content.safeShowState(transcribingSession.tabId, transcribingSession.id, {
        status: transcribingSession.status,
        title: "Transcribing",
        detail: describeAudioMetadata(transcribingSession.audio)
      });

      const transcription = await speechToText.transcribe({
        audio: transcribingSession.audio
      });
      const completedSession = sessions.markTranscriptReady(transcription);

      await content.safeShowState(completedSession.tabId, completedSession.id, {
        status: completedSession.status,
        title: "Transcript ready",
        detail: describeTranscriptionState(completedSession.transcription),
        tone: "success"
      });
    } catch (error) {
      console.error("[In-Browser Dictation] Stop failed.", error);
      await failSession(error.code || "DICTATION_STOP_FAILED", error.message);
    } finally {
      await recorder.close();
    }
  }

  /**
   * Returns the public session snapshot for future popup/options UI.
   *
   * Audio data itself is stripped by session-store so UI surfaces can inspect
   * status without accidentally receiving a large data URL.
   */
  function reportRuntimeState({ sendResponse }) {
    sendResponse({
      ok: true,
      session: sessions.toPublicSession()
    });
    return false;
  }

  /**
   * Handles the result sent by the visible microphone permission page.
   *
   * The handler returns `true` because it answers asynchronously after retrying
   * the recorder or moving the session to ERROR.
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
   * Gives user feedback when the shortcut is pressed during non-toggleable
   * states such as STARTING or STOPPING.
   */
  async function reportBusySession() {
    const session = sessions.get();
    await content.safeShowState(session.tabId, session.id, {
      status: session.status,
      title: "Busy",
      detail: "Dictation is already working"
    });
  }

  /**
   * Starts a fresh session from a terminal state in one shortcut press.
   *
   * The old overlay is dismissed before reset so terminal feedback from a
   * previous tab cannot linger while the new tab shows startup feedback.
   */
  async function replaceTerminalSession({ tab } = {}) {
    const previousSession = sessions.get();
    await content.safeDismissOverlay(previousSession.tabId, previousSession.id);
    sessions.reset();
    await startDictationSession({ tab });
  }

  /**
   * Rehydrates service-worker state from an already-open offscreen recorder.
   *
   * This is a best-effort recovery path for MV3 service-worker suspension. The
   * recovered session intentionally has no captured DOM target because those
   * references live only in the content script and cannot be reconstructed here.
   */
  async function recoverActiveRecording() {
    const recording = await recorder.getActiveRecording();
    if (!recording) {
      return false;
    }

    const tab = await content.getActiveTab();
    console.info("[In-Browser Dictation] Recovered active offscreen recording.", {
      sessionId: recording.sessionId,
      tabId: tab?.id
    });

    sessions.recoverRecording({
      recording,
      tabId: tab?.id ?? null
    });
    return true;
  }

  /**
   * Requests microphone permission from a visible extension page and pauses the
   * current startup flow until that page reports success/failure.
   */
  async function requestMicrophonePermission() {
    const session = sessions.markMicrophonePermissionNeeded();

    await content.safeShowState(session.tabId, session.id, {
      status: session.status,
      title: "Microphone access needed",
      detail: "A permission window was opened",
      tone: "muted"
    });

    await microphonePermission.openPermissionWindow(session.id);
  }

  /**
   * Retries recording after the visible permission page grants microphone
   * access, or fails the session when the user denies access.
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
      await content.safeShowState(session.tabId, session.id, {
        status: session.status,
        title: "Microphone access granted",
        detail: "Starting recording"
      });

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
    const recordingResponse = await recorder.start(session.id);
    if (!recordingResponse?.ok) {
      throw toError(recordingResponse?.error, "Audio recording could not start.");
    }

    const recordingSession = sessions.markRecording(recordingResponse.recording ?? null);
    await content.safeShowState(recordingSession.tabId, recordingSession.id, {
      status: recordingSession.status,
      title: "Recording",
      detail: describeRecordingState(recordingSession)
    });
  }

  /**
   * Moves the session into ERROR and reports a readable failure to the page
   * overlay when a content script is still available.
   */
  async function failSession(code, message) {
    const failedSession = sessions.fail({ code, message });
    console.warn("[In-Browser Dictation] Session failed.", {
      sessionId: failedSession.id,
      code,
      message
    });

    await content.safeShowState(failedSession.tabId, failedSession.id, {
      status: failedSession.status,
      title: "Dictation failed",
      detail: message,
      tone: "error"
    });
  }
}
