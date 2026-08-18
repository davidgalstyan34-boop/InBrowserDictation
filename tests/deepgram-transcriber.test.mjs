import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { audioPayloadToBlob } from "../src/background/providers/audio-payload.js";
import {
  DEFAULT_STT_TIMEOUT_MS,
  extractDeepgramTranscript,
  transcribeWithDeepgram
} from "../src/background/providers/deepgram-transcriber.js";

const audio = Object.freeze({
  mimeType: "audio/webm",
  dataUrl: "data:audio/webm;base64,aGVsbG8="
});

describe("deepgram transcriber", () => {
  it("times out before Chrome can terminate a slow service-worker fetch", () => {
    assert.equal(DEFAULT_STT_TIMEOUT_MS, 20_000);
    assert.ok(DEFAULT_STT_TIMEOUT_MS < 30_000);
  });

  it("decodes recorder audio payloads into provider blobs", async () => {
    const blob = audioPayloadToBlob(audio);

    assert.equal(blob.type, "audio/webm");
    assert.equal(await blob.text(), "hello");
  });

  it("decodes recorder data URLs with MIME parameters", async () => {
    const blob = audioPayloadToBlob({
      dataUrl: "data:audio/webm;codecs=opus;base64,aGVsbG8="
    });

    assert.equal(blob.type, "audio/webm;codecs=opus");
    assert.equal(await blob.text(), "hello");
  });

  it("posts audio to Deepgram and parses transcript metadata", async () => {
    let request = null;
    const fetchApi = async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        metadata: {
          request_id: "request-123",
          duration: 1.4
        },
        results: {
          channels: [
            {
              alternatives: [
                {
                  transcript: "Hello there.",
                  confidence: 0.98
                }
              ]
            }
          ]
        }
      }), { status: 200 });
    };

    const result = await transcribeWithDeepgram({
      audioBlob: audioPayloadToBlob(audio),
      mimeType: audio.mimeType,
      settings: { sttApiKey: "dg-key" },
      fetchApi
    });

    assert.equal(request.url, "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers.Authorization, "Token dg-key");
    assert.equal(request.options.headers["Content-Type"], "audio/webm");
    assert.equal(request.options.body.type, "audio/webm");
    assert.equal(result.transcript, "Hello there.");
    assert.deepEqual(result.providerMeta, {
      provider: "deepgram",
      model: "nova-3",
      requestId: "request-123",
      durationSec: 1.4,
      confidence: 0.98
    });
  });

  it("combines non-empty channel transcripts", () => {
    const transcript = extractDeepgramTranscript({
      results: {
        channels: [
          { alternatives: [{ transcript: " First channel. " }] },
          { alternatives: [{ transcript: "" }, { transcript: "Second channel." }] }
        ]
      }
    });

    assert.equal(transcript, "First channel.\nSecond channel.");
  });

  it("requires a Deepgram API key", async () => {
    await assert.rejects(
      transcribeWithDeepgram({
        audioBlob: audioPayloadToBlob(audio),
        mimeType: audio.mimeType,
        settings: { sttApiKey: " " },
        fetchApi: async () => new Response("{}")
      }),
      { code: "STT_API_KEY_MISSING" }
    );
  });

  it("normalizes auth and rate-limit failures", async () => {
    await assert.rejects(
      transcribeWithDeepgram({
        audioBlob: audioPayloadToBlob(audio),
        mimeType: audio.mimeType,
        settings: { sttApiKey: "bad-key" },
        fetchApi: async () => new Response("{}", { status: 401 })
      }),
      { code: "STT_AUTH_FAILED" }
    );

    await assert.rejects(
      transcribeWithDeepgram({
        audioBlob: audioPayloadToBlob(audio),
        mimeType: audio.mimeType,
        settings: { sttApiKey: "dg-key" },
        fetchApi: async () => new Response("{}", { status: 429 })
      }),
      { code: "STT_RATE_LIMITED" }
    );
  });

  it("rejects invalid JSON and empty transcripts", async () => {
    await assert.rejects(
      transcribeWithDeepgram({
        audioBlob: audioPayloadToBlob(audio),
        mimeType: audio.mimeType,
        settings: { sttApiKey: "dg-key" },
        fetchApi: async () => new Response("{", { status: 200 })
      }),
      { code: "STT_INVALID_RESPONSE" }
    );

    await assert.rejects(
      transcribeWithDeepgram({
        audioBlob: audioPayloadToBlob(audio),
        mimeType: audio.mimeType,
        settings: { sttApiKey: "dg-key" },
        fetchApi: async () => new Response(JSON.stringify({
          results: {
            channels: [
              { alternatives: [{ transcript: " " }] }
            ]
          }
        }), { status: 200 })
      }),
      { code: "STT_EMPTY_TRANSCRIPT" }
    );
  });
});
