import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_GEMINI_MODEL,
  extractGeminiOutputText,
  improveTextWithGemini
} from "../src/background/gemini-improver.js";
import { buildTextImprovementPrompt } from "../src/background/text-improvement-prompts.js";
import { createTextImprovementClient } from "../src/background/text-improvement-client.js";
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
    assert.equal(request.body.store, false);
    assert.match(request.body.systemInstruction.parts[0].text, /Return only the transformed text/);
    assert.equal(request.body.contents[0].role, "user");
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
