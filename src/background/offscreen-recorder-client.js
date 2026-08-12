import { MessageType, createEnvelope } from "../shared/messages.js";
import { toError } from "./errors.js";

const DEFAULT_RECORDER_PATH = "offscreen/recorder.html";

/**
 * Wraps Chrome's offscreen document API for the background controller.
 *
 * The service worker cannot record microphone audio directly, so this client
 * creates the hidden document, sends recorder lifecycle messages, and closes
 * the document when recording is finished.
 */
export function createOffscreenRecorderClient({
  chromeApi,
  clientsApi,
  recorderPath = DEFAULT_RECORDER_PATH
}) {
  let creatingDocument = null;

  return {
    start,
    stop,
    getActiveRecording,
    close
  };

  /**
   * Ensures the offscreen document exists, then asks it to start recording for
   * the supplied dictation session.
   */
  async function start(sessionId) {
    await ensureDocument();
    return await chromeApi.runtime.sendMessage(createEnvelope(
      MessageType.OFFSCREEN_START_RECORDING,
      {},
      sessionId
    ));
  }

  /**
   * Requests final audio from the active recorder.
   */
  async function stop(sessionId) {
    return await chromeApi.runtime.sendMessage(createEnvelope(
      MessageType.OFFSCREEN_STOP_RECORDING,
      {},
      sessionId
    ));
  }

  /**
   * Returns active recorder metadata when the offscreen document survived a
   * service-worker suspension.
   */
  async function getActiveRecording() {
    const documentUrl = chromeApi.runtime.getURL(recorderPath);

    if (!await hasDocument(documentUrl)) {
      return null;
    }

    try {
      const response = await chromeApi.runtime.sendMessage(createEnvelope(
        MessageType.OFFSCREEN_GET_RECORDING_STATE,
        {}
      ));

      return response?.ok ? response.recording : null;
    } catch {
      return null;
    }
  }

  /**
   * Creates the offscreen document once, coalescing concurrent callers.
   */
  async function ensureDocument() {
    if (!chromeApi.offscreen?.createDocument) {
      throw toError({
        code: "OFFSCREEN_UNAVAILABLE",
        message: "Chrome offscreen documents are unavailable in this browser."
      });
    }

    const documentUrl = chromeApi.runtime.getURL(recorderPath);
    if (await hasDocument(documentUrl)) {
      return;
    }

    if (!creatingDocument) {
      creatingDocument = chromeApi.offscreen.createDocument({
        url: recorderPath,
        reasons: ["USER_MEDIA"],
        justification: "Record microphone audio for shortcut dictation."
      }).finally(() => {
        creatingDocument = null;
      });
    }

    await creatingDocument;
  }

  /**
   * Releases the offscreen document after the recorder has stopped.
   */
  async function close() {
    if (!chromeApi.offscreen?.closeDocument) {
      return;
    }

    try {
      if (await canSkipClose()) {
        return;
      }

      await chromeApi.offscreen.closeDocument();
    } catch {
      // The offscreen document may already be gone after a permission or
      // recorder error. Media tracks are still stopped inside that document.
    }
  }

  /**
   * Uses Chrome's cheap document check when available.
   */
  async function canSkipClose() {
    return typeof chromeApi.offscreen.hasDocument === "function"
      && !await chromeApi.offscreen.hasDocument();
  }

  /**
   * Detects whether the recorder document already exists.
   */
  async function hasDocument(documentUrl) {
    // `runtime.getContexts` is preferred in modern Chrome. The clients fallback
    //keeps the code readable for older MV3 examples and tests.
    if (typeof chromeApi.runtime.getContexts === "function") {
      const contexts = await chromeApi.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [documentUrl]
      });

      return contexts.length > 0;
    }

    const matchedClients = await (clientsApi?.matchAll?.() ?? []);
    return matchedClients.some((client) => client.url === documentUrl);
  }
}
