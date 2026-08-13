import { DictationStatus } from "../../shared/dictation-state.js";
import { showBusyState } from "./overlay-feedback.js";

/**
 * Owns shortcut policy for an already-wired dictation controller.
 *
 * This module decides which lifecycle flow should run for the current session
 * status, but delegates recording and processing details to those flows.
 */
export function createCommandFlow({ content, sessions, recordingFlow, processingFlow }) {
  return {
    handleToggleCommand
  };

  /**
   * Implements the user-facing shortcut toggle.
   */
  async function handleToggleCommand({ tab } = {}) {
    if (sessions.get().status === DictationStatus.IDLE && await recordingFlow.recoverActiveRecording()) {
      await processingFlow.stopDictationSession();
      return;
    }

    const session = sessions.get();
    const toggleActionsByStatus = {
      [DictationStatus.IDLE]: () => recordingFlow.startDictationSession({ tab }),
      [DictationStatus.RECORDING]: processingFlow.stopDictationSession,
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
    await recordingFlow.startDictationSession({ tab });
  }

  /**
   * Gives feedback during non-toggleable states such as STARTING or STOPPING.
   */
  async function reportBusySession() {
    await showBusyState(content, sessions.get());
  }
}
