import { DictationStatus } from "../../shared/dictation-state.js";
import { showBusyState, showStoppingState } from "./overlay-feedback.js";

/**
 * Owns shortcut policy for an already-wired dictation controller.
 *
 * This module decides which lifecycle flow should run for the current session
 * status, but delegates recording and processing details to those flows.
 */
export function createCommandFlow({
  content,
  sessions,
  recordingFlow,
  processingFlow,
  cryptoApi,
  failSession
}) {
  return {
    handleToggleCommand
  };

  /**
   * Implements the user-facing shortcut toggle.
   */
  async function handleToggleCommand({ tab } = {}) {
    if (sessions.get().status === DictationStatus.IDLE && await recordingFlow.recoverActiveRecording()) {
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
   * Starts a fresh session from a terminal state in one shortcut press.
   */
  async function replaceTerminalSession({ tab } = {}) {
    const previousSession = sessions.get();
    await content.safeDismissOverlay(previousSession.tabId, previousSession.id);
    sessions.reset();
    await startDictationSession({ tab });
  }

  /**
   * Gives feedback during non-toggleable states such as STARTING or STOPPING.
   */
  async function reportBusySession() {
    await showBusyState(content, sessions.get());
  }

  /**
   * Starts a new command-owned dictation session and delegates recorder setup.
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
      const preparedSession = await recordingFlow.prepareSessionForRecording(session, tab.id);
      await recordingFlow.startRecordingForSession(preparedSession);
    } catch (error) {
      console.error("[In-Browser Dictation] Start failed.", error);

      if (await recordingFlow.handleStartFailure(error)) {
        return;
      }

      await failSession(error.code || "DICTATION_START_FAILED", error.message);
    }
  }

  /**
   * Stops the active recorder, then delegates audio processing and insertion.
   */
  async function stopDictationSession() {
    const session = sessions.markStopping();
    console.info("[In-Browser Dictation] Stopping session.", {
      sessionId: session.id,
      tabId: session.tabId
    });

    await showStoppingState(content, session);

    try {
      const audio = await recordingFlow.stopRecordingForSession(session);
      await processingFlow.processStoppedRecording(audio);
    } catch (error) {
      console.error("[In-Browser Dictation] Stop failed.", error);
      await failSession(error.code || "DICTATION_STOP_FAILED", error.message);
    } finally {
      await recordingFlow.closeRecorder();
    }
  }
}
