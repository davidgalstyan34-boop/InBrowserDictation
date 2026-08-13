import { buildTextImprovementPrompt } from "./text-improvement-prompts.js";
import {
  createTextImprovementError,
  normalizeTextImprovementError
} from "./text-improvement-errors.js";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_LLM_TIMEOUT_MS = 45_000;

/**
 * Gemini Generate Content API implementation of text improvement.
 *
 * The request is stateless: each transcript rewrite sends the code-owned
 * instructions and source text once, then returns normalized provider metadata.
 */
export async function improveTextWithGemini({
  text,
  style,
  settings,
  fetchApi = globalThis.fetch,
  signal = null,
  timeoutMs = DEFAULT_LLM_TIMEOUT_MS
}) {
  const apiKey = settings?.llmApiKey?.trim();
  if (!apiKey) {
    throw createTextImprovementError(
      "LLM_API_KEY_MISSING",
      "Add a Gemini API key in extension options before text improvement."
    );
  }

  if (typeof fetchApi !== "function") {
    throw createTextImprovementError(
      "LLM_FETCH_UNAVAILABLE",
      "Text-improvement network requests are unavailable in this browser."
    );
  }

  if (!isUsableText(text)) {
    throw createTextImprovementError(
      "LLM_TEXT_MISSING",
      "No transcript text is available for improvement."
    );
  }

  const prompt = buildTextImprovementPrompt({ text, style });
  const model = normalizeGeminiModel(settings?.llmModel) || DEFAULT_GEMINI_MODEL;
  const requestSignal = createRequestSignal({ parentSignal: signal, timeoutMs });

  try {
    const response = await fetchApi(createGeminiGenerateContentUrl(model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            { text: prompt.instructions }
          ]
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt.userText }
            ]
          }
        ],
        store: false
      }),
      signal: requestSignal.signal
    });

    if (!response.ok) {
      throw createGeminiHttpError(response);
    }

    const payload = await readJsonResponse(response);
    const improvedText = extractGeminiOutputText(payload);
    if (!improvedText) {
      throw createGeminiEmptyTextError(payload);
    }

    return {
      text: improvedText,
      styleId: style?.id ?? "default",
      providerMeta: createGeminiProviderMeta(payload, model)
    };
  } catch (error) {
    throw normalizeTextImprovementError(error, {
      timedOut: requestSignal.timedOut()
    });
  } finally {
    requestSignal.cleanup();
  }
}

/**
 * Extracts generated text from Gemini GenerateContentResponse payloads.
 */
export function extractGeminiOutputText(payload) {
  const candidates = payload?.candidates;
  if (!Array.isArray(candidates)) {
    return "";
  }

  return candidates
    .flatMap((candidate) => Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
      : [])
    .map((part) => typeof part?.text === "string" ? part.text.trim() : "")
    .filter(Boolean)
    .join("\n");
}

function createGeminiHttpError(response) {
  const statusMessages = {
    400: ["LLM_PROVIDER_REJECTED_TEXT", "Gemini could not improve this transcript."],
    401: ["LLM_AUTH_FAILED", "Gemini rejected the API key."],
    403: ["LLM_AUTH_FAILED", "Gemini rejected the API key."],
    429: ["LLM_RATE_LIMITED", "Gemini rate limit reached. The raw transcript is still available."]
  };

  const [code, message] = statusMessages[response.status] ?? (
    response.status >= 500
      ? ["LLM_PROVIDER_UNAVAILABLE", "Gemini is temporarily unavailable. The raw transcript is still available."]
      : ["LLM_PROVIDER_FAILED", "Gemini text improvement failed. The raw transcript is still available."]
  );

  return createTextImprovementError(code, message);
}

function createGeminiEmptyTextError(payload) {
  const blockReason = payload?.promptFeedback?.blockReason;
  if (blockReason) {
    return createTextImprovementError(
      "LLM_PROVIDER_REJECTED_TEXT",
      "Gemini blocked this transcript. The raw transcript is still available."
    );
  }

  const finishReason = payload?.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== "STOP") {
    return createTextImprovementError(
      "LLM_PROVIDER_FAILED",
      "Gemini did not return a complete improved text. The raw transcript is still available."
    );
  }

  return createTextImprovementError(
    "LLM_EMPTY_TEXT",
    "Gemini returned no improved text. The raw transcript is still available."
  );
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    throw createTextImprovementError(
      "LLM_INVALID_RESPONSE",
      "Gemini returned invalid JSON. The raw transcript is still available.",
      error
    );
  }
}

function createGeminiProviderMeta(payload, requestedModel) {
  return {
    provider: "gemini",
    model: payload?.modelVersion ?? requestedModel,
    responseId: payload?.responseId ?? null,
    finishReason: payload?.candidates?.[0]?.finishReason ?? null
  };
}

function createGeminiGenerateContentUrl(model) {
  return `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
}

function normalizeGeminiModel(model) {
  if (typeof model !== "string") {
    return "";
  }

  return model.trim().replace(/^models\//, "");
}

function isUsableText(text) {
  return typeof text === "string" && text.trim().length > 0;
}

function createRequestSignal({ parentSignal, timeoutMs }) {
  const controller = new AbortController();
  let timeoutId = null;
  let didTimeOut = false;

  const abortFromParent = () => {
    controller.abort(parentSignal.reason);
  };

  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else if (parentSignal) {
    parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      didTimeOut = true;
      controller.abort();
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (parentSignal) {
        parentSignal.removeEventListener("abort", abortFromParent);
      }
    }
  };
}
