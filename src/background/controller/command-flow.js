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
  // Guards against overlapping shortcut presses. Every toggle branch awaits
  // before it claims the session store, so two presses delivered in the same
  // tick would otherwise both observe IDLE and start competing sessions.
  let decidingToggle = false;

  return {
    handleToggleCommand
  };

  /**
   * Implements the user-facing shortcut toggle.
   *
   * A press that arrives while a previous press is still deciding is dropped
   * rather than queued: queueing would fire a surprise session once a long
   * pipeline finished, which is not what a user pressing a toggle expects.
   */
  async function handleToggleCommand({ tab } = {}) {
    if (decidingToggle) {
      await reportOverlappingToggle();
      return;
    }

    decidingToggle = true;

    try {
      await runToggleCommand({ tab });
    } finally {
      decidingToggle = false;
    }
  }

  /**
   * Gives feedback for a press that landed while another press was deciding.
   */
  async function reportOverlappingToggle() {
    const session = sessions.get();
    if (!session.id) {
      // The competing press has not claimed a session yet, so there is nothing
      // meaningful to show on the page.
      console.info("[In-Browser Dictation] Ignoring an overlapping toggle press.");
      return;
    }

    await showBusyState(content, session);
  }

  async function runToggleCommand({ tab }) {
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
      await failSession(session.id, "NO_ACTIVE_TAB", "No active tab is available for dictation.");
      return;
    }

    try {
      const preparedSession = await recordingFlow.prepareSessionForRecording(session, tab.id);
      if (!preparedSession) {
        return;
      }

      await recordingFlow.startRecordingForSession(preparedSession);
    } catch (error) {
      console.error("[In-Browser Dictation] Start failed.", error);

      if (await recordingFlow.handleStartFailure(session.id, error)) {
        return;
      }

      await failSession(session.id, error.code || "DICTATION_START_FAILED", error.message);
    }
  }

  /**
   * Stops the active recorder, then delegates audio processing and insertion.
   */
  async function stopDictationSession() {
    const activeSession = sessions.get();
    const session = sessions.markStopping(activeSession.id);
    if (!session) {
      return;
    }

    console.info("[In-Browser Dictation] Stopping session.", {
      sessionId: session.id,
      tabId: session.tabId
    });

    await showStoppingState(content, session);

    try {
      const audio = await recordingFlow.stopRecordingForSession(session);
      await processingFlow.processStoppedRecording(session.id, audio);
    } catch (error) {
      console.error("[In-Browser Dictation] Stop failed.", error);
      await failSession(session.id, error.code || "DICTATION_STOP_FAILED", error.message);
    } finally {
      await recordingFlow.closeRecorder();
    }
  }
}
