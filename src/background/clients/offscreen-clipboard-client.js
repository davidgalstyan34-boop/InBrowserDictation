import { MessageType, createEnvelope } from "../../shared/messages.js";
import { toError } from "../utils/errors.js";

/**
 * Writes fallback text from the trusted offscreen extension document.
 *
 * The recorder document remains open until processing finishes, so clipboard
 * writes can use the extension origin instead of inheriting page restrictions
 * from the content script.
 */
export function createOffscreenClipboardClient({ chromeApi }) {
  return {
    writeText
  };

  async function writeText(sessionId, text) {
    const response = await chromeApi.runtime.sendMessage(createEnvelope(
      MessageType.OFFSCREEN_WRITE_CLIPBOARD,
      { text },
      sessionId
    ));

    if (!response?.ok) {
      throw toError(response?.error, "Text could not be copied to the clipboard.");
    }

    return response.clipboard;
  }
}
