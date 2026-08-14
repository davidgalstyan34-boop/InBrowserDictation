/**
 * Shared text-improvement error helpers for provider-neutral background code.
 */
export function createTextImprovementError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

/**
 * Converts arbitrary provider/network failures into user-facing LLM errors.
 */
export function normalizeTextImprovementError(error, { timedOut = false } = {}) {
  if (error?.code && error?.message) {
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
