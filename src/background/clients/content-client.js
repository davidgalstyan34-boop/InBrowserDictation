import { MessageType, createEnvelope } from "../../shared/messages.js";

const CONTENT_SCRIPT_FILE = "content/content-script.js";

/**
 * Small adapter around tab/content-script messaging.
 *
 * Keeping these calls behind a client gives the controller readable verbs and
 * keeps Chrome's message-envelope ceremony in one place. It also owns the
 * "receiving end does not exist" recovery path by injecting the content script
 * on demand and retrying the message once.
 */
export function createContentClient({ chromeApi }) {
  return {
    getActiveTab,
    prepareDictation,
    dismissOverlay,
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
   * Asks the content script to capture the editable target for this session.
   */
  async function prepareDictation(tabId, sessionId) {
    return await sendTabMessageWithContentScript(tabId, createEnvelope(
      MessageType.CONTENT_PREPARE_DICTATION,
      { source: "keyboard-command" },
      sessionId
    ));
  }

  /**
   * Sends overlay state to the content script and lets failures bubble up.
   */
  async function showState(tabId, sessionId, state) {
    return await sendTabMessageWithContentScript(tabId, createEnvelope(
      MessageType.CONTENT_SHOW_STATE,
      state,
      sessionId
    ));
  }

  /**
   * Asks the content script to remove any visible overlay for this session.
   */
  async function dismissOverlay(tabId, sessionId) {
    return await sendTabMessageWithContentScript(tabId, createEnvelope(
      MessageType.CONTENT_DISMISS_OVERLAY,
      {},
      sessionId
    ));
  }

  /**
   * Sends private output text to the content script for target insertion.
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

  async function sendTabMessage(tabId, message) {
    return await chromeApi.tabs.sendMessage(tabId, message);
  }

  /**
   * Sends a message, injecting the content script first when the tab has no
   * listener yet.
   *
   * Static content scripts are injected only as pages load. During unpacked
   * extension development, already-open tabs often predate the latest reload,
   * so a valid normal webpage can still have no receiving end.
   */
  async function sendTabMessageWithContentScript(tabId, message) {
    try {
      return await sendTabMessage(tabId, message);
    } catch (error) {
      if (!isMissingMessageReceiver(error)) {
        throw error;
      }

      await injectContentScript(tabId);
      return await sendTabMessage(tabId, message);
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
}
