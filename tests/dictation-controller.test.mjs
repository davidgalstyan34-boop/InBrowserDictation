import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDictationController } from "../src/background/controller/dictation-controller.js";
import { MessageType } from "../src/shared/messages.js";

describe("dictation controller", () => {
  it("reports busy instead of stopping while recorder startup is pending", async () => {
    await withMutedConsole(async () => {
      const recorderStart = createDeferred();
      const recorderStartRequested = createDeferred();
      const tabMessages = [];
      const runtimeMessages = [];
      const chromeApi = createChromeApi({
        tabMessages,
        runtimeSendMessage: async (message) => {
          runtimeMessages.push(message);
          if (message.type === MessageType.OFFSCREEN_START_RECORDING) {
            recorderStartRequested.resolve();
            return await recorderStart.promise;
          }

          throw new Error(`Unexpected runtime message: ${message.type}`);
        }
      });
      const controller = createDictationController({
        chromeApi,
        clientsApi: null,
        cryptoApi: {
          randomUUID: () => "session-starting"
        }
      });

      const startPromise = controller.handleCommand("toggle-dictation", {
        tab: { id: 7 }
      });
      await recorderStartRequested.promise;

      await controller.handleCommand("toggle-dictation", {
        tab: { id: 7 }
      });

      assert.equal(
        runtimeMessages.some((message) => message.type === MessageType.OFFSCREEN_STOP_RECORDING),
        false
      );
      assert.equal(
        tabMessages.some(({ message }) => (
          message.type === MessageType.CONTENT_SHOW_STATE
            && message.payload.title === "Busy"
            && message.payload.status === "STARTING"
        )),
        true
      );

      recorderStart.resolve({
        ok: true,
        recording: {
          startedAt: 1000,
          tabId: 7,
          mimeType: "audio/webm"
        }
      });
      await startPromise;
    });
  });

  it("recovers suspended recorder sessions against the original tab id", async () => {
    await withMutedConsole(async () => {
      const tabMessages = [];
      const runtimeMessages = [];
      const chromeApi = createChromeApi({
        contexts: [{ url: "chrome-extension://test/offscreen/recorder.html" }],
        tabMessages,
        runtimeSendMessage: async (message) => {
          runtimeMessages.push(message);

          if (message.type === MessageType.OFFSCREEN_GET_RECORDING_STATE) {
            return {
              ok: true,
              recording: {
                sessionId: "session-recovered",
                tabId: 42,
                startedAt: 1000,
                mimeType: "audio/webm"
              }
            };
          }

          if (message.type === MessageType.OFFSCREEN_STOP_RECORDING) {
            return {
              ok: false,
              error: {
                code: "STOP_TEST_FAILURE",
                message: "Stop failed for test."
              }
            };
          }

          throw new Error(`Unexpected runtime message: ${message.type}`);
        }
      });
      const controller = createDictationController({
        chromeApi,
        clientsApi: null,
        cryptoApi: {
          randomUUID: () => "unused"
        }
      });

      await controller.handleCommand("toggle-dictation");

      assert.equal(chromeApi.queryCount(), 0);
      assert.equal(
        runtimeMessages.some((message) => (
          message.type === MessageType.OFFSCREEN_STOP_RECORDING
            && message.sessionId === "session-recovered"
        )),
        true
      );
      assert.equal(
        tabMessages.some(({ tabId, message }) => (
          tabId === 42
            && message.type === MessageType.CONTENT_SHOW_STATE
            && message.payload.title === "Stopping"
        )),
        true
      );
    });
  });
});

function createChromeApi({
  contexts = [],
  tabMessages,
  runtimeSendMessage
}) {
  let queryCount = 0;

  return {
    queryCount: () => queryCount,
    tabs: {
      query: async () => {
        queryCount += 1;
        return [{ id: 99 }];
      },
      sendMessage: async (tabId, message) => {
        tabMessages.push({ tabId, message });

        if (message.type === MessageType.CONTENT_PREPARE_DICTATION) {
          return {
            ok: true,
            target: { kind: "textarea" }
          };
        }

        return { ok: true };
      }
    },
    runtime: {
      getURL: (relativePath) => `chrome-extension://test/${relativePath}`,
      getContexts: async () => contexts,
      sendMessage: runtimeSendMessage
    },
    offscreen: {
      createDocument: async () => {},
      closeDocument: async () => {},
      hasDocument: async () => false
    },
    storage: {
      sync: {
        get: async (defaults) => defaults,
        set: async () => {}
      }
    },
    scripting: {
      executeScript: async () => {}
    },
    windows: {
      create: async () => ({ id: 1 })
    }
  };
}

function createDeferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve,
    reject
  };
}

async function withMutedConsole(action) {
  const original = {
    info: console.info,
    warn: console.warn,
    error: console.error
  };

  console.info = () => {};
  console.warn = () => {};
  console.error = () => {};

  try {
    return await action();
  } finally {
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
  }
}
