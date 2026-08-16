import { createCodedError, isCodedError } from "../../shared/extension-error.js";

/**
 * Shared speech-to-text error helpers for provider-neutral background modules.
 */
export function createSpeechToTextError(code, message, cause = null) {
  return createCodedError(code, message, cause);
}

/**
 * Converts arbitrary provider/network failures into user-facing STT errors.
 */
export function normalizeSpeechToTextError(error, { timedOut = false } = {}) {
  if (isCodedError(error)) {
    return error;
  }

  if (timedOut) {
    return createSpeechToTextError(
      "STT_TIMEOUT",
      "Speech-to-text timed out. Try a shorter recording or retry."
    );
  }

  if (error?.name === "AbortError") {
    return createSpeechToTextError(
      "STT_CANCELLED",
      "Speech-to-text was cancelled."
    );
  }

  return createSpeechToTextError(
    "STT_NETWORK_FAILED",
    "Speech-to-text request failed. Check your connection and try again.",
    error
  );
}
