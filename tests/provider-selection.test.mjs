import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  IMPLEMENTED_STT_PROVIDERS,
  createSpeechToTextClient
} from "../src/background/providers/speech-to-text-client.js";
import { IMPLEMENTED_LLM_PROVIDERS } from "../src/background/providers/text-improvement-client.js";
import {
  DEFAULT_SETTINGS,
  SUPPORTED_LLM_PROVIDERS,
  SUPPORTED_STT_PROVIDERS
} from "../src/shared/settings.js";
import { createMemorySettingsStorage } from "./helpers/settings-storage.mjs";

describe("provider selection", () => {
  it("offers exactly the providers it can actually run", () => {
    // The options page validates against the SUPPORTED_ lists while the facades
    // dispatch on the IMPLEMENTED_ registries. If those drift, a user could
    // select a provider that silently runs a different one.
    assert.deepEqual([...SUPPORTED_STT_PROVIDERS].sort(), [...IMPLEMENTED_STT_PROVIDERS].sort());
    assert.deepEqual([...SUPPORTED_LLM_PROVIDERS].sort(), [...IMPLEMENTED_LLM_PROVIDERS].sort());
  });

  it("defaults to a provider it can run", () => {
    assert.ok(IMPLEMENTED_STT_PROVIDERS.includes(DEFAULT_SETTINGS.sttProvider));
    assert.ok(IMPLEMENTED_LLM_PROVIDERS.includes(DEFAULT_SETTINGS.llmProvider));
  });

  it("dispatches transcription on the stored provider", async () => {
    let requestedUrl = "";
    const client = createSpeechToTextClient({
      settingsStorage: createMemorySettingsStorage({
        sttProvider: "deepgram",
        sttApiKey: "deepgram-key"
      }),
      fetchApi: async (url) => {
        requestedUrl = String(url);
        return new Response(JSON.stringify({
          results: { channels: [{ alternatives: [{ transcript: "hello" }] }] }
        }), { status: 200 });
      }
    });

    const result = await client.transcribe({
      audio: { mimeType: "audio/webm", dataUrl: "data:audio/webm;base64,AAAA" }
    });

    assert.equal(result.transcript, "hello");
    assert.match(requestedUrl, /api\.deepgram\.com/);
  });

  it("repairs a stored provider the build cannot run", async () => {
    // The settings normalizer clamps an unknown provider to the default and
    // drops the key stored alongside it, since a key issued for another
    // provider is meaningless. The user is asked for the right key rather than
    // having the request fail somewhere deeper. This is why the facades'
    // unsupported-provider guards are assertions rather than a reachable
    // user-facing path, and why the drift test above is the real protection.
    const client = createSpeechToTextClient({
      settingsStorage: createMemorySettingsStorage({
        sttProvider: "whisper",
        sttApiKey: "whisper-key"
      }),
      fetchApi: async () => {
        throw new Error("No provider request should be attempted without a key.");
      }
    });

    await assert.rejects(
      client.transcribe({
        audio: { mimeType: "audio/webm", dataUrl: "data:audio/webm;base64,AAAA" }
      }),
      { code: "STT_API_KEY_MISSING" }
    );
  });
});
