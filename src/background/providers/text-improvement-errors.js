import { createCodedError, isCodedError } from "../../shared/extension-error.js";

/**
 * Shared text-improvement error helpers for provider-neutral background code.
 */
export function createTextImprovementError(code, message, cause = null) {
  return createCodedError(code, message, cause);
}

/**
 * Converts arbitrary provider/network failures into user-facing LLM errors.
 */
export function normalizeTextImprovementError(error, { timedOut = false } = {}) {
  if (isCodedError(error)) {
    return error;
  }

  if (timedOut) {
    return createTextImprovementError(
      "LLM_TIMEOUT",
      "Text improvement timed out. The raw transcript is still available."
    );
  }

  if (error?.name === "AbortError") {
    return createTextImprovementError(
      "LLM_CANCELLED",
      "Text improvement was cancelled. The raw transcript is still available."
    );
  }

  return createTextImprovementError(
    "LLM_NETWORK_FAILED",
    "Text improvement request failed. The raw transcript is still available.",
    error
  );
}
