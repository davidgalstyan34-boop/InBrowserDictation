import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDictationController } from "../src/background/controller/dictation-controller.js";
import { DictationStatus } from "../src/shared/dictation-state.js";
import { MessageType } from "../src/shared/messages.js";
import {
  createChromeApi,
  createDeepgramTranscriptResponse,
  createDeferred,
  createGeminiTextResponse,
  createRecordingRuntimeHandler,
  createTestAudioPayload,
  getPublicSession,
  sendRuntimeMessage,
  withMutedConsole
} from "./helpers/dictation-controller-harness.mjs";

describe("dictation controller: session lifecycle", () => {
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

  it("starts one session when the popup and the shortcut toggle at the same time", async () => {
    await withMutedConsole(async () => {
      const tabMessages = [];
      const runtimeMessages = [];
      const sessionIds = [];
      const chromeApi = createChromeApi({
        tabMessages,
        runtimeSendMessage: async (message) => {
          runtimeMessages.push(message);
          if (message.type === MessageType.OFFSCREEN_START_RECORDING) {
            return {
              ok: true,
              recording: {
                startedAt: 1000,
                tabId: 99,
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
          randomUUID: () => {
            const id = `session-race-${sessionIds.length + 1}`;
            sessionIds.push(id);
            return id;
          }
        }
      });

      // The popup path resolves the active tab first, so it reaches the session
      // store one await later than the keyboard path. That difference is the
      // window in which both entrypoints used to observe IDLE and start.
      const popupToggle = sendRuntimeMessage(controller, MessageType.RUNTIME_TOGGLE_DICTATION);
      const keyboardToggle = controller.handleCommand("toggle-dictation", { tab: { id: 99 } });
      await Promise.all([popupToggle, keyboardToggle]);

      assert.equal(sessionIds.length, 1);
      assert.equal(
        runtimeMessages.filter((message) => (
          message.type === MessageType.OFFSCREEN_START_RECORDING
        )).length,
        1
      );
      assert.equal(
        tabMessages.filter(({ message }) => (
          message.type === MessageType.CONTENT_PREPARE_DICTATION
        )).length,
        1
      );

      const session = await getPublicSession(controller);
      assert.equal(session.status, DictationStatus.RECORDING);
      assert.equal(session.id, "session-race-1");
    });
  });

  it("refuses to record when the Deepgram key is missing", async () => {
    await withMutedConsole(async () => {
      const tabMessages = [];
      const runtimeMessages = [];
      const chromeApi = createChromeApi({
        storedSettings: { sttApiKey: "" },
        tabMessages,
        runtimeSendMessage: async (message) => {
          runtimeMessages.push(message);
          return { ok: true };
        }
      });
      const controller = createDictationController({
        chromeApi,
        clientsApi: null,
        cryptoApi: {
          randomUUID: () => "session-missing-deepgram-key"
        }
      });

      await controller.handleCommand("toggle-dictation", { tab: { id: 7 } });

      assert.equal(
        tabMessages.some(({ message }) => message.type === MessageType.CONTENT_PREPARE_DICTATION),
        false
      );
      assert.equal(
        runtimeMessages.some((message) => message.type === MessageType.OFFSCREEN_START_RECORDING),
        false
      );

      const session = await getPublicSession(controller);
      assert.equal(session.status, DictationStatus.ERROR);
      assert.equal(session.error.code, "STT_API_KEY_MISSING");
      assert.match(session.error.message, /Deepgram API key/i);
    });
  });

  it("refuses to record when the page reports a blocked field", async () => {
    await withMutedConsole(async () => {
      const tabMessages = [];
      const runtimeMessages = [];
      const chromeApi = createChromeApi({
        tabMessages,
        prepareTarget: {
          kind: "blocked",
          reason: "password inputs are never dictation targets"
        },
        runtimeSendMessage: async (message) => {
          runtimeMessages.push(message);
          return { ok: true };
        }
      });
      const controller = createDictationController({
        chromeApi,
        clientsApi: null,
        cryptoApi: {
          randomUUID: () => "session-blocked-target"
        }
      });

      await controller.handleCommand("toggle-dictation", { tab: { id: 7 } });

      // No audio may be captured, so nothing can reach a provider or the clipboard.
      assert.equal(
        runtimeMessages.some((message) => (
          message.type === MessageType.OFFSCREEN_START_RECORDING
        )),
        false
      );

      const session = await getPublicSession(controller);
      assert.equal(session.status, DictationStatus.ERROR);
      assert.equal(session.error.code, "DICTATION_TARGET_BLOCKED");
      assert.match(session.error.message, /password/i);
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

      const session = await getPublicSession(controller);

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

      assert.equal((await getPublicSession(controller)).status, DictationStatus.RECORDING);
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

        const session = await getPublicSession(controller);

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

  it("reports busy instead of toggling again while text improvement is running", async () => {
    await withMutedConsole(async () => {
      const originalFetch = globalThis.fetch;
      const tabMessages = [];
      const runtimeMessages = [];
      const geminiStarted = createDeferred();
      const geminiResponse = createDeferred();

      globalThis.fetch = async (url) => {
        const href = String(url);

        if (href.startsWith("https://api.deepgram.com/")) {
          return createDeepgramTranscriptResponse();
        }

        if (href.startsWith("https://generativelanguage.googleapis.com/")) {
          geminiStarted.resolve();
          return await geminiResponse.promise;
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
          runtimeSendMessage: createRecordingRuntimeHandler(runtimeMessages)
        });
        const controller = createDictationController({
          chromeApi,
          clientsApi: null,
          cryptoApi: {
            randomUUID: () => "session-improving-busy"
          }
        });

        await controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });
        const stopPromise = controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });

        await geminiStarted.promise;
        await controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });

        assert.equal((await getPublicSession(controller)).status, DictationStatus.IMPROVING);
        assert.equal(
          runtimeMessages.filter((message) => message.type === MessageType.OFFSCREEN_STOP_RECORDING).length,
          1
        );
        assert.equal(
          tabMessages.some(({ message }) => (
            message.type === MessageType.CONTENT_SHOW_STATE
              && message.payload.title === "Busy"
              && message.payload.status === DictationStatus.IMPROVING
          )),
          true
        );

        geminiResponse.resolve(createGeminiTextResponse("Improved transcript."));
        await stopPromise;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it("aborts provider work when the owning tab closes during text improvement", async () => {
    await withMutedConsole(async () => {
      const originalFetch = globalThis.fetch;
      const tabMessages = [];
      const runtimeMessages = [];
      const geminiStarted = createDeferred();
      let improvementSignal = null;

      globalThis.fetch = async (url, options) => {
        const href = String(url);

        if (href.startsWith("https://api.deepgram.com/")) {
          return createDeepgramTranscriptResponse();
        }

        if (href.startsWith("https://generativelanguage.googleapis.com/")) {
          improvementSignal = options.signal;
          geminiStarted.resolve();

          return await new Promise((_resolve, reject) => {
            improvementSignal.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            }, { once: true });
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
          runtimeSendMessage: createRecordingRuntimeHandler(runtimeMessages)
        });
        const controller = createDictationController({
          chromeApi,
          clientsApi: null,
          cryptoApi: {
            randomUUID: () => "session-improvement-tab-close"
          }
        });

        await controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });
        const stopPromise = controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });

        await geminiStarted.promise;
        await controller.handleTabRemoved(7);
        await stopPromise;

        const session = await getPublicSession(controller);

        assert.equal(improvementSignal.aborted, true);
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

});
