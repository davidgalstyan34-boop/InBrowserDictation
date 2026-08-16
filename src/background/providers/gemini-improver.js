import { buildTextImprovementPrompt } from "./text-improvement-prompts.js";
import {
  createTextImprovementError,
  normalizeTextImprovementError
} from "./text-improvement-errors.js";
import { createRequestSignal } from "./request-signal.js";

const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const FALLBACK_GEMINI_MODELS = Object.freeze([
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash"
]);
export const GEMINI_REQUEST_SHAPES = Object.freeze([
  "snake-case-system-instruction",
  "camel-case-system-instruction",
  "inline-instructions"
]);
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
  timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
  compatibility = null
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
  const requestSignal = createRequestSignal({ parentSignal: signal, timeoutMs });

  try {
    const { payload, model: usedModel } = await generateTextWithGemini({
      apiKey,
      fetchApi,
      prompt,
      signal: requestSignal.signal,
      compatibility
    });
    const improvedText = extractGeminiOutputText(payload);
    if (!improvedText) {
      throw createGeminiEmptyTextError(payload);
    }

    return {
      text: improvedText,
      styleId: style?.id ?? "default",
      providerMeta: createGeminiProviderMeta(payload, usedModel)
    };
  } catch (error) {
    throw normalizeTextImprovementError(error, {
      timedOut: requestSignal.timedOut()
    });
  } finally {
    requestSignal.cleanup();
  }
}

async function generateTextWithGemini({ apiKey, fetchApi, prompt, signal, compatibility }) {
  const remembered = await loadRememberedPair(compatibility);
  const models = orderModelsByCompatibility(remembered);
  let lastModelError = null;

  for (const model of models) {
    try {
      const result = await requestGeminiContentWithCompatibleShape({
        apiKey,
        fetchApi,
        model,
        prompt,
        signal,
        requestShapes: orderRequestShapesByCompatibility(model, remembered)
      });

      await rememberWorkingPair(compatibility, result);
      return result;
    } catch (error) {
      if (error.retryWithFallbackModel && model !== models[models.length - 1]) {
        lastModelError = error;
        continue;
      }

      throw error;
    }
  }

  throw lastModelError ?? createTextImprovementError(
    "LLM_MODEL_UNAVAILABLE",
    "No compatible Gemini model is available. The raw transcript is still available."
  );
}

/**
 * Tries the combination that last worked before falling back to the ladder.
 */
function orderModelsByCompatibility(remembered) {
  const models = [DEFAULT_GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS];
  if (!remembered || !models.includes(remembered.model)) {
    return models;
  }

  return [remembered.model, ...models.filter((model) => model !== remembered.model)];
}

function orderRequestShapesByCompatibility(model, remembered) {
  if (remembered?.model !== model || !GEMINI_REQUEST_SHAPES.includes(remembered.requestShape)) {
    return GEMINI_REQUEST_SHAPES;
  }

  return [
    remembered.requestShape,
    ...GEMINI_REQUEST_SHAPES.filter((shape) => shape !== remembered.requestShape)
  ];
}

async function loadRememberedPair(compatibility) {
  try {
    return await compatibility?.load?.() ?? null;
  } catch {
    return null;
  }
}

async function rememberWorkingPair(compatibility, { model, requestShape }) {
  try {
    await compatibility?.save?.({ model, requestShape });
  } catch {
    // Remembering is an optimization; failing to store it costs one probe.
  }
}

async function requestGeminiContentWithCompatibleShape({
  apiKey,
  fetchApi,
  model,
  prompt,
  signal,
  requestShapes = GEMINI_REQUEST_SHAPES
}) {
  let lastShapeError = null;
  const lastRequestShape = requestShapes[requestShapes.length - 1];

  for (const requestShape of requestShapes) {
    try {
      return await requestGeminiContent({
        apiKey,
        fetchApi,
        model,
        prompt,
        requestShape,
        signal
      });
    } catch (error) {
      if (error.retryWithFallbackModel) {
        throw error;
      }

      if (error.retryWithAlternateRequestShape && requestShape !== lastRequestShape) {
        lastShapeError = error;
        continue;
      }

      throw error;
    }
  }

  throw lastShapeError ?? createTextImprovementError(
    "LLM_PROVIDER_FAILED",
    "Gemini text improvement failed. The raw transcript is still available."
  );
}

async function requestGeminiContent({
  apiKey,
  fetchApi,
  model,
  prompt,
  requestShape,
  signal
}) {
  const response = await fetchApi(createGeminiGenerateContentUrl(model), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(createGeminiRequestBody(prompt, { requestShape })),
    signal
  });

  if (!response.ok) {
    const error = await createGeminiHttpError(response);
    error.providerModel = model;
    error.requestShape = requestShape;
    throw error;
  }

  return {
    model,
    requestShape,
    payload: await readJsonResponse(response)
  };
}

function createGeminiRequestBody(prompt, { requestShape }) {
  if (requestShape === "inline-instructions") {
    return {
      contents: [
        {
          parts: [
            { text: `${prompt.instructions}\n\n${prompt.userText}` }
          ]
        }
      ]
    };
  }

  const systemInstruction = {
    parts: [
      { text: prompt.instructions }
    ]
  };
  const body = {
    contents: [
      {
        parts: [
          { text: prompt.userText }
        ]
      }
    ]
  };

  if (requestShape === "snake-case-system-instruction") {
    body.system_instruction = systemInstruction;
    return body;
  }

  return {
    ...body,
    systemInstruction
  };
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

async function createGeminiHttpError(response) {
  const providerError = await readGeminiError(response);
  const [code, message] = classifyGeminiHttpError(response, providerError);

  const error = createTextImprovementError(code, message);
  error.providerStatus = response.status;
  error.providerErrorCode = providerError.code;
  error.providerErrorStatus = providerError.status;
  error.retryWithAlternateRequestShape = shouldRetryWithAlternateRequestShape(response, providerError);
  error.retryWithFallbackModel = shouldRetryWithFallbackModel(response, providerError);
  return error;
}

function createGeminiEmptyTextError(payload) {
  const blockReason = payload?.promptFeedback?.blockReason
    ?? payload?.prompt_feedback?.block_reason;
  if (blockReason) {
    return createTextImprovementError(
      "LLM_PROVIDER_REJECTED_TEXT",
      "Gemini blocked this transcript. The raw transcript is still available."
    );
  }

  const finishReason = payload?.candidates?.[0]?.finishReason
    ?? payload?.candidates?.[0]?.finish_reason;
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

async function readGeminiError(response) {
  const fallback = {
    code: "",
    message: "",
    status: ""
  };

  try {
    const text = await response.text();
    if (!text) {
      return fallback;
    }

    try {
      return normalizeGeminiErrorPayload(JSON.parse(text), text);
    } catch {
      return {
        ...fallback,
        message: text
      };
    }
  } catch {
    return fallback;
  }
}

function normalizeGeminiErrorPayload(payload, fallbackMessage = "") {
  const error = payload?.error;
  return {
    code: typeof error?.code === "number" ? String(error.code) : "",
    message: typeof error?.message === "string" ? error.message : fallbackMessage,
    status: typeof error?.status === "string" ? error.status : ""
  };
}

function createGeminiProviderMeta(payload, requestedModel) {
  return {
    provider: "gemini",
    model: payload?.modelVersion ?? requestedModel,
    responseId: payload?.responseId ?? null,
    finishReason: payload?.candidates?.[0]?.finishReason
      ?? payload?.candidates?.[0]?.finish_reason
      ?? null
  };
}

function createGeminiGenerateContentUrl(model) {
  return `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
}

function classifyGeminiHttpError(response, providerError) {
  if (isGeminiAuthFailure(response, providerError)) {
    return ["LLM_AUTH_FAILED", "Gemini rejected the API key."];
  }

  if (isGeminiRateLimit(response, providerError)) {
    return ["LLM_RATE_LIMITED", "Gemini rate limit reached. The raw transcript is still available."];
  }

  if (shouldRetryWithFallbackModel(response, providerError)) {
    return ["LLM_MODEL_UNAVAILABLE", "Gemini model is unavailable. The raw transcript is still available."];
  }

  if (response.status === 400) {
    return ["LLM_PROVIDER_REJECTED_TEXT", "Gemini could not improve this transcript."];
  }

  if (response.status >= 500) {
    return ["LLM_PROVIDER_UNAVAILABLE", "Gemini is temporarily unavailable. The raw transcript is still available."];
  }

  return ["LLM_PROVIDER_FAILED", "Gemini text improvement failed. The raw transcript is still available."];
}

function shouldRetryWithAlternateRequestShape(response, providerError) {
  return response.status === 400
    && /unknown name|unrecognized field|invalid json payload|cannot find field|system[_ ]?instruction|developer instruction/i.test(providerError.message);
}

function shouldRetryWithFallbackModel(response, providerError) {
  return response.status === 404
    || (
      response.status === 400
        && /model/i.test(providerError.message)
        && /not found|not supported|not available|unsupported/i.test(providerError.message)
    );
}

function isGeminiAuthFailure(response, providerError) {
  return response.status === 401
    || response.status === 403
    || providerError.status === "UNAUTHENTICATED"
    || /api key|authentication|permission denied/i.test(providerError.message);
}

function isGeminiRateLimit(response, providerError) {
  return response.status === 429
    || providerError.status === "RESOURCE_EXHAUSTED"
    || /rate limit|quota/i.test(providerError.message);
}

function isUsableText(text) {
  return typeof text === "string" && text.trim().length > 0;
}
