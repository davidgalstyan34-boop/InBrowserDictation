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

  });

  it("classifies invalid API-key 400 responses as auth failures with safe diagnostics", async () => {
    let requestCount = 0;

    await assert.rejects(
      improveTextWithGemini({
        text: "hello",
        style,
        settings: { llmApiKey: "bad-key" },
        fetchApi: async () => {
          requestCount += 1;
          return new Response(JSON.stringify({
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              message: "API key not valid. Please pass a valid API key."
            }
          }), { status: 400 });
        }
      }),
      (error) => {
        assert.equal(error.code, "LLM_AUTH_FAILED");
        assert.equal(error.providerStatus, 400);
        assert.equal(error.providerErrorCode, "400");
        assert.equal(error.providerErrorStatus, "INVALID_ARGUMENT");
        assert.equal(error.providerModel, DEFAULT_GEMINI_MODEL);
        assert.equal(error.requestShape, "snake-case-system-instruction");
        return true;
      }
    );

    assert.equal(requestCount, 1);
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

  it("tries request-shape fallback before moving to the next Gemini model", async () => {
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

      if (requests.length === 2) {
        return new Response(JSON.stringify({
          error: {
            code: 400,
            status: "INVALID_ARGUMENT",
            message: `The model ${DEFAULT_GEMINI_MODEL} is not supported for generateContent.`
          }
        }), { status: 400 });
      }

      return new Response(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                { text: "Ordered fallback result." }
              ]
            },
            finishReason: "STOP"
          }
        ]
      }), { status: 200 });
    };

    const result = await improveTextWithGemini({
      text: "ordered fallback result",
      style,
      settings: { llmApiKey: "gemini-key" },
      fetchApi
    });

    assert.equal(requests.length, 3);
    assert.equal(
      requests[0].url,
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`
    );
    assert.equal(
      requests[1].url,
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`
    );
    assert.equal(
      requests[2].url,
      `https://generativelanguage.googleapis.com/v1beta/models/${FALLBACK_GEMINI_MODELS[0]}:generateContent`
    );
    assert.equal("system_instruction" in requests[0].body, true);
    assert.equal("systemInstruction" in requests[1].body, true);
    assert.equal("system_instruction" in requests[2].body, true);
    assert.equal(result.text, "Ordered fallback result.");
    assert.equal(result.providerMeta.model, FALLBACK_GEMINI_MODELS[0]);
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

  it("remembers the model and shape that worked and starts there next time", async () => {
    const urls = [];
    const compatibility = createInMemoryCompatibility();
    const fetchApi = async (url) => {
      urls.push(String(url));

      if (isRequestForModel(url, DEFAULT_GEMINI_MODEL)) {
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
          { content: { parts: [{ text: "Result." }] }, finishReason: "STOP" }
        ]
      }), { status: 200 });
    };

    const request = () => improveTextWithGemini({
      text: "some transcript",
      style,
      settings: { llmApiKey: "gemini-key" },
      fetchApi,
      compatibility
    });

    await request();
    assert.equal(urls.length, 2, "first request probes the unavailable primary model");

    urls.length = 0;
    await request();

    // The unavailable primary model is not probed again.
    assert.equal(urls.length, 1);
    assert.equal(isRequestForModel(urls[0], FALLBACK_GEMINI_MODELS[0]), true);
    assert.deepEqual(await compatibility.load(), {
      model: FALLBACK_GEMINI_MODELS[0],
      requestShape: "snake-case-system-instruction"
    });
  });

  it("falls back to the full ladder when the remembered model stops working", async () => {
    const urls = [];
    const compatibility = createInMemoryCompatibility({
      model: FALLBACK_GEMINI_MODELS[0],
      requestShape: "snake-case-system-instruction"
    });
    const fetchApi = async (url) => {
      urls.push(String(url));

      if (isRequestForModel(url, FALLBACK_GEMINI_MODELS[0])) {
        return new Response(JSON.stringify({
          error: {
            code: 404,
            status: "NOT_FOUND",
            message: `models/${FALLBACK_GEMINI_MODELS[0]} is not found for API version v1beta.`
          }
        }), { status: 404 });
      }

      return new Response(JSON.stringify({
        candidates: [
          { content: { parts: [{ text: "Recovered." }] }, finishReason: "STOP" }
        ]
      }), { status: 200 });
    };

    const result = await improveTextWithGemini({
      text: "some transcript",
      style,
      settings: { llmApiKey: "gemini-key" },
      fetchApi,
      compatibility
    });

    assert.equal(result.text, "Recovered.");
    assert.equal(isRequestForModel(urls[0], FALLBACK_GEMINI_MODELS[0]), true);
    assert.equal(isRequestForModel(urls[1], DEFAULT_GEMINI_MODEL), true);
    assert.equal((await compatibility.load()).model, DEFAULT_GEMINI_MODEL);
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

function createInMemoryCompatibility(initialValue = null) {
  let value = initialValue;

  return {
    load: async () => value,
    save: async (nextValue) => {
      value = nextValue;
      return value;
    }
  };
}

// Model names are prefixes of one another (gemini-3.5-flash-lite contains
// gemini-3.5-flash), so stubs must match the whole path segment.
function isRequestForModel(url, model) {
  return String(url).endsWith(`/${model}:generateContent`);
}
