import { MessageType, createEnvelope } from "../../src/shared/messages.js";

// Shared fixtures for the dictation-controller suites. The controller needs a
// fairly complete Chrome stand-in, so it is built once here rather than in each
// suite that drives a full session.

export function createChromeApi({
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

export async function getPublicSession(controller) {
  const popupState = await sendRuntimeMessage(controller, MessageType.RUNTIME_GET_POPUP_STATE);
  return popupState.session;
}

export function sendOffscreenMessage(controller, type, sessionId) {
  return new Promise((resolve) => {
    controller.handleRuntimeMessage({
      rawMessage: createEnvelope(type, {}, sessionId),
      sender: {},
      sendResponse: resolve
    });
  });
}

export function sendPermissionResult(controller, sessionId, payload) {
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

export function sendRuntimeMessage(controller, type, payload = {}) {
  return new Promise((resolve) => {
    controller.handleRuntimeMessage({
      rawMessage: createEnvelope(type, payload),
      sender: {},
      sendResponse: resolve
    });
  });
}

export function createTestAudioPayload() {
  return {
    mimeType: "audio/webm",
    sizeBytes: 1024,
    durationMs: 1200,
    capturedAt: 1000,
    dataUrl: "data:audio/webm;base64,aGVsbG8="
  };
}

export function createRecordingRuntimeHandler(runtimeMessages) {
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

export function createDeepgramTranscriptResponse(transcript = "raw transcript") {
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

export function createGeminiTextResponse(text) {
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

export function createDeferred() {
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

export function createJsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload
  };
}

export async function withMutedConsole(action) {
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

