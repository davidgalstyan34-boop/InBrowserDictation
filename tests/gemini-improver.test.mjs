import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_GEMINI_MODEL,
  FALLBACK_GEMINI_MODELS,
  extractGeminiOutputText,
  improveTextWithGemini
} from "../src/background/providers/gemini-improver.js";
import { buildTextImprovementPrompt } from "../src/background/providers/text-improvement-prompts.js";
import { createTextImprovementClient } from "../src/background/providers/text-improvement-client.js";
import { DEFAULT_SETTINGS } from "../src/shared/settings.js";

const style = Object.freeze({
  id: "professional",
  name: "Professional",
  instructions: "Make it concise and businesslike."
});

describe("Gemini text improver", () => {
  it("builds prompt instructions that preserve transcript facts", () => {
    const prompt = buildTextImprovementPrompt({
      text: "call Alice on 2026-08-13 about ticket ABC-123",
      style
    });

    assert.match(prompt.instructions, /Preserve the speaker's meaning/);
    assert.match(prompt.instructions, /names, dates, numbers, URLs, identifiers/);
    assert.match(prompt.instructions, /Make it concise and businesslike/);
    assert.match(prompt.userText, /<transcript>/);
    assert.deepEqual(Object.keys(prompt), ["instructions", "userText"]);
  });

  it("posts code-owned instructions to Gemini Generate Content", async () => {
    let request = null;
    const fetchApi = async (url, options) => {
      request = {
        url,
        options,
        body: JSON.parse(options.body)
      };

      return new Response(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: "Hello world." }
              ],
              role: "model"
            },
            finishReason: "STOP"
          }
        ],
        modelVersion: "gemini-3.5-flash-lite-001",
        responseId: "response-123"
      }), { status: 200 });
    };

    const result = await improveTextWithGemini({
      text: "hello world",
      style,
      settings: { llmApiKey: "gemini-key" },
      fetchApi
    });

    assert.equal(
      request.url,
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`
    );
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers["x-goog-api-key"], "gemini-key");
    assert.equal("store" in request.body, false);
    assert.match(request.body.system_instruction.parts[0].text, /Return only the transformed text/);
    assert.equal("role" in request.body.contents[0], false);
    assert.match(request.body.contents[0].parts[0].text, /hello world/);
    assert.deepEqual(result, {
      text: "Hello world.",
      styleId: "professional",
      providerMeta: {
        provider: "gemini",
        model: "gemini-3.5-flash-lite-001",
        responseId: "response-123",
        finishReason: "STOP"
      }
    });
  });

  it("extracts output text from candidate part arrays", () => {
    assert.equal(extractGeminiOutputText({
      candidates: [
        {
          content: {
            parts: [
              { text: "First." },
              { functionCall: { name: "ignored" } }
            ]
          }
        },
        {
          content: {
            parts: [
              { text: "Second." }
            ]
          }
        }
      ]
    }), "First.\nSecond.");
  });

  it("normalizes auth failures, prompt blocks, and empty responses", async () => {
    await assert.rejects(
      improveTextWithGemini({
        text: "hello",
        style,
        settings: { llmApiKey: "bad-key" },
        fetchApi: async () => new Response("{}", { status: 401 })
      }),
      { code: "LLM_AUTH_FAILED" }
    );

    await assert.rejects(
      improveTextWithGemini({
        text: "hello",
        style,
        settings: { llmApiKey: "gemini-key" },
        fetchApi: async () => new Response(JSON.stringify({
          promptFeedback: { blockReason: "SAFETY" }
        }), { status: 200 })
      }),
      { code: "LLM_PROVIDER_REJECTED_TEXT" }
    );

    await assert.rejects(
      improveTextWithGemini({
        text: "hello",
        style,
        settings: { llmApiKey: "gemini-key" },
        fetchApi: async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })
      }),
      { code: "LLM_EMPTY_TEXT" }
    );

    await assert.rejects(
      improveTextWithGemini({
        text: "hello",
        style,
        settings: { llmApiKey: "bad-key" },
        fetchApi: async () => new Response(JSON.stringify({
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message: "API key not valid. Please pass a valid API key."
          }
        }), { status: 400 })
      }),
      { code: "LLM_AUTH_FAILED" }
    );
  });

  it("retries with alternate request shapes when Gemini rejects a REST field name", async () => {
    const requests = [];
    const fetchApi = async (url, options) => {
      requests.push({
        url,
        body: JSON.parse(options.body)
      });

      if (requests.length === 1) {
        return new Response(JSON.stringify({
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message: "Invalid JSON payload received. Unknown name \"system_instruction\": Cannot find field."
          }
        }), { status: 400 });
      }

      return new Response(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: "Shape-compatible result." }
              ]
            },
            finishReason: "STOP"
          }
        ]
      }), { status: 200 });
    };

    const result = await improveTextWithGemini({
      text: "shape compatible result",
      style,
      settings: { llmApiKey: "gemini-key" },
      fetchApi
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, requests[1].url);
    assert.match(requests[0].body.system_instruction.parts[0].text, /Return only the transformed text/);
    assert.equal("systemInstruction" in requests[0].body, false);
    assert.equal("store" in requests[1].body, false);
    assert.match(requests[1].body.systemInstruction.parts[0].text, /Return only the transformed text/);
    assert.equal("system_instruction" in requests[1].body, false);
    assert.equal(result.text, "Shape-compatible result.");
    assert.equal(result.providerMeta.model, DEFAULT_GEMINI_MODEL);
  });

  it("falls back to inline instructions when Gemini rejects dedicated system instruction fields", async () => {
    const requests = [];
    const fetchApi = async (url, options) => {
      requests.push(JSON.parse(options.body));

      if (requests.length < 3) {
        return new Response(JSON.stringify({
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message: "Developer instruction is not enabled for this request."
          }
        }), { status: 400 });
      }

      return new Response(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: "Inline-compatible result." }
              ]
            },
            finishReason: "STOP"
          }
        ]
      }), { status: 200 });
    };

    const result = await improveTextWithGemini({
      text: "inline compatible result",
      style,
      settings: { llmApiKey: "gemini-key" },
      fetchApi
    });

    assert.equal(requests.length, 3);
    assert.equal("system_instruction" in requests[2], false);
    assert.equal("systemInstruction" in requests[2], false);
    assert.match(requests[2].contents[0].parts[0].text, /Return only the transformed text/);
    assert.match(requests[2].contents[0].parts[0].text, /inline compatible result/);
    assert.equal(result.text, "Inline-compatible result.");
  });

  it("falls back to a stable Gemini model when the primary model is unavailable", async () => {
    const urls = [];
    const fetchApi = async (url) => {
      urls.push(url);

      if (urls.length === 1) {
        return new Response(JSON.stringify({
          error: {
            code: 404,
            status: "NOT_FOUND",
            message: `models/${DEFAULT_GEMINI_MODEL} is not found for API version v1beta.`
          }
        }), { status: 404 });
      }

      return new Response(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: "Fallback model result." }
              ]
            },
            finishReason: "STOP"
          }
        ]
      }), { status: 200 });
    };

    const result = await improveTextWithGemini({
      text: "fallback model result",
      style,
      settings: { llmApiKey: "gemini-key" },
      fetchApi
    });

    assert.equal(
      urls[0],
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`
    );
    assert.equal(
      urls[1],
      `https://generativelanguage.googleapis.com/v1beta/models/${FALLBACK_GEMINI_MODELS[0]}:generateContent`
    );
    assert.equal(result.text, "Fallback model result.");
    assert.equal(result.providerMeta.model, FALLBACK_GEMINI_MODELS[0]);
  });

  it("bypasses provider calls when the Raw style is selected", async () => {
    const client = createTextImprovementClient({
      storageArea: {
        get: async () => ({
          ...DEFAULT_SETTINGS,
          defaultStyleId: "raw",
          llmApiKey: ""
        })
      },
      fetchApi: async () => {
        throw new Error("Raw style should not call the provider.");
      }
    });

    assert.deepEqual(await client.improveText({ text: "keep this raw" }), {
      text: "keep this raw",
      styleId: "raw",
      source: "raw-style",
      providerMeta: {
        provider: "none",
        bypassed: true
      }
    });
  });
});
