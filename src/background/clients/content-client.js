import { MessageType, createEnvelope } from "../../shared/messages.js";

const CONTENT_SCRIPT_FILE = "content/content-script.js";
const TOP_FRAME_ID = 0;

/**
 * Small adapter around tab/content-script messaging.
 *
 * Keeping these calls behind a client gives the controller readable verbs and
 * keeps Chrome's message-envelope ceremony in one place. It also owns the
 * "receiving end does not exist" recovery path by injecting the content script
 * on demand and retrying the message once.
 *
 * The content script runs in every frame, so each message family states where
 * it belongs. Overlay updates go to the top frame, because an overlay drawn
 * inside a small or hidden iframe would be unreachable. Dismissals broadcast,
 * because every frame may be holding captured state to release. Messages whose
 * response the service worker needs are answered by the single frame that
 * claimed the session; see the frame-claim protocol in `content-script.js`.
 */
export function createContentClient({ chromeApi }) {
  return {
    getActiveTab,
    prepareDictation,
    insertText,
    safeDismissOverlay,
    showState,
    safeShowState
  };

  /**
   * Returns the currently active tab in the focused Chrome window.
   */
  async function getActiveTab() {
    const tabs = await chromeApi.tabs.query({ active: true, currentWindow: true });
    return tabs[0] ?? null;
  }

  /**
   * Asks the frame holding the editable target to capture it for this session.
   *
   * The first pass is a broadcast that only the focused frame answers. When no
   * frame volunteers, the top frame is asked to claim the session anyway, so
   * that a page with nothing editable focused still gets an owner for the
   * later insertion and clipboard fallback.
   */
  async function prepareDictation(tabId, sessionId) {
    const broadcast = createEnvelope(
      MessageType.CONTENT_PREPARE_DICTATION,
      { source: "keyboard-command" },
      sessionId
    );

    try {
      return await sendTabMessageWithContentScript(tabId, broadcast);
    } catch (error) {
      if (!isUnclaimedMessage(error)) {
        throw error;
      }
    }

    return await sendTabMessageWithContentScript(tabId, createEnvelope(
      MessageType.CONTENT_PREPARE_DICTATION,
      { source: "keyboard-command", requireClaim: true },
      sessionId
    ), { frameId: TOP_FRAME_ID });
  }

  /**
   * Sends overlay state to the top frame and lets failures bubble up.
   */
  async function showState(tabId, sessionId, state) {
    return await sendTabMessageWithContentScript(tabId, createEnvelope(
      MessageType.CONTENT_SHOW_STATE,
      state,
      sessionId
    ), { frameId: TOP_FRAME_ID });
  }

  /**
   * Asks every frame to drop overlay and captured state for this session.
   */
  async function dismissOverlay(tabId, sessionId) {
    return await sendTabMessageWithContentScript(tabId, createEnvelope(
      MessageType.CONTENT_DISMISS_OVERLAY,
      {},
      sessionId
    ));
  }

  /**
   * Sends private output text to the frame that captured this session's target.
   */
  async function insertText(tabId, sessionId, text) {
    return await sendTabMessageWithContentScript(tabId, createEnvelope(
      MessageType.CONTENT_INSERT_TEXT,
      { text },
      sessionId
    ));
  }

  /**
   * Removes overlay feedback when possible, swallowing stale-tab errors.
   */
  async function safeDismissOverlay(tabId, sessionId) {
    if (!tabId) {
      return null;
    }

    try {
      return await dismissOverlay(tabId, sessionId);
    } catch {
      return null;
    }
  }

  /**
   * Sends overlay state when possible, swallowing navigation/closed-tab errors.
   */
  async function safeShowState(tabId, sessionId, state) {
    if (!tabId) {
      console.warn("[In-Browser Dictation] Cannot show overlay without a tab id.", {
        sessionId,
        status: state?.status ?? null,
        tone: state?.tone ?? null
      });
      return null;
    }

    try {
      return await showState(tabId, sessionId, state);
    } catch (error) {
      console.warn("[In-Browser Dictation] Could not send overlay state to the tab.", {
        tabId,
        sessionId,
        message: error.message,
        hint: "Refresh the target webpage after reloading the unpacked extension, and avoid chrome:// pages."
      });
      return null;
    }
  }

  async function sendTabMessage(tabId, message, options) {
    return options
      ? await chromeApi.tabs.sendMessage(tabId, message, options)
      : await chromeApi.tabs.sendMessage(tabId, message);
  }

  /**
   * Sends a message, injecting the content script first when the tab has no
   * listener yet.
   *
   * Static content scripts are injected only as pages load. During unpacked
   * extension development, already-open tabs often predate the latest reload,
   * so a valid normal webpage can still have no receiving end.
   */
  async function sendTabMessageWithContentScript(tabId, message, options) {
    try {
      return await sendTabMessage(tabId, message, options);
    } catch (error) {
      if (!isMissingMessageReceiver(error)) {
        throw error;
      }

      await injectContentScript(tabId);
      return await sendTabMessage(tabId, message, options);
    }
  }

  /**
   * Programmatically injects the manifest content-script entrypoint.
   *
   * This requires the `scripting` permission plus `activeTab`, which Chrome
   * grants for the active page when the user invokes an extension command.
   */
  async function injectContentScript(tabId) {
    if (!chromeApi.scripting?.executeScript) {
      throw new Error("chrome.scripting.executeScript is unavailable.");
    }

    console.info("[In-Browser Dictation] Injecting content script into tab.", {
      tabId,
      file: CONTENT_SCRIPT_FILE
    });

    await chromeApi.scripting.executeScript({
      target: { tabId },
      files: [CONTENT_SCRIPT_FILE]
    });
  }

  /**
   * Detects Chrome's missing content-script listener error.
   */
  function isMissingMessageReceiver(error) {
    return error?.message?.includes("Receiving end does not exist");
  }

  /**
   * Detects a broadcast that every frame declined to answer.
   *
   * Chrome reports this as a closed port, which is distinct from having no
   * receiver at all: content scripts are present, they just did not claim the
   * session.
   */
  function isUnclaimedMessage(error) {
    return error?.message?.includes("message port closed");
  }
}
