/**
 * Shared factory and identity test for extension-owned coded errors.
 *
 * Every domain (recording, STT, LLM, insertion) normalizes arbitrary browser
 * failures into an Error carrying a stable string `code`. Those normalizers all
 * need to answer one question first: "have I already normalized this?"
 */

/**
 * Creates an Error with a stable extension-specific string code.
 */
export function createCodedError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

/**
 * Reports whether a value is already an extension-owned coded error.
 *
 * The string check is load-bearing. `DOMException` carries a legacy *numeric*
 * `code` (`AbortError` is 20, `SecurityError` 18, `NotFoundError` 8), so a bare
 * truthiness test would treat browser failures as already normalized and skip
 * the `error.name` mapping that turns them into readable user-facing messages.
 */
export function isCodedError(error) {
  return typeof error?.code === "string"
    && error.code.length > 0
    && typeof error?.message === "string"
    && error.message.length > 0;
}
