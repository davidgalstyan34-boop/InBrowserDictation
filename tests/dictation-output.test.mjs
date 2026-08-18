import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDictationController } from "../src/background/controller/dictation-controller.js";
import { DictationStatus } from "../src/shared/dictation-state.js";
import { MessageType } from "../src/shared/messages.js";
import {
  createChromeApi,
  createDeepgramTranscriptResponse,
  createJsonResponse,
  createRecordingRuntimeHandler,
  createTestAudioPayload,
  getPublicSession,
  sendRuntimeMessage,
  withMutedConsole
} from "./helpers/dictation-controller-harness.mjs";

describe("dictation controller: output and fallback", () => {
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

        assert.equal((await getPublicSession(controller)).status, DictationStatus.SUCCESS);
        assert.equal((await getPublicSession(controller)).warning.code, "LLM_AUTH_FAILED");
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
        assert.equal(retry.recentResult.finalTextLength, "Retried polished result.".length);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it("copies popup-started dictation when no editable target was focused", async () => {
    await withMutedConsole(async () => {
      const originalFetch = globalThis.fetch;
      const tabMessages = [];
      const runtimeMessages = [];

      globalThis.fetch = async (url) => {
        if (String(url).startsWith("https://api.deepgram.com/")) {
          return createDeepgramTranscriptResponse("clipboard transcript");
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      };

      try {
        const chromeApi = createChromeApi({
          storedSettings: {
            sttApiKey: "deepgram-key",
            defaultStyleId: "raw"
          },
          prepareTarget: { kind: "none" },
          tabMessages,
          insertTextResponse: {
            ok: false,
            error: {
              code: "INSERTION_TARGET_MISSING",
              message: "No editable target is available for insertion."
            }
          },
          runtimeSendMessage: createRecordingRuntimeHandler(runtimeMessages)
        });
        const controller = createDictationController({
          chromeApi,
          clientsApi: null,
          cryptoApi: {
            randomUUID: () => "session-popup-no-target"
          }
        });

        await sendRuntimeMessage(controller, MessageType.RUNTIME_TOGGLE_DICTATION);
        await sendRuntimeMessage(controller, MessageType.RUNTIME_TOGGLE_DICTATION);

        const session = await getPublicSession(controller);
        const clipboardMessage = runtimeMessages.find((message) => (
          message.type === MessageType.OFFSCREEN_WRITE_CLIPBOARD
        ));
        const completionState = tabMessages
          .map(({ message }) => message)
          .filter((message) => message.type === MessageType.CONTENT_SHOW_STATE)
          .at(-1);

        assert.equal(session.status, DictationStatus.SUCCESS);
        assert.equal(session.insertion.method, "clipboard");
        assert.equal(session.insertion.strategy, "offscreen-clipboard");
        assert.equal(session.insertion.fallbackReason, "INSERTION_TARGET_MISSING");
        assert.equal(clipboardMessage.payload.text, "clipboard transcript");
        assert.equal(completionState.payload.title, "Copied to clipboard");
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
              code: "INSERTION_TARGET_MISSING",
              message: "No editable target is available for insertion."
            }
          },
          runtimeSendMessage: createRecordingRuntimeHandler([], {
            clipboardResponse: {
              ok: false,
              error: {
                code: "CLIPBOARD_WRITE_FAILED",
                message: "Chrome did not allow the extension to write to the clipboard."
              }
            }
          })
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

        assert.equal((await getPublicSession(controller)).status, DictationStatus.ERROR);

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

});
