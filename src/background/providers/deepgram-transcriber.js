import {
  createSpeechToTextError,
  normalizeSpeechToTextError
} from "./speech-to-text-errors.js";
import { createRequestSignal } from "./request-signal.js";

const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";
const DEFAULT_DEEPGRAM_MODEL = "nova-3";
export const DEFAULT_STT_TIMEOUT_MS = 20_000;

/**
 * Deepgram-backed implementation of the speech-to-text provider.
 *
 * This module owns Deepgram request details, response parsing, and provider
 * error normalization so the dictation controller only sees a stable
 * `{ transcript, providerMeta }` result.
 */
export async function transcribeWithDeepgram({
  audioBlob,
  mimeType,
  settings,
  fetchApi = globalThis.fetch,
  signal = null,
  timeoutMs = DEFAULT_STT_TIMEOUT_MS
}) {
  const apiKey = settings?.sttApiKey?.trim();
  if (!apiKey) {
    throw createSpeechToTextError(
      "STT_API_KEY_MISSING",
      "Add a Deepgram API key in extension options before transcribing."
    );
  }

  if (typeof fetchApi !== "function") {
    throw createSpeechToTextError(
      "STT_FETCH_UNAVAILABLE",
      "Speech-to-text network requests are unavailable in this browser."
    );
  }

  if (!audioBlob) {
    throw createSpeechToTextError(
      "STT_AUDIO_MISSING",
      "No recorded audio is available for transcription."
    );
  }

  const requestSignal = createRequestSignal({ parentSignal: signal, timeoutMs });

  try {
    const response = await fetchApi(buildDeepgramListenUrl(), {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": mimeType || audioBlob.type || "application/octet-stream"
      },
      body: audioBlob,
      signal: requestSignal.signal
    });

    if (!response.ok) {
      throw createDeepgramHttpError(response);
    }

    const payload = await readJsonResponse(response);
    const transcript = extractDeepgramTranscript(payload);
    if (!transcript) {
      throw createSpeechToTextError(
        "STT_EMPTY_TRANSCRIPT",
        "Deepgram returned an empty transcript."
      );
    }

    return {
      transcript,
      providerMeta: createDeepgramProviderMeta(payload)
    };
  } catch (error) {
    throw normalizeSpeechToTextError(error, {
      timedOut: requestSignal.timedOut()
    });
  } finally {
    requestSignal.cleanup();
  }
}

/**
 * Extracts the transcript text from Deepgram's channel/alternative response.
 */
export function extractDeepgramTranscript(payload) {
  const channels = payload?.results?.channels;
  if (!Array.isArray(channels)) {
    return "";
  }

  return channels
    .flatMap((channel) => Array.isArray(channel?.alternatives) ? channel.alternatives : [])
    .map((alternative) => typeof alternative?.transcript === "string"
      ? alternative.transcript.trim()
      : "")
    .filter(Boolean)
    .join("\n");
}

function buildDeepgramListenUrl() {
  const url = new URL(DEEPGRAM_LISTEN_URL);
  url.searchParams.set("model", DEFAULT_DEEPGRAM_MODEL);
  url.searchParams.set("smart_format", "true");
  return url.href;
}

function createDeepgramHttpError(response) {
  const statusMessages = {
    400: ["STT_PROVIDER_REJECTED_AUDIO", "Deepgram could not transcribe this audio."],
    401: ["STT_AUTH_FAILED", "Deepgram rejected the API key."],
    403: ["STT_AUTH_FAILED", "Deepgram rejected the API key."],
    415: ["STT_PROVIDER_REJECTED_AUDIO", "Deepgram does not support this recording format."],
    429: ["STT_RATE_LIMITED", "Deepgram rate limit reached. Try again later."]
  };

  const [code, message] = statusMessages[response.status] ?? (
    response.status >= 500
      ? ["STT_PROVIDER_UNAVAILABLE", "Deepgram is temporarily unavailable. Try again later."]
      : ["STT_PROVIDER_FAILED", "Deepgram transcription failed."]
  );

  return createSpeechToTextError(code, message);
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    throw createSpeechToTextError(
      "STT_INVALID_RESPONSE",
      "Deepgram returned invalid JSON.",
      error
    );
  }
}

function createDeepgramProviderMeta(payload) {
  const firstAlternative = getFirstAlternative(payload);

  return {
    provider: "deepgram",
    model: DEFAULT_DEEPGRAM_MODEL,
    requestId: payload?.metadata?.request_id ?? null,
    durationSec: Number.isFinite(payload?.metadata?.duration) ? payload.metadata.duration : null,
    confidence: Number.isFinite(firstAlternative?.confidence) ? firstAlternative.confidence : null
  };
}

function getFirstAlternative(payload) {
  return payload?.results?.channels
    ?.flatMap((channel) => Array.isArray(channel?.alternatives) ? channel.alternatives : [])
    ?.[0] ?? null;
}

