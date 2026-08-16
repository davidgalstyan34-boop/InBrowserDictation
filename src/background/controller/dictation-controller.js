import { MessageType, parseMessageEnvelope } from "../../shared/messages.js";
import { DictationStatus } from "../../shared/dictation-state.js";
import {
  getConfigurationRequirements,
  loadSettings,
  resolveRewriteStyle
} from "../../shared/settings.js";
import { createContentClient } from "../clients/content-client.js";
import { createMicrophonePermissionClient } from "../clients/microphone-permission-client.js";
import { createOffscreenRecorderClient } from "../clients/offscreen-recorder-client.js";
import { createSpeechToTextClient } from "../providers/speech-to-text-client.js";
import { createTextImprovementClient } from "../providers/text-improvement-client.js";
import { getToggleDictationShortcutState } from "../diagnostics/shortcut-state.js";
import { createRecentResultStore } from "../session/recent-result-store.js";
import { createSessionStore } from "../session/store.js";
import { createCommandFlow } from "./command-flow.js";
import { showFailureState } from "./overlay-feedback.js";
import { createProcessingFlow } from "./processing-flow.js";
import { createRecordingFlow } from "./recording-flow.js";

/**
 * Composes the background side of one dictation session.
 *
 * Chrome event registration stays in the service worker entrypoint. This
 * controller wires clients, state, command policy, and lifecycle flows while
 * keeping the phase-specific async sequences in delegated modules.
 */
export function createDictationController({ chromeApi, clientsApi, cryptoApi }) {
  const content = createContentClient({ chromeApi });
  const microphonePermission = createMicrophonePermissionClient({ chromeApi });
  const recorder = createOffscreenRecorderClient({ chromeApi, clientsApi });
  const speechToText = createSpeechToTextClient({
    storageArea: chromeApi.storage?.sync,
    fetchApi: globalThis.fetch?.bind(globalThis)
  });
  const textImprovement = createTextImprovementClient({
    storageArea: chromeApi.storage?.sync,
    fetchApi: globalThis.fetch?.bind(globalThis)
  });
  const sessions = createSessionStore();
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
    cryptoApi,
    failSession
  });

  const commandHandlers = Object.freeze({
    "toggle-dictation": commandFlow.handleToggleCommand
  });

  const runtimeMessageHandlers = Object.freeze({
    [MessageType.RUNTIME_GET_STATE]: reportRuntimeState,
    [MessageType.RUNTIME_GET_POPUP_STATE]: reportPopupState,
    [MessageType.RUNTIME_MICROPHONE_PERMISSION_RESULT]: recordingFlow.handleMicrophonePermissionResult,
    [MessageType.RUNTIME_RETRY_RECENT_IMPROVEMENT]: retryRecentImprovement,
    [MessageType.RUNTIME_TOGGLE_DICTATION]: toggleFromRuntimeMessage
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
  function handleRuntimeMessage({ rawMessage, sender, sendResponse }) {
    const message = parseMessageEnvelope(rawMessage);
    const handler = message ? runtimeMessageHandlers[message.type] : null;

    if (!handler) {
      return false;
    }

    return handler({ message, sender, sendResponse });
  }

  /**
   * Returns a public session snapshot for options, diagnostics, and future UI.
   */
  function reportRuntimeState({ sendResponse }) {
    sendResponse({
      ok: true,
      session: sessions.toPublicSession()
    });
    return false;
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
    sessions.fail({
      code: "DICTATION_TAB_CLOSED",
      message: "The tab used for dictation was closed."
    });

    await recordingFlow.cancelRecordingForSession(session);
  }

  /**
   * Moves the session into ERROR and reports readable feedback to the page.
   */
  async function failSession(code, message) {
    const failedSession = sessions.fail({ code, message });
    console.warn("[In-Browser Dictation] Session failed.", {
      sessionId: failedSession.id,
      code,
      message
    });

    await showFailureState(content, failedSession, message);
  }

  async function buildPopupState() {
    const [settings, recentResult, shortcut] = await Promise.all([
      loadSettings(chromeApi.storage?.sync),
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
      finalText: improvement.text,
      outputSource: improvement.source ?? "llm",
      styleId: improvement.styleId ?? recentResult.styleId,
      warning: null,
      insertion: {
        method: "popup-retry",
        strategy: null,
        targetKind: "popup",
        textLength: improvement.text.length,
        fallbackReason: null
      },
      completedAt: Date.now()
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
