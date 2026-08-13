import { MessageType, parseMessageEnvelope } from "../shared/messages.js";
import { createContentClient } from "./content-client.js";
import { createCommandFlow } from "./controller/command-flow.js";
import { createProcessingFlow } from "./controller/processing-flow.js";
import { createRecordingFlow } from "./controller/recording-flow.js";
import { showFailureState } from "./controller/overlay-feedback.js";
import { createMicrophonePermissionClient } from "./microphone-permission-client.js";
import { createOffscreenRecorderClient } from "./offscreen-recorder-client.js";
import { createSessionStore } from "./session/store.js";
import { createSpeechToTextClient } from "./speech-to-text-client.js";
import { createTextImprovementClient } from "./text-improvement-client.js";

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

  const recordingFlow = createRecordingFlow({
    content,
    microphonePermission,
    recorder,
    sessions,
    failSession
  });
  const processingFlow = createProcessingFlow({
    content,
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
    [MessageType.RUNTIME_MICROPHONE_PERMISSION_RESULT]: recordingFlow.handleMicrophonePermissionResult
  });

  return {
    handleCommand,
    handleRuntimeMessage
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
}
