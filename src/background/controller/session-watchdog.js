import { DictationStatus } from "../../shared/dictation-state.js";

// Deadlines for states that are waiting on something outside the session.
//
// RECORDING is deliberately absent: a long dictation is legitimate, and capping
// recording length is a separate product decision rather than a stuck-state
// guard. Provider requests abort after 20s and their state watchdogs fire after
// 25s. Both deadlines stay below Chrome's 30s service-worker fetch limit, while
// still letting provider code report its more specific timeout first.
const STATE_DEADLINES_MS = Object.freeze({
  [DictationStatus.STARTING]: 20_000,
  [DictationStatus.WAITING_FOR_MICROPHONE]: 120_000,
  [DictationStatus.STOPPING]: 20_000,
  [DictationStatus.TRANSCRIBING]: 25_000,
  [DictationStatus.IMPROVING]: 25_000,
  [DictationStatus.INSERTING]: 20_000
});

/**
 * Fails sessions that stop making progress in a non-toggleable state.
 *
 * Without this, a page that never answers, a permission window left open, or a
 * hung provider call parks the session in a state the shortcut reports as
 * "busy" and nothing can leave. A plain timer is the right tool despite MV3:
 * it only has to cover hangs while the worker is alive, which is exactly when a
 * flow can be stuck. If the worker is suspended instead, the in-memory session
 * is discarded anyway and the next shortcut press starts cleanly.
 */
export function createSessionWatchdog({
  sessions,
  onExpired,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  deadlines = STATE_DEADLINES_MS
}) {
  let timerId = null;

  return {
    observe,
    cancel
  };

  /**
   * Re-arms the watchdog for whatever state the session is now in.
   */
  function observe() {
    cancel();

    const session = sessions.get();
    const deadlineMs = deadlines[session.status];
    if (!session.id || !deadlineMs) {
      return;
    }

    timerId = setTimer(() => {
      timerId = null;
      void expire(session.id, session.status);
    }, deadlineMs);
  }

  function cancel() {
    if (timerId !== null) {
      clearTimer(timerId);
      timerId = null;
    }
  }

  async function expire(sessionId, status) {
    const session = sessions.get();
    if (session.id !== sessionId || session.status !== status) {
      return;
    }

    console.warn("[In-Browser Dictation] Session stopped making progress; cancelling it.", {
      sessionId,
      status
    });

    await onExpired(sessionId, status);
  }
}

export { STATE_DEADLINES_MS };
