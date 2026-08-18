import { createCodedError } from "../shared/extension-error.js";

/**
 * Copies text from Chrome's trusted offscreen extension document.
 */
export function writeTextToClipboard(text, documentRef = globalThis.document) {
  if (typeof text !== "string" || text.length === 0) {
    throw createCodedError(
      "CLIPBOARD_TEXT_MISSING",
      "No text is available to copy to the clipboard."
    );
  }

  const textElement = documentRef?.querySelector?.("#clipboard-text");
  if (!textElement || typeof documentRef.execCommand !== "function") {
    throw createCodedError(
      "CLIPBOARD_UNAVAILABLE",
      "Clipboard access is unavailable in the offscreen extension document."
    );
  }

  try {
    // Chrome offscreen documents cannot be focused, so navigator.clipboard
    // rejects writes there. Chrome's official offscreen pattern is a selected
    // textarea plus execCommand under the extension's clipboardWrite grant.
    textElement.value = text;
    textElement.select();
    if (documentRef.execCommand("copy") !== true) {
      throw new Error("The browser rejected the copy command.");
    }
  } catch (error) {
    throw createCodedError(
      "CLIPBOARD_WRITE_FAILED",
      "Chrome did not allow the extension to write to the clipboard.",
      error
    );
  } finally {
    textElement.value = "";
  }

  return {
    strategy: "offscreen-clipboard",
    textLength: text.length
  };
}
