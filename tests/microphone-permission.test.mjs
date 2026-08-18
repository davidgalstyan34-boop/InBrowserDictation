import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MICROPHONE_SETTINGS_URL,
  MicrophoneAccessState,
  openChromeMicrophoneSettings,
  requestMicrophoneAccess
} from "../src/permissions/microphone-access.js";

describe("microphone permission access", () => {
  it("does not retry getUserMedia when Chrome already reports denied access", async () => {
    let requestCount = 0;

    const result = await requestMicrophoneAccess({
      permissionsApi: {
        query: async () => ({ state: "denied" })
      },
      mediaDevices: {
        getUserMedia: async () => {
          requestCount += 1;
        }
      }
    });

    assert.equal(result.state, MicrophoneAccessState.DENIED);
    assert.equal(result.error.code, "MICROPHONE_PERMISSION_DENIED");
    assert.equal(requestCount, 0);
  });

  it("treats the real media denial as authoritative on macOS", async () => {
    const result = await requestMicrophoneAccess({
      // Chrome can report granted here while macOS blocks Chrome itself.
      permissionsApi: {
        query: async () => ({ state: "granted" })
      },
      mediaDevices: {
        getUserMedia: async () => {
          throw new DOMException("Permission denied by system", "NotAllowedError");
        }
      }
    });

    assert.equal(result.state, MicrophoneAccessState.DENIED);
    assert.equal(result.error.code, "MICROPHONE_PERMISSION_DENIED");
  });

  it("returns a granted test stream when browser and system access succeed", async () => {
    const stream = { getTracks: () => [] };
    const result = await requestMicrophoneAccess({
      permissionsApi: {
        query: async () => ({ state: "prompt" })
      },
      mediaDevices: {
        getUserMedia: async () => stream
      }
    });

    assert.equal(result.state, MicrophoneAccessState.GRANTED);
    assert.equal(result.stream, stream);
  });

  it("falls back to getUserMedia when the permission query is unavailable", async () => {
    const stream = { getTracks: () => [] };
    const result = await requestMicrophoneAccess({
      permissionsApi: {
        query: async () => {
          throw new TypeError("Permission name is unsupported");
        }
      },
      mediaDevices: {
        getUserMedia: async () => stream
      }
    });

    assert.equal(result.state, MicrophoneAccessState.GRANTED);
  });

  it("opens settings in the last focused normal Chrome window", async () => {
    const calls = [];
    const chromeApi = {
      tabs: {
        create: async (options) => calls.push(["create", options])
      },
      windows: {
        getLastFocused: async (options) => {
          calls.push(["getLastFocused", options]);
          return { id: 17 };
        },
        update: async (windowId, options) => calls.push(["update", windowId, options])
      }
    };

    await openChromeMicrophoneSettings(chromeApi);

    assert.deepEqual(calls, [
      ["getLastFocused", { windowTypes: ["normal"] }],
      ["create", { url: MICROPHONE_SETTINGS_URL, active: true, windowId: 17 }],
      ["update", 17, { focused: true }]
    ]);
  });
});
