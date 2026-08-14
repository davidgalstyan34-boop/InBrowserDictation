/**
 * Converts structured extension error payloads into Error instances.
 *
 * Chrome messages pass plain objects, while controller code is easier to read
 * when it can throw/catch real Error values with a stable `code` field.
 */
export function toError(error, fallbackMessage = "Dictation failed.") {
  if (error instanceof Error) {
    return error;
  }

  const nextError = new Error(error?.message || fallbackMessage);
  nextError.code = error?.code || "DICTATION_ERROR";
  return nextError;
}
