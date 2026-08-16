import { normalizeRecordingError } from "../shared/audio-recording.js";
import { MessageType, createEnvelope } from "../shared/messages.js";

const requestButton = document.querySelector("#request-microphone");
const statusElement = document.querySelector("#permission-status");
const pageParameters = new URLSearchParams(location.search);
const sessionId = pageParameters.get("sessionId");
const tabId = Number.parseInt(pageParameters.get("tabId") ?? "", 10);

// The service worker parks the session in WAITING_FOR_MICROPHONE until this page
// reports back. Closing the window without choosing would otherwise leave that
// session waiting forever, and every later shortcut press would report "busy".
let reportedResult = false;

requestButton.addEventListener("click", () => {
  void requestMicrophonePermission();
});

window.addEventListener("pagehide", () => {
  if (reportedResult) {
    return;
  }

  reportedResult = true;
  void chrome.runtime.sendMessage(createEnvelope(
    MessageType.RUNTIME_MICROPHONE_PERMISSION_RESULT,
    {
      granted: false,
      tabId: Number.isInteger(tabId) ? tabId : null,
      error: {
        code: "MICROPHONE_PERMISSION_DISMISSED",
        message: "The microphone permission window was closed before choosing."
      }
    },
    sessionId
  )).catch(() => {
    // The page is unloading; a failed delivery has nowhere left to report.
  });
});

void requestMicrophonePermission();

/**
 * Requests microphone access from a visible extension page.
 *
 * This page exists because Chrome cannot show a useful first-time microphone
 * prompt from the service worker or the hidden offscreen document. Once access
 * is granted for the extension origin, the offscreen recorder can use it.
 */
async function requestMicrophonePermission() {
  requestButton.disabled = true;
  statusElement.textContent = "Chrome should show a microphone permission prompt.";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stopTracks(stream);

    await notifyBackground({
      granted: true
    });

    statusElement.textContent = "Microphone access granted. Recording will continue on the original page.";
    window.setTimeout(() => window.close(), 900);
  } catch (error) {
    const normalizedError = normalizeRecordingError(error);

    await notifyBackground({
      granted: false,
      error: normalizedError
    });

    statusElement.textContent = normalizedError.message;
    requestButton.disabled = false;
  }
}

/**
 * Sends the permission result back to the service worker session.
 */
async function notifyBackground(payload) {
  if (!sessionId) {
    throw new Error("Missing dictation session id.");
  }

  reportedResult = true;

  await chrome.runtime.sendMessage(createEnvelope(
    MessageType.RUNTIME_MICROPHONE_PERMISSION_RESULT,
    {
      ...payload,
      // Echoed so a service worker that was suspended during the prompt can
      // rebuild the session instead of discarding a permission the user granted.
      tabId: Number.isInteger(tabId) ? tabId : null
    },
    sessionId
  ));
}

/**
 * Releases the test stream immediately; real recording happens offscreen.
 */
function stopTracks(stream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}
