import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDictationController } from "../src/background/controller/dictation-controller.js";
import { DictationStatus } from "../src/shared/dictation-state.js";
import { MessageType } from "../src/shared/messages.js";
import {
  createChromeApi,
  createDeepgramTranscriptResponse,
  createDeferred,
  createRecordingRuntimeHandler,
  createTestAudioPayload,
  getPublicSession,
  sendOffscreenMessage,
  sendPermissionResult,
  sendRuntimeMessage,
  withMutedConsole
} from "./helpers/dictation-controller-harness.mjs";

describe("dictation controller: interruptions and recovery", () => {
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
        (await getPublicSession(controller)).status,
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

      const session = await getPublicSession(controller);
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

      assert.equal((await getPublicSession(controller)).status, DictationStatus.IDLE);

      await sendPermissionResult(controller, "session-before-suspension", {
        granted: true,
        tabId: 7
      });

      const session = await getPublicSession(controller);
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
      assert.equal((await getPublicSession(controller)).status, DictationStatus.IDLE);
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
      assert.equal((await getPublicSession(controller)).status, DictationStatus.STARTING);

      const cancelResponse = await sendRuntimeMessage(
        controller,
        MessageType.RUNTIME_CANCEL_DICTATION
      );

      assert.equal(cancelResponse.ok, true);
      assert.equal((await getPublicSession(controller)).status, DictationStatus.IDLE);
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

  it("transcribes a recording that stopped at the duration cap", async () => {
    await withMutedConsole(async () => {
      const originalFetch = globalThis.fetch;
      const tabMessages = [];
      const runtimeMessages = [];

      globalThis.fetch = async (url) => {
        if (String(url).startsWith("https://api.deepgram.com/")) {
          return createDeepgramTranscriptResponse("capped transcript");
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      };

      try {
        const chromeApi = createChromeApi({
          storedSettings: { sttApiKey: "deepgram-key", defaultStyleId: "raw" },
          tabMessages,
          runtimeSendMessage: createRecordingRuntimeHandler(runtimeMessages)
        });
        const controller = createDictationController({
          chromeApi,
          clientsApi: null,
          cryptoApi: { randomUUID: () => "session-capped" }
        });

        await controller.handleCommand("toggle-dictation", { tab: { id: 7 } });
        assert.equal((await getPublicSession(controller)).status, DictationStatus.RECORDING);

        // The offscreen recorder reports that it stopped itself; the user never
        // pressed stop, so the pipeline has to continue on its own.
        const response = await sendOffscreenMessage(
          controller,
          MessageType.OFFSCREEN_RECORDING_DURATION_CAPPED,
          "session-capped"
        );

        assert.equal(response.ok, true);
        assert.equal((await getPublicSession(controller)).status, DictationStatus.SUCCESS);
        assert.equal(
          runtimeMessages.some((message) => (
            message.type === MessageType.OFFSCREEN_STOP_RECORDING
          )),
          true
        );

        const limitNotice = tabMessages
          .map(({ message }) => message)
          .filter((message) => message.type === MessageType.CONTENT_SHOW_STATE)
          .find((message) => message.payload.title === "Recording limit reached");
        assert.ok(limitNotice, "the page is told why recording ended");
        assert.equal(limitNotice.payload.tone, "warning");

        const popupState = await sendRuntimeMessage(controller, MessageType.RUNTIME_GET_POPUP_STATE);
        assert.equal(popupState.recentResult.finalText, "capped transcript");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it("collects capped audio after the worker was restarted by the report", async () => {
    await withMutedConsole(async () => {
      const originalFetch = globalThis.fetch;
      const runtimeMessages = [];

      globalThis.fetch = async (url) => {
        if (String(url).startsWith("https://api.deepgram.com/")) {
          return createDeepgramTranscriptResponse("recovered capped transcript");
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      };

      try {
        const chromeApi = createChromeApi({
          storedSettings: { sttApiKey: "deepgram-key", defaultStyleId: "raw" },
          tabMessages: [],
          // The offscreen document is still alive and holding the capped audio.
          contexts: [{ url: "chrome-extension://test/offscreen/recorder.html" }],
          runtimeSendMessage: async (message) => {
            runtimeMessages.push(message);

            if (message.type === MessageType.OFFSCREEN_GET_RECORDING_STATE) {
              return {
                ok: true,
                recording: {
                  sessionId: "session-capped-before-restart",
                  tabId: 7,
                  startedAt: 1000,
                  mimeType: "audio/webm",
                  durationCapped: true
                }
              };
            }

            if (message.type === MessageType.OFFSCREEN_STOP_RECORDING) {
              return { ok: true, audio: createTestAudioPayload() };
            }

            return { ok: true };
          }
        });
        // A fresh controller stands in for a worker restarted by the report.
        const controller = createDictationController({
          chromeApi,
          clientsApi: null,
          cryptoApi: { randomUUID: () => "unused" }
        });

        assert.equal((await getPublicSession(controller)).status, DictationStatus.IDLE);

        await sendOffscreenMessage(
          controller,
          MessageType.OFFSCREEN_RECORDING_DURATION_CAPPED,
          "session-capped-before-restart"
        );

        const session = await getPublicSession(controller);
        assert.equal(session.status, DictationStatus.SUCCESS);
        assert.equal(session.id, "session-capped-before-restart");

        const popupState = await sendRuntimeMessage(controller, MessageType.RUNTIME_GET_POPUP_STATE);
        assert.equal(popupState.recentResult.finalText, "recovered capped transcript");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

});
