import { MessageType, parseMessageEnvelope } from "../../shared/messages.js";
import { DictationStatus } from "../../shared/dictation-state.js";
import {
  getConfigurationRequirements,
  resolveRewriteStyle
} from "../../shared/settings.js";
import { loadSettings } from "../../shared/settings-store.js";
import { createContentClient } from "../clients/content-client.js";
import { createMicrophonePermissionClient } from "../clients/microphone-permission-client.js";
import { createOffscreenClipboardClient } from "../clients/offscreen-clipboard-client.js";
import { createOffscreenRecorderClient } from "../clients/offscreen-recorder-client.js";
import { createSpeechToTextClient } from "../providers/speech-to-text-client.js";
import { createTextImprovementClient } from "../providers/text-improvement-client.js";
import { getToggleDictationShortcutState } from "../diagnostics/shortcut-state.js";
import { createRecentResultStore } from "../session/recent-result-store.js";
import { createSessionStore } from "../session/store.js";
import { createCommandFlow } from "./command-flow.js";
import { showFailureState, showRecordingLimitReachedState } from "./overlay-feedback.js";
import { createProcessingFlow } from "./processing-flow.js";
import { createRecordingFlow } from "./recording-flow.js";
import { createSessionWatchdog } from "./session-watchdog.js";

/**
 * Composes the background side of one dictation session.
 *
 * Chrome event registration stays in the service worker entrypoint. This
 * controller wires clients, state, command policy, and lifecycle flows while
 * keeping the phase-specific async sequences in delegated modules.
 */
export function createDictationController({ chromeApi, clientsApi, cryptoApi }) {
  const content = createContentClient({ chromeApi });
  const clipboard = createOffscreenClipboardClient({ chromeApi });
  const microphonePermission = createMicrophonePermissionClient({ chromeApi });
  const recorder = createOffscreenRecorderClient({ chromeApi, clientsApi });
  const speechToText = createSpeechToTextClient({
    settingsStorage: chromeApi.storage,
    fetchApi: globalThis.fetch?.bind(globalThis)
  });
  const textImprovement = createTextImprovementClient({
    settingsStorage: chromeApi.storage,
    sessionStorageArea: chromeApi.storage?.session,
    fetchApi: globalThis.fetch?.bind(globalThis)
  });
  const sessions = createSessionStore({
    onChange: () => watchdog.observe()
  });
  const watchdog = createSessionWatchdog({
    sessions,
    onExpired: cancelStalledSession
  });
  const recentResults = createRecentResultStore({
    storageArea: chromeApi.storage?.session
  });

  const recordingFlow = createRecordingFlow({
    content,
    microphonePermission,
    recorder,
    sessions,
    failSession
  });
  const processingFlow = createProcessingFlow({
    clipboard,
    content,
    recentResults,
    speechToText,
    textImprovement,
    sessions
  });
  const commandFlow = createCommandFlow({
    content,
    sessions,
    recordingFlow,
    processingFlow,
    loadConfigurationRequirements,
    cryptoApi,
    failSession
  });

  const commandHandlers = Object.freeze({
    "toggle-dictation": commandFlow.handleToggleCommand
  });

  const runtimeMessageHandlers = Object.freeze({
    [MessageType.RUNTIME_GET_POPUP_STATE]: reportPopupState,
    [MessageType.RUNTIME_MICROPHONE_PERMISSION_RESULT]: recordingFlow.handleMicrophonePermissionResult,
    [MessageType.RUNTIME_RETRY_RECENT_IMPROVEMENT]: retryRecentImprovement,
    [MessageType.RUNTIME_TOGGLE_DICTATION]: toggleFromRuntimeMessage,
    [MessageType.RUNTIME_CANCEL_DICTATION]: cancelFromRuntimeMessage,
    [MessageType.RUNTIME_CLEAR_RECENT_RESULT]: clearRecentResult,
    [MessageType.OFFSCREEN_RECORDING_DURATION_CAPPED]: handleRecordingDurationCapped
  });

  return {
    handleCommand,
    handleRuntimeMessage,
    handleTabRemoved
  };

  /**
   * Handles Chrome command names from the service worker entrypoint.
   */
  async function handleCommand(command, context = {}) {
    const handler = commandHandlers[command];
    if (handler) {
      await handler(context);
    }
  }

  /**
   * Handles runtime messages owned by the background context.
   */
  function handleRuntimeMessage({ rawMessage, sendResponse }) {
    const message = parseMessageEnvelope(rawMessage);
    const handler = message ? runtimeMessageHandlers[message.type] : null;

    if (!handler) {
      return false;
    }

    return handler({ message, sendResponse });
  }

  /**
   * Returns popup-specific state, including the latest recoverable result text.
   */
  function reportPopupState({ sendResponse }) {
    void buildPopupState()
      .then((popupState) => {
        sendResponse({
          ok: true,
          ...popupState
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: toMessageError(error, "Popup state could not be loaded.")
        });
      });

    return true;
  }

  /**
   * Lets the popup use the same start/stop policy as the keyboard shortcut.
   */
  function toggleFromRuntimeMessage({ sendResponse }) {
    void commandFlow.handleToggleCommand()
      .then(() => {
        sendResponse({
          ok: true,
          session: sessions.toPublicSession()
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: toMessageError(error, "Dictation could not be toggled.")
        });
      });

    return true;
  }

  /**
   * Continues the pipeline for a recording that hit the maximum length.
   *
   * The recorder has already stopped and is holding the audio. Running the
   * ordinary toggle collects it through the same stop path the user's shortcut
   * would take, including the recovery path when this worker was restarted by
   * the message itself and no longer remembers the session.
   */
  function handleRecordingDurationCapped({ sendResponse }) {
    void continueAfterDurationCap()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("[In-Browser Dictation] Capped recording could not be processed.", error);
        sendResponse({
          ok: false,
          error: toMessageError(error, "The capped recording could not be processed.")
        });
      });

    return true;
  }

  async function continueAfterDurationCap() {
    const session = sessions.get();
    if (session.status === DictationStatus.RECORDING) {
      await showRecordingLimitReachedState(content, session);
    }

    await commandFlow.handleToggleCommand();
  }

  /**
   * Lets the popup abandon a session that is stuck in a non-toggleable state.
   */
  function cancelFromRuntimeMessage({ sendResponse }) {
    void cancelActiveSession()
      .then(() => {
        sendResponse({
          ok: true,
          session: sessions.toPublicSession()
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: toMessageError(error, "Dictation could not be cancelled.")
        });
      });

    return true;
  }

  /**
   * Forgets the stored latest result.
   *
   * The result outlives the session it came from so the popup can recover text
   * that never reached the page. This is how a user takes it back out of
   * storage without waiting for the browser session to end.
   */
  function clearRecentResult({ sendResponse }) {
    void recentResults.clear()
      .then(() => sendResponse({ ok: true, recentResult: null }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: toMessageError(error, "The latest result could not be cleared.")
        });
      });

    return true;
  }

  /**
   * Retries only the text-improvement step for the stored latest transcript.
   */
  function retryRecentImprovement({ sendResponse }) {
    void retryRecentImprovementInternal()
      .then((recentResult) => {
        sendResponse({
          ok: true,
          recentResult
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: toMessageError(error, "Recent result could not be retried.")
        });
      });

    return true;
  }

  /**
   * Cancels the active session when its original tab is closed.
   */
  async function handleTabRemoved(tabId) {
    const session = sessions.get();

    if (!isCancellableSessionForTab(session, tabId)) {
      return;
    }

    console.warn("[In-Browser Dictation] Cancelling session because its tab closed.", {
      sessionId: session.id,
      tabId
    });

    processingFlow.abortActiveRequest();
    sessions.fail(session.id, {
      code: "DICTATION_TAB_CLOSED",
      message: "The tab used for dictation was closed."
    });

    await recordingFlow.cancelRecordingForSession(session);
  }

  /**
   * Abandons the active session and returns the extension to a startable state.
   *
   * Used by the popup's explicit cancel and by the watchdog. Both need the same
   * teardown: stop provider work, release the recorder, clear page feedback.
   */
  async function cancelActiveSession() {
    const session = sessions.get();
    if (session.status === DictationStatus.IDLE) {
      return;
    }

    processingFlow.abortActiveRequest();
    await recordingFlow.cancelRecordingForSession(session);
    await content.safeDismissOverlay(session.tabId, session.id);
    sessions.reset();
  }

  /**
   * Fails a session that stopped making progress inside a waiting state.
   */
  async function cancelStalledSession(sessionId, status) {
    const session = sessions.get();

    processingFlow.abortActiveRequest();
    await recordingFlow.cancelRecordingForSession(session);
    await failSession(
      sessionId,
      "DICTATION_TIMED_OUT",
      `Dictation stopped responding while ${describeStalledStatus(status)}.`
    );
  }

  /**
   * Moves the session into ERROR and reports readable feedback to the page.
   */
  async function failSession(sessionId, code, message) {
    const failedSession = sessions.fail(sessionId, { code, message });
    if (!failedSession) {
      return;
    }

    console.warn("[In-Browser Dictation] Session failed.", {
      sessionId: failedSession.id,
      code,
      message
    });

    await showFailureState(content, failedSession, message);
  }

  async function buildPopupState() {
    const [settings, recentResult, shortcut] = await Promise.all([
      loadSettings(chromeApi.storage),
      recentResults.load(),
      getToggleDictationShortcutState(chromeApi)
    ]);
    const style = resolveRewriteStyle(settings);

    return {
      session: sessions.toPublicSession(),
      recentResult,
      configuration: getConfigurationRequirements(settings),
      style: {
        id: style.id,
        name: style.name,
        description: style.description ?? ""
      },
      shortcut
    };
  }

  /**
   * Loads the current credential requirements for command-start preflight.
   */
  async function loadConfigurationRequirements() {
    return getConfigurationRequirements(await loadSettings(chromeApi.storage));
  }

  async function retryRecentImprovementInternal() {
    const session = sessions.get();
    if (!canRunPopupRetry(session.status)) {
      const error = new Error("Wait for the active dictation session to finish before retrying.");
      error.code = "DICTATION_BUSY";
      throw error;
    }

    const recentResult = await recentResults.load();
    if (!recentResult?.rawTranscript) {
      const error = new Error("No raw transcript is available to retry.");
      error.code = "RECENT_RAW_TRANSCRIPT_MISSING";
      throw error;
    }

    const improvement = await textImprovement.improveText({
      text: recentResult.rawTranscript
    });

    return await recentResults.save({
      ...recentResult,
      finalText: improvement.text
    });
  }
}

function isCancellableSessionForTab(session, tabId) {
  if (!session?.id || session.tabId !== tabId) {
    return false;
  }

  return session.status !== DictationStatus.IDLE
    && session.status !== DictationStatus.SUCCESS
    && session.status !== DictationStatus.ERROR;
}

function describeStalledStatus(status) {
  const descriptions = {
    [DictationStatus.STARTING]: "preparing the page",
    [DictationStatus.WAITING_FOR_MICROPHONE]: "waiting for microphone access",
    [DictationStatus.STOPPING]: "finalizing the recording",
    [DictationStatus.TRANSCRIBING]: "transcribing audio",
    [DictationStatus.IMPROVING]: "improving the transcript",
    [DictationStatus.INSERTING]: "inserting text"
  };

  return descriptions[status] ?? "working";
}

function canRunPopupRetry(status) {
  return status === DictationStatus.IDLE
    || status === DictationStatus.SUCCESS
    || status === DictationStatus.ERROR;
}

function toMessageError(error, fallbackMessage) {
  return {
    code: error?.code || "RUNTIME_REQUEST_FAILED",
    message: error?.message || fallbackMessage
  };
}
