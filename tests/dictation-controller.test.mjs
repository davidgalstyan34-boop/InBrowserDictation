import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDictationController } from "../src/background/controller/dictation-controller.js";
import { DictationStatus } from "../src/shared/dictation-state.js";
import { MessageType, createEnvelope } from "../src/shared/messages.js";

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

  it("cancels active recording when the owning tab closes", async () => {
    await withMutedConsole(async () => {
      const tabMessages = [];
      const runtimeMessages = [];
      const chromeApi = createChromeApi({
        tabMessages,
        runtimeSendMessage: async (message) => {
          runtimeMessages.push(message);

          if (message.type === MessageType.OFFSCREEN_START_RECORDING) {
            return {
              ok: true,
              recording: {
                startedAt: 1000,
                tabId: 7,
                mimeType: "audio/webm"
              }
            };
          }

          if (message.type === MessageType.OFFSCREEN_STOP_RECORDING) {
            return {
              ok: true,
              audio: createTestAudioPayload()
            };
          }

          throw new Error(`Unexpected runtime message: ${message.type}`);
        }
      });
      const controller = createDictationController({
        chromeApi,
        clientsApi: null,
        cryptoApi: {
          randomUUID: () => "session-closing-tab"
        }
      });

      await controller.handleCommand("toggle-dictation", {
        tab: { id: 7 }
      });
      await controller.handleTabRemoved(7);

      const session = getPublicSession(controller);

      assert.equal(session.status, DictationStatus.ERROR);
      assert.equal(session.error.code, "DICTATION_TAB_CLOSED");
      assert.equal(chromeApi.closeDocumentCount(), 1);
      assert.equal(
        runtimeMessages.some((message) => (
          message.type === MessageType.OFFSCREEN_STOP_RECORDING
            && message.sessionId === "session-closing-tab"
        )),
        true
      );
    });
  });

  it("does not cancel recording when an unrelated tab closes", async () => {
    await withMutedConsole(async () => {
      const tabMessages = [];
      const runtimeMessages = [];
      const chromeApi = createChromeApi({
        tabMessages,
        runtimeSendMessage: async (message) => {
          runtimeMessages.push(message);

          if (message.type === MessageType.OFFSCREEN_START_RECORDING) {
            return {
              ok: true,
              recording: {
                startedAt: 1000,
                tabId: 7,
                mimeType: "audio/webm"
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
          randomUUID: () => "session-kept"
        }
      });

      await controller.handleCommand("toggle-dictation", {
        tab: { id: 7 }
      });
      await controller.handleTabRemoved(8);

      assert.equal(getPublicSession(controller).status, DictationStatus.RECORDING);
      assert.equal(chromeApi.closeDocumentCount(), 0);
      assert.equal(
        runtimeMessages.some((message) => message.type === MessageType.OFFSCREEN_STOP_RECORDING),
        false
      );
    });
  });

  it("aborts provider work when the owning tab closes during transcription", async () => {
    await withMutedConsole(async () => {
      const originalFetch = globalThis.fetch;
      const tabMessages = [];
      const runtimeMessages = [];
      const fetchStarted = createDeferred();
      let transcriptionSignal = null;

      globalThis.fetch = async (_url, options) => {
        transcriptionSignal = options.signal;
        fetchStarted.resolve();

        return await new Promise((_resolve, reject) => {
          transcriptionSignal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      };

      try {
        const chromeApi = createChromeApi({
          storedSettings: {
            sttApiKey: "deepgram-key"
          },
          tabMessages,
          runtimeSendMessage: async (message) => {
            runtimeMessages.push(message);

            if (message.type === MessageType.OFFSCREEN_START_RECORDING) {
              return {
                ok: true,
                recording: {
                  startedAt: 1000,
                  tabId: 7,
                  mimeType: "audio/webm"
                }
              };
            }

            if (message.type === MessageType.OFFSCREEN_STOP_RECORDING) {
              return {
                ok: true,
                audio: createTestAudioPayload()
              };
            }

            throw new Error(`Unexpected runtime message: ${message.type}`);
          }
        });
        const controller = createDictationController({
          chromeApi,
          clientsApi: null,
          cryptoApi: {
            randomUUID: () => "session-provider-abort"
          }
        });

        await controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });
        const stopPromise = controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });

        await fetchStarted.promise;
        await controller.handleTabRemoved(7);
        await stopPromise;

        const session = getPublicSession(controller);

        assert.equal(transcriptionSignal.aborted, true);
        assert.equal(session.status, DictationStatus.ERROR);
        assert.equal(session.error.code, "DICTATION_TAB_CLOSED");
        assert.equal(
          tabMessages.some(({ message }) => message.type === MessageType.CONTENT_INSERT_TEXT),
          false
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it("reports the latest successful result to the popup and retries rewriting it", async () => {
    await withMutedConsole(async () => {
      const originalFetch = globalThis.fetch;
      const tabMessages = [];
      const runtimeMessages = [];
      const geminiTexts = ["First polished result.", "Retried polished result."];

      globalThis.fetch = async (url) => {
        const href = String(url);

        if (href.startsWith("https://api.deepgram.com/")) {
          return createJsonResponse({
            metadata: {
              request_id: "deepgram-request",
              duration: 1.2
            },
            results: {
              channels: [
                {
                  alternatives: [
                    {
                      transcript: "raw transcript",
                      confidence: 0.98
                    }
                  ]
                }
              ]
            }
          });
        }

        if (href.startsWith("https://generativelanguage.googleapis.com/")) {
          return createJsonResponse({
            responseId: "gemini-response",
            modelVersion: "gemini-test",
            candidates: [
              {
                finishReason: "STOP",
                content: {
                  parts: [
                    {
                      text: geminiTexts.shift()
                    }
                  ]
                }
              }
            ]
          });
        }

        throw new Error(`Unexpected fetch URL: ${href}`);
      };

      try {
        const chromeApi = createChromeApi({
          storedSettings: {
            sttApiKey: "deepgram-key",
            llmApiKey: "gemini-key"
          },
          tabMessages,
          runtimeSendMessage: async (message) => {
            runtimeMessages.push(message);

            if (message.type === MessageType.OFFSCREEN_START_RECORDING) {
              return {
                ok: true,
                recording: {
                  startedAt: 1000,
                  tabId: 7,
                  mimeType: "audio/webm"
                }
              };
            }

            if (message.type === MessageType.OFFSCREEN_STOP_RECORDING) {
              return {
                ok: true,
                audio: createTestAudioPayload()
              };
            }

            throw new Error(`Unexpected runtime message: ${message.type}`);
          }
        });
        const controller = createDictationController({
          chromeApi,
          clientsApi: null,
          cryptoApi: {
            randomUUID: () => "session-recent-result"
          }
        });

        await controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });
        await controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });

        const popupState = await sendRuntimeMessage(controller, MessageType.RUNTIME_GET_POPUP_STATE);
        assert.equal(popupState.recentResult.rawTranscript, "raw transcript");
        assert.equal(popupState.recentResult.finalText, "First polished result.");
        assert.equal(popupState.style.name, "Default");
        assert.equal(popupState.shortcut.assigned, true);
        assert.equal(popupState.shortcut.shortcut, "Ctrl+Shift+Space");
        assert.equal("text" in popupState.session.outputText, false);

        const retry = await sendRuntimeMessage(controller, MessageType.RUNTIME_RETRY_RECENT_IMPROVEMENT);
        assert.equal(retry.recentResult.finalText, "Retried polished result.");
        assert.equal(retry.recentResult.insertion.method, "popup-retry");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it("reports an unassigned keyboard shortcut to the popup", async () => {
    await withMutedConsole(async () => {
      const chromeApi = createChromeApi({
        commandShortcuts: [
          {
            name: "toggle-dictation",
            shortcut: ""
          }
        ],
        tabMessages: [],
        runtimeSendMessage: async (message) => {
          throw new Error(`Unexpected runtime message: ${message.type}`);
        }
      });
      const controller = createDictationController({
        chromeApi,
        clientsApi: null,
        cryptoApi: {
          randomUUID: () => "session-shortcut-missing"
        }
      });

      const popupState = await sendRuntimeMessage(controller, MessageType.RUNTIME_GET_POPUP_STATE);

      assert.equal(popupState.shortcut.assigned, false);
      assert.equal(popupState.shortcut.shortcut, "");
      assert.equal(popupState.shortcut.status, "unassigned");
      assert.equal(popupState.shortcut.suggested, "Ctrl+Shift+Space / Command+Shift+Space");
      assert.equal(popupState.shortcut.settingsUrl, "chrome://extensions/shortcuts");
    });
  });
});

function createChromeApi({
  commandShortcuts = [
    {
      name: "toggle-dictation",
      shortcut: "Ctrl+Shift+Space"
    }
  ],
  contexts = null,
  storedSettings = {},
  tabMessages,
  runtimeSendMessage
}) {
  let queryCount = 0;
  let offscreenDocumentExists = false;
  let closeDocumentCount = 0;
  const extensionOrigin = "chrome-extension://test/";

  return {
    queryCount: () => queryCount,
    closeDocumentCount: () => closeDocumentCount,
    commands: {
      getAll: async () => commandShortcuts
    },
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

        if (message.type === MessageType.CONTENT_INSERT_TEXT) {
          return {
            ok: true,
            insertion: {
              method: "target",
              targetKind: "textarea",
              textLength: message.payload.text.length
            }
          };
        }

        return { ok: true };
      }
    },
    runtime: {
      getURL: (relativePath) => `${extensionOrigin}${relativePath}`,
      getContexts: async () => contexts ?? (
        offscreenDocumentExists
          ? [{ url: `${extensionOrigin}offscreen/recorder.html` }]
          : []
      ),
      sendMessage: runtimeSendMessage
    },
    offscreen: {
      createDocument: async () => {
        offscreenDocumentExists = true;
      },
      closeDocument: async () => {
        closeDocumentCount += 1;
        offscreenDocumentExists = false;
      },
      hasDocument: async () => offscreenDocumentExists
    },
    storage: {
      sync: {
        get: async (defaults) => ({
          ...defaults,
          ...storedSettings
        }),
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

function getPublicSession(controller) {
  let response = null;
  controller.handleRuntimeMessage({
    rawMessage: createEnvelope(MessageType.RUNTIME_GET_STATE),
    sender: {},
    sendResponse: (nextResponse) => {
      response = nextResponse;
    }
  });

  return response.session;
}

function sendRuntimeMessage(controller, type, payload = {}) {
  return new Promise((resolve) => {
    controller.handleRuntimeMessage({
      rawMessage: createEnvelope(type, payload),
      sender: {},
      sendResponse: resolve
    });
  });
}

function createTestAudioPayload() {
  return {
    mimeType: "audio/webm",
    sizeBytes: 1024,
    durationMs: 1200,
    capturedAt: 1000,
    dataUrl: "data:audio/webm;base64,aGVsbG8="
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

function createJsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload
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
