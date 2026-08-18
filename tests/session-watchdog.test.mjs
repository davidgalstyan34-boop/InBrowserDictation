import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DictationStatus } from "../src/shared/dictation-state.js";
import {
  STATE_DEADLINES_MS,
  createSessionWatchdog
} from "../src/background/controller/session-watchdog.js";

describe("session watchdog", () => {
  it("expires provider states before Chrome's service-worker fetch limit", () => {
    assert.equal(STATE_DEADLINES_MS[DictationStatus.TRANSCRIBING], 25_000);
    assert.equal(STATE_DEADLINES_MS[DictationStatus.IMPROVING], 25_000);
    assert.ok(STATE_DEADLINES_MS[DictationStatus.TRANSCRIBING] < 30_000);
    assert.ok(STATE_DEADLINES_MS[DictationStatus.IMPROVING] < 30_000);
  });

  it("fails a session that stays in a waiting state past its deadline", () => {
    const timers = createFakeTimers();
    const sessions = createFakeSessions({
      id: "session-1",
      status: DictationStatus.WAITING_FOR_MICROPHONE
    });
    const expired = [];
    const watchdog = createWatchdog({ sessions, timers, expired });

    watchdog.observe();
    assert.equal(expired.length, 0);

    timers.runPending();

    assert.deepEqual(expired, [["session-1", DictationStatus.WAITING_FOR_MICROPHONE]]);
  });

  it("leaves recording alone", () => {
    const timers = createFakeTimers();
    const sessions = createFakeSessions({
      id: "session-1",
      status: DictationStatus.RECORDING
    });
    const expired = [];
    const watchdog = createWatchdog({ sessions, timers, expired });

    watchdog.observe();

    // A long dictation is legitimate, so no deadline is armed at all.
    assert.equal(timers.pendingCount(), 0);
    timers.runPending();
    assert.equal(expired.length, 0);
  });

  it("does not fire once the session has moved on", () => {
    const timers = createFakeTimers();
    const sessions = createFakeSessions({
      id: "session-1",
      status: DictationStatus.TRANSCRIBING
    });
    const expired = [];
    const watchdog = createWatchdog({ sessions, timers, expired });

    watchdog.observe();
    sessions.set({ id: "session-1", status: DictationStatus.IMPROVING });
    timers.runPending();

    assert.equal(expired.length, 0);
  });

  it("does not fire for a session that was replaced", () => {
    const timers = createFakeTimers();
    const sessions = createFakeSessions({
      id: "session-1",
      status: DictationStatus.STARTING
    });
    const expired = [];
    const watchdog = createWatchdog({ sessions, timers, expired });

    watchdog.observe();
    sessions.set({ id: "session-2", status: DictationStatus.STARTING });
    timers.runPending();

    assert.equal(expired.length, 0);
  });

  it("re-arms on each observed change and keeps one timer", () => {
    const timers = createFakeTimers();
    const sessions = createFakeSessions({
      id: "session-1",
      status: DictationStatus.STARTING
    });
    const expired = [];
    const watchdog = createWatchdog({ sessions, timers, expired });

    watchdog.observe();
    sessions.set({ id: "session-1", status: DictationStatus.TRANSCRIBING });
    watchdog.observe();

    assert.equal(timers.pendingCount(), 1);

    watchdog.cancel();
    assert.equal(timers.pendingCount(), 0);
  });
});

function createWatchdog({ sessions, timers, expired }) {
  const originalWarn = console.warn;
  console.warn = () => {};

  const watchdog = createSessionWatchdog({
    sessions,
    onExpired: async (sessionId, status) => {
      expired.push([sessionId, status]);
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer
  });

  console.warn = originalWarn;
  return watchdog;
}

function createFakeSessions(initialSession) {
  let session = initialSession;

  return {
    get: () => session,
    set: (nextSession) => {
      session = nextSession;
    }
  };
}

function createFakeTimers() {
  const pending = new Map();
  let nextId = 1;

  return {
    setTimer: (callback) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, callback);
      return id;
    },
    clearTimer: (id) => pending.delete(id),
    pendingCount: () => pending.size,
    runPending: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      const originalWarn = console.warn;
      console.warn = () => {};
      try {
        for (const callback of callbacks) {
          callback();
        }
      } finally {
        console.warn = originalWarn;
      }
    }
  };
}
