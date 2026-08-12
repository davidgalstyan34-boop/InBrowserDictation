import { MessageType, parseMessageEnvelope } from "../shared/messages.js";
import { renderDictationOverlay } from "./overlay.js";
import { captureActiveTarget, describeCapturedTarget, summarizeCapturedTarget } from "./target-capture.js";

let activeSession = null;

const messageHandlers = Object.freeze({
  [MessageType.CONTENT_SHOW_STATE]: renderStateMessage,
  [MessageType.CONTENT_PREPARE_DICTATION]: prepareDictation,
  [MessageType.CONTENT_CANCEL_DICTATION]: cancelDictation
});

export function handleRuntimeMessage({ rawMessage, sender, sendResponse }) {
  const message = parseMessageEnvelope(rawMessage);
  const handler = message ? messageHandlers[message.type] : null;

  if (!handler) {
    sendResponse({ ok: false, ignored: true });
    return;
  }

  handler({ message, sender, sendResponse });
}

function renderStateMessage({ message, sendResponse }) {
  renderDictationOverlay(message.payload);
  sendResponse({ ok: true });
}

function prepareDictation({ message, sendResponse }) {
  const target = captureActiveTarget();
  activeSession = {
    id: message.sessionId,
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

function cancelDictation({ message, sendResponse }) {
  runWithCurrentSession(message.sessionId, () => {
    activeSession = null;
    renderDictationOverlay({
      title: message.payload.title || "Cancelled",
      detail: message.payload.detail || "Dictation stopped",
      tone: "muted"
    });
  });

  sendResponse({ ok: true });
}

function runWithCurrentSession(sessionId, action) {
  // Late messages can arrive after the user has started a new session. The
  // session check prevents an old command from clearing newer page state.
  if (!sessionId || activeSession?.id === sessionId) {
    action();
  }
}
