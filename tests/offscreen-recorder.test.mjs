import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MessageType, createEnvelope } from "../src/shared/messages.js";

// The recorder is the only place that owns live media objects, so testing it
// means standing in for the browser pieces it touches: MediaRecorder,
// getUserMedia, FileReader, and chrome.runtime messaging.
//
// The five-minute duration cap is intercepted rather than waited on. These are
// captured before the override is installed, so the override never recurses
// into itself.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const capTimers = [];

globalThis.setTimeout = (callback, delayMs) => {
  if (delayMs >= 60_000) {
    capTimers.push(callback);
    return capTimers.length;
  }

  return realSetTimeout(callback, delayMs);
};

globalThis.clearTimeout = (id) => {
  if (typeof id === "number" && id > 0 && id <= capTimers.length) {
    capTimers[id - 1] = () => {};
    return;
  }

  realClearTimeout(id);
};

let listener = null;
let sentRuntimeMessages = [];
let recorders = [];
let stoppedTracks = 0;
let originalNavigatorDescriptor = null;
const originalGlobals = {};

class FakeMediaRecorder {
  static isTypeSupported() {
    return true;
  }

  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? "audio/webm";
    this.state = "inactive";
    this.listeners = {};
    recorders.push(this);
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.listeners.dataavailable?.({ data: new Blob(["0123456789".repeat(80)]) });
    this.listeners.stop?.();
  }

  fail(error) {
    this.listeners.error?.({ error });
  }
}

class FakeFileReader {
  addEventListener(type, handler) {
    this[`on${type}`] = handler;
  }

  readAsDataURL() {
    this.result = "data:audio/webm;base64,QUFB";
    this.onload?.();
  }
}

before(async () => {
  for (const name of ["chrome", "MediaRecorder", "FileReader"]) {
    originalGlobals[name] = globalThis[name];
  }

  globalThis.MediaRecorder = FakeMediaRecorder;
  globalThis.FileReader = FakeFileReader;

  // Node exposes `navigator` as a getter-only property, so it cannot be
  // assigned the way the other globals can.
  originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => { stoppedTracks += 1; } }]
        })
      }
    }
  });
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: (handler) => {
          listener = handler;
        }
      },
      sendMessage: async (message) => {
        sentRuntimeMessages.push(message);
      }
    }
  };

  await import("../src/offscreen/recorder.js");
});

after(() => {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;

  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  }

  for (const [name, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      delete globalThis[name];
      continue;
    }

    globalThis[name] = value;
  }
});

beforeEach(() => {
  sentRuntimeMessages = [];
  recorders = [];
  stoppedTracks = 0;
});

describe("offscreen recorder", () => {
  it("returns audio and releases the microphone on stop", async () => {
    const started = await send(MessageType.OFFSCREEN_START_RECORDING, "session-1", { tabId: 7 });
    assert.equal(started.ok, true);
    assert.equal(started.recording.tabId, 7);

    const stopped = await send(MessageType.OFFSCREEN_STOP_RECORDING, "session-1");

    assert.equal(stopped.ok, true);
    assert.equal(stopped.audio.dataUrl, "data:audio/webm;base64,QUFB");
    assert.ok(stopped.audio.sizeBytes > 0);
    assert.equal(stoppedTracks, 1, "microphone tracks are released");
  });

  it("refuses a stop from a different session", async () => {
    await send(MessageType.OFFSCREEN_START_RECORDING, "session-1", { tabId: 7 });

    const stopped = await send(MessageType.OFFSCREEN_STOP_RECORDING, "session-other");

    assert.equal(stopped.ok, false);
    assert.equal(stopped.error.code, "RECORDING_SESSION_MISMATCH");
    await send(MessageType.OFFSCREEN_STOP_RECORDING, "session-1");
  });

  it("refuses to start a second recording", async () => {
    await send(MessageType.OFFSCREEN_START_RECORDING, "session-1", { tabId: 7 });

    const second = await send(MessageType.OFFSCREEN_START_RECORDING, "session-2", { tabId: 7 });

    assert.equal(second.ok, false);
    assert.equal(second.error.code, "RECORDING_ALREADY_ACTIVE");
    await send(MessageType.OFFSCREEN_STOP_RECORDING, "session-1");
  });

  it("keeps the audio and reports itself when the duration cap fires", async () => {
    await send(MessageType.OFFSCREEN_START_RECORDING, "session-capped", { tabId: 7 });

    await runDurationCap();

    // The worker is told, so the pipeline continues without the user pressing stop.
    assert.equal(
      sentRuntimeMessages.some((message) => (
        message.type === MessageType.OFFSCREEN_RECORDING_DURATION_CAPPED
          && message.sessionId === "session-capped"
      )),
      true
    );
    assert.equal(stoppedTracks, 1, "the microphone is released at the cap");

    // The audio is held rather than discarded, and a later stop collects it.
    const state = await send(MessageType.OFFSCREEN_GET_RECORDING_STATE, null);
    assert.equal(state.recording.sessionId, "session-capped");
    assert.equal(state.recording.durationCapped, true);

    const stopped = await send(MessageType.OFFSCREEN_STOP_RECORDING, "session-capped");
    assert.equal(stopped.ok, true);
    assert.equal(stopped.audio.dataUrl, "data:audio/webm;base64,QUFB");
  });

  it("hands capped audio to one collector only", async () => {
    await send(MessageType.OFFSCREEN_START_RECORDING, "session-capped", { tabId: 7 });
    await runDurationCap();

    assert.equal((await send(MessageType.OFFSCREEN_STOP_RECORDING, "session-capped")).ok, true);

    const second = await send(MessageType.OFFSCREEN_STOP_RECORDING, "session-capped");
    assert.equal(second.ok, false);
    assert.equal(second.error.code, "RECORDING_NOT_ACTIVE");
  });

  it("discards uncollected capped audio when a new session starts", async () => {
    await send(MessageType.OFFSCREEN_START_RECORDING, "session-abandoned", { tabId: 7 });
    await runDurationCap();

    await send(MessageType.OFFSCREEN_START_RECORDING, "session-fresh", { tabId: 7 });
    await send(MessageType.OFFSCREEN_STOP_RECORDING, "session-fresh");

    const orphan = await send(MessageType.OFFSCREEN_STOP_RECORDING, "session-abandoned");
    assert.equal(orphan.ok, false);
    assert.equal(orphan.error.code, "RECORDING_NOT_ACTIVE");
  });

  it("reports a recording too short to transcribe", async () => {
    await send(MessageType.OFFSCREEN_START_RECORDING, "session-tiny", { tabId: 7 });
    recorders.at(-1).stop = function stopWithoutData() {
      this.state = "inactive";
      this.listeners.stop?.();
    };

    const stopped = await send(MessageType.OFFSCREEN_STOP_RECORDING, "session-tiny");

    assert.equal(stopped.ok, false);
    assert.equal(stopped.error.code, "RECORDING_EMPTY");
  });

  it("ignores messages it does not own", () => {
    assert.equal(
      listener(createEnvelope(MessageType.RUNTIME_GET_POPUP_STATE), {}, () => {}),
      false
    );
  });
});

function send(type, sessionId, payload = {}) {
  return new Promise((resolve) => {
    listener(createEnvelope(type, payload, sessionId), {}, resolve);
  });
}

/**
 * Fires the pending duration-cap timer without waiting five real minutes.
 */
async function runDurationCap() {
  const pending = capTimers.splice(0, capTimers.length);
  for (const callback of pending) {
    callback();
  }

  // Let the recorder finish reading the blob and notify the worker.
  await new Promise((resolve) => realSetTimeout(resolve, 0));
}
