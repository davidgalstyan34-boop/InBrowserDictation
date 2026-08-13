import { MessageType, parseMessageEnvelope } from "../shared/messages.js";
import { dismissDictationOverlay, renderDictationOverlay } from "./overlay.js";
import { captureActiveTarget, describeCapturedTarget, summarizeCapturedTarget } from "./target-capture.js";
import { insertTextIntoCapturedTarget } from "./text-insertion.js";

// Content-side target state keeps live DOM references out of the service
// worker. It is keyed by the background session id, but it is not an
// authoritative session; insertion only needs the originally captured target.
let capturedTargetState = null;

const messageHandlers = Object.freeze({
  [MessageType.CONTENT_SHOW_STATE]: renderStateMessage,
  [MessageType.CONTENT_PREPARE_DICTATION]: prepareDictation,
  [MessageType.CONTENT_CANCEL_DICTATION]: cancelDictation,
  [MessageType.CONTENT_DISMISS_OVERLAY]: dismissOverlay,
  [MessageType.CONTENT_INSERT_TEXT]: insertText
});

/**
 * Routes messages sent from the service worker into content-script behavior.
 *
 * The service worker receives only serializable target summaries. Live element
 * and Range references remain in this module for later insertion.
 */
export function handleRuntimeMessage({ rawMessage, sender, sendResponse }) {
  const message = parseMessageEnvelope(rawMessage);
  const handler = message ? messageHandlers[message.type] : null;

  if (!handler) {
    sendResponse({ ok: false, ignored: true });
    return;
  }

  handler({ message, sender, sendResponse });
}

/**
 * Shows status-only overlay updates sent by the background controller.
 */
function renderStateMessage({ message, sendResponse }) {
  renderDictationOverlay(message.payload);
  sendResponse({ ok: true });
}

/**
 * Captures the page target at dictation start and reports a safe summary.
 */
function prepareDictation({ message, sendResponse }) {
  const target = captureActiveTarget();
  capturedTargetState = {
    sessionId: message.sessionId,
    target,
    capturedAt: Date.now()
  };

  renderDictationOverlay({
    title: "Ready",
    detail: describeCapturedTarget(target)
  });

  sendResponse({
    ok: true,
    target: summarizeCapturedTarget(target)
  });
}

/**
 * Clears content-side session state when the background cancels a session.
 */
function cancelDictation({ message, sendResponse }) {
  runWithCurrentCapturedTarget(message.sessionId, () => {
    capturedTargetState = null;
    renderDictationOverlay({
      title: message.payload.title || "Cancelled",
      detail: message.payload.detail || "Dictation stopped",
      tone: "muted"
    });
  });

  sendResponse({ ok: true });
}

/**
 * Inserts the final private output text into the captured target.
 *
 * The service worker sends text only at the insertion boundary. The response
 * carries metadata only so background state and overlays never echo the text.
 */
function insertText({ message, sendResponse }) {
  const targetState = capturedTargetState;
  if (targetState?.sessionId && targetState.sessionId !== message.sessionId) {
    sendResponse({
      ok: false,
      error: {
        code: "INSERTION_TARGET_STALE",
        message: "A newer dictation target is active on this page."
      }
    });
    return;
  }

  insertTextIntoCapturedTarget(targetState?.target ?? { kind: "none" }, message.payload.text)
    .then((insertion) => {
      capturedTargetState = null;

      sendResponse({
        ok: true,
        insertion
      });
    })
    .catch((error) => {
      capturedTargetState = null;

      sendResponse({
        ok: false,
        error: toMessageError(error, "Text could not be inserted.")
      });
    });
}

/**
 * Removes page feedback for a completed or failed session.
 */
function dismissOverlay({ message, sendResponse }) {
  runWithCurrentCapturedTarget(message.sessionId, () => {
    capturedTargetState = null;
    dismissDictationOverlay();
  });

  sendResponse({ ok: true });
}

/**
 * Guards session-bound mutations against stale messages.
 */
function runWithCurrentCapturedTarget(sessionId, action) {
  // Late messages can arrive after the user has started a new session. The
  // id check prevents an old command from clearing newer page target state.
  if (!sessionId || capturedTargetState?.sessionId === sessionId) {
    action();
  }
}

function toMessageError(error, fallbackMessage) {
  return {
    code: error?.code || "CONTENT_INSERTION_FAILED",
    message: error?.message || fallbackMessage
  };
}
