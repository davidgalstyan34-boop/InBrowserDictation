import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDictationController } from "../src/background/controller/dictation-controller.js";
import { MessageType } from "../src/shared/messages.js";
import {
  createChromeApi,
  createDeepgramTranscriptResponse,
  createRecordingRuntimeHandler,
  sendRuntimeMessage,
  withMutedConsole
} from "./helpers/dictation-controller-harness.mjs";

describe("dictation controller: popup surface", () => {
  it("forgets the stored result when the popup clears it", async () => {
    await withMutedConsole(async () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = async (url) => {
        if (String(url).startsWith("https://api.deepgram.com/")) {
          return createDeepgramTranscriptResponse("forgettable transcript");
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
      };

      try {
        const chromeApi = createChromeApi({
          storedSettings: { sttApiKey: "deepgram-key", defaultStyleId: "raw" },
          tabMessages: [],
          runtimeSendMessage: createRecordingRuntimeHandler([])
        });
        const controller = createDictationController({
          chromeApi,
          clientsApi: null,
          cryptoApi: { randomUUID: () => "session-clearable" }
        });

        await controller.handleCommand("toggle-dictation", { tab: { id: 7 } });
        await controller.handleCommand("toggle-dictation", { tab: { id: 7 } });

        const before = await sendRuntimeMessage(controller, MessageType.RUNTIME_GET_POPUP_STATE);
        assert.equal(before.recentResult.finalText, "forgettable transcript");

        const cleared = await sendRuntimeMessage(controller, MessageType.RUNTIME_CLEAR_RECENT_RESULT);
        assert.equal(cleared.recentResult, null);

        const after = await sendRuntimeMessage(controller, MessageType.RUNTIME_GET_POPUP_STATE);
        assert.equal(after.recentResult, null);
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
