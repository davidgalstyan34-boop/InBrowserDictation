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

      const session = getPublicSession(controller);
      assert.equal(session.status, DictationStatus.RECORDING);
      assert.equal(session.id, "session-race-1");
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

      const session = getPublicSession(controller);
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

        assert.equal(getPublicSession(controller).status, DictationStatus.IMPROVING);
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

        const session = getPublicSession(controller);

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

  it("shows a specific raw-transcript warning when Gemini rejects the key", async () => {
    await withMutedConsole(async () => {
      const originalFetch = globalThis.fetch;
      const tabMessages = [];
      const runtimeMessages = [];

      globalThis.fetch = async (url) => {
        const href = String(url);

        if (href.startsWith("https://api.deepgram.com/")) {
          return createDeepgramTranscriptResponse();
        }

        if (href.startsWith("https://generativelanguage.googleapis.com/")) {
          return new Response(JSON.stringify({
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              message: "API key not valid. Please pass a valid API key."
            }
          }), { status: 400 });
        }

        throw new Error(`Unexpected fetch URL: ${href}`);
      };

      try {
        const chromeApi = createChromeApi({
          storedSettings: {
            sttApiKey: "deepgram-key",
            llmApiKey: "bad-gemini-key"
          },
          tabMessages,
          runtimeSendMessage: createRecordingRuntimeHandler(runtimeMessages)
        });
        const controller = createDictationController({
          chromeApi,
          clientsApi: null,
          cryptoApi: {
            randomUUID: () => "session-gemini-auth-warning"
          }
        });

        await controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });
        await controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });

        const insertionReady = tabMessages.find(({ message }) => (
          message.type === MessageType.CONTENT_SHOW_STATE
            && message.payload.status === DictationStatus.INSERTING
            && message.payload.title === "Inserting raw transcript"
        ));
        const completed = tabMessages.find(({ message }) => (
          message.type === MessageType.CONTENT_SHOW_STATE
            && message.payload.status === DictationStatus.SUCCESS
        ));
        const insertedText = tabMessages.find(({ message }) => (
          message.type === MessageType.CONTENT_INSERT_TEXT
        ));

        assert.equal(getPublicSession(controller).status, DictationStatus.SUCCESS);
        assert.equal(getPublicSession(controller).warning.code, "LLM_AUTH_FAILED");
        assert.equal(
          insertionReady.message.payload.detail,
          "Gemini key rejected; inserting raw transcript (14 characters)."
        );
        assert.equal(completed.message.payload.detail.includes("Gemini key rejected"), true);
        assert.equal(insertedText.message.payload.text, "raw transcript");
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

  it("keeps the final text recoverable when insertion and clipboard both fail", async () => {
    await withMutedConsole(async () => {
      const originalFetch = globalThis.fetch;
      const tabMessages = [];

      globalThis.fetch = async (url) => {
        const href = String(url);
        if (href.startsWith("https://api.deepgram.com/")) {
          return createDeepgramTranscriptResponse("recovered transcript");
        }

        throw new Error(`Unexpected fetch URL: ${href}`);
      };

      try {
        const chromeApi = createChromeApi({
          // Raw style keeps Gemini out of this test; the failure under test is
          // insertion, not improvement.
          storedSettings: {
            sttApiKey: "deepgram-key",
            defaultStyleId: "raw"
          },
          tabMessages,
          insertTextResponse: {
            ok: false,
            error: {
              code: "INSERTION_AND_CLIPBOARD_FAILED",
              message: "Text could not be inserted or copied to the clipboard."
            }
          },
          runtimeSendMessage: createRecordingRuntimeHandler([])
        });
        const controller = createDictationController({
          chromeApi,
          clientsApi: null,
          cryptoApi: {
            randomUUID: () => "session-insertion-failed"
          }
        });

        await controller.handleCommand("toggle-dictation", { tab: { id: 7 } });
        await controller.handleCommand("toggle-dictation", { tab: { id: 7 } });

        assert.equal(getPublicSession(controller).status, DictationStatus.ERROR);

        // The transcript survived the failed insertion and is reachable.
        const popupState = await sendRuntimeMessage(controller, MessageType.RUNTIME_GET_POPUP_STATE);
        assert.equal(popupState.recentResult.finalText, "recovered transcript");
        assert.equal(popupState.recentResult.rawTranscript, "recovered transcript");

        // The page overlay says where the text went.
        const failureState = tabMessages
          .map(({ message }) => message)
          .filter((message) => message.type === MessageType.CONTENT_SHOW_STATE)
          .at(-1);
        assert.equal(failureState.payload.tone, "error");
        assert.match(failureState.payload.detail, /popup to copy it/i);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it("recovers when the microphone permission window is closed undecided", async () => {
    await withMutedConsole(async () => {
      const permissionWindows = [];
      const chromeApi = createChromeApi({
        tabMessages: [],
        permissionWindows,
        runtimeSendMessage: async (message) => {
          if (message.type === MessageType.OFFSCREEN_START_RECORDING) {
            return {
              ok: false,
              error: {
                code: "MICROPHONE_PERMISSION_DENIED",
                message: "Microphone permission was denied."
              }
            };
          }

          return { ok: true };
        }
      });
      const controller = createDictationController({
        chromeApi,
        clientsApi: null,
        cryptoApi: { randomUUID: () => "session-permission-dismissed" }
      });

      await controller.handleCommand("toggle-dictation", { tab: { id: 7 } });
      assert.equal(
        getPublicSession(controller).status,
        DictationStatus.WAITING_FOR_MICROPHONE
      );
      assert.match(permissionWindows[0], /sessionId=session-permission-dismissed/);
      assert.match(permissionWindows[0], /tabId=7/);

      // Closing the window is the page's last act; without this report the
      // session would wait forever and every later press would say "busy".
      await sendPermissionResult(controller, "session-permission-dismissed", {
        granted: false,
        tabId: 7,
        error: {
          code: "MICROPHONE_PERMISSION_DISMISSED",
          message: "The microphone permission window was closed before choosing."
        }
      });

      const session = getPublicSession(controller);
      assert.equal(session.status, DictationStatus.ERROR);
      assert.equal(session.error.code, "MICROPHONE_PERMISSION_DISMISSED");
    });
  });

  it("resumes a granted permission after the worker was suspended", async () => {
    await withMutedConsole(async () => {
      const runtimeMessages = [];
      const chromeApi = createChromeApi({
        tabMessages: [],
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

          return { ok: true };
        }
      });
      // A freshly constructed controller stands in for a restarted worker: the
      // session that opened the permission window is gone from memory.
      const controller = createDictationController({
        chromeApi,
        clientsApi: null,
        cryptoApi: { randomUUID: () => "unused" }
      });

      assert.equal(getPublicSession(controller).status, DictationStatus.IDLE);

      await sendPermissionResult(controller, "session-before-suspension", {
        granted: true,
        tabId: 7
      });

      const session = getPublicSession(controller);
      assert.equal(session.status, DictationStatus.RECORDING);
      assert.equal(session.id, "session-before-suspension");
      assert.equal(session.tabId, 7);
      assert.equal(
        runtimeMessages.some((message) => (
          message.type === MessageType.OFFSCREEN_START_RECORDING
            && message.sessionId === "session-before-suspension"
        )),
        true
      );
    });
  });

  it("ignores a dismissed permission that arrives after the worker restarted", async () => {
    await withMutedConsole(async () => {
      const chromeApi = createChromeApi({
        tabMessages: [],
        runtimeSendMessage: async () => ({ ok: true })
      });
      const controller = createDictationController({
        chromeApi,
        clientsApi: null,
        cryptoApi: { randomUUID: () => "unused" }
      });

      await sendPermissionResult(controller, "session-before-suspension", {
        granted: false,
        tabId: 7,
        error: {
          code: "MICROPHONE_PERMISSION_DISMISSED",
          message: "The microphone permission window was closed before choosing."
        }
      });

      // Nothing was wedged, so there is no session to resurrect and fail.
      assert.equal(getPublicSession(controller).status, DictationStatus.IDLE);
    });
  });

  it("lets the popup cancel a session stuck in a busy state", async () => {
    await withMutedConsole(async () => {
      const recorderStart = createDeferred();
      const recorderStartRequested = createDeferred();
      const tabMessages = [];
      const chromeApi = createChromeApi({
        tabMessages,
        runtimeSendMessage: async (message) => {
          if (message.type === MessageType.OFFSCREEN_START_RECORDING) {
            recorderStartRequested.resolve();
            return await recorderStart.promise;
          }

          return { ok: true };
        }
      });
      const controller = createDictationController({
        chromeApi,
        clientsApi: null,
        cryptoApi: { randomUUID: () => "session-cancelled" }
      });

      const startPromise = controller.handleCommand("toggle-dictation", { tab: { id: 7 } });
      await recorderStartRequested.promise;
      assert.equal(getPublicSession(controller).status, DictationStatus.STARTING);

      const cancelResponse = await sendRuntimeMessage(
        controller,
        MessageType.RUNTIME_CANCEL_DICTATION
      );

      assert.equal(cancelResponse.ok, true);
      assert.equal(getPublicSession(controller).status, DictationStatus.IDLE);
      assert.equal(
        tabMessages.some(({ message }) => (
          message.type === MessageType.CONTENT_DISMISS_OVERLAY
        )),
        true
      );

      recorderStart.resolve({ ok: false, error: { code: "X", message: "late" } });
      await startPromise;
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

  it("reports popup retry failures for missing and invalid Gemini keys", async () => {
    await withMutedConsole(async () => {
      const originalFetch = globalThis.fetch;
      const tabMessages = [];
      const runtimeMessages = [];
      const storedSettings = {
        sttApiKey: "deepgram-key",
        defaultStyleId: "raw",
        llmApiKey: ""
      };

      globalThis.fetch = async (url) => {
        const href = String(url);

        if (href.startsWith("https://api.deepgram.com/")) {
          return createDeepgramTranscriptResponse();
        }

        if (href.startsWith("https://generativelanguage.googleapis.com/")) {
          return new Response(JSON.stringify({
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              message: "API key not valid. Please pass a valid API key."
            }
          }), { status: 400 });
        }

        throw new Error(`Unexpected fetch URL: ${href}`);
      };

      try {
        const chromeApi = createChromeApi({
          storedSettings,
          tabMessages,
          runtimeSendMessage: createRecordingRuntimeHandler(runtimeMessages)
        });
        const controller = createDictationController({
          chromeApi,
          clientsApi: null,
          cryptoApi: {
            randomUUID: () => "session-popup-retry-failure"
          }
        });

        await controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });
        await controller.handleCommand("toggle-dictation", {
          tab: { id: 7 }
        });

        storedSettings.defaultStyleId = "default";
        storedSettings.llmApiKey = "";

        const missingKey = await sendRuntimeMessage(controller, MessageType.RUNTIME_RETRY_RECENT_IMPROVEMENT);
        assert.equal(missingKey.ok, false);
        assert.equal(missingKey.error.code, "LLM_API_KEY_MISSING");

        storedSettings.llmApiKey = "bad-gemini-key";

        const invalidKey = await sendRuntimeMessage(controller, MessageType.RUNTIME_RETRY_RECENT_IMPROVEMENT);
        assert.equal(invalidKey.ok, false);
        assert.equal(invalidKey.error.code, "LLM_AUTH_FAILED");
      } finally {
        globalThis.fetch = originalFetch;
      }
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
  runtimeSendMessage,
  insertTextResponse = null,
  prepareTarget = { kind: "textarea" },
  permissionWindows = []
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
            target: prepareTarget
          };
        }

        if (message.type === MessageType.CONTENT_INSERT_TEXT) {
          return insertTextResponse ?? {
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
      create: async ({ url }) => {
        permissionWindows.push(url);
        return { id: 1 };
      }
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

function sendPermissionResult(controller, sessionId, payload) {
  return new Promise((resolve) => {
    controller.handleRuntimeMessage({
      rawMessage: createEnvelope(
        MessageType.RUNTIME_MICROPHONE_PERMISSION_RESULT,
        payload,
        sessionId
      ),
      sender: {},
      sendResponse: resolve
    });
  });
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

function createRecordingRuntimeHandler(runtimeMessages) {
  return async (message) => {
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
  };
}

function createDeepgramTranscriptResponse(transcript = "raw transcript") {
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
              transcript,
              confidence: 0.98
            }
          ]
        }
      ]
    }
  });
}

function createGeminiTextResponse(text) {
  return createJsonResponse({
    responseId: "gemini-response",
    modelVersion: "gemini-test",
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            { text }
          ]
        }
      }
    ]
  });
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
