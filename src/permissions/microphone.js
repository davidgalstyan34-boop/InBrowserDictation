import { normalizeRecordingError } from "../shared/audio-recording.js";
import { MessageType, createEnvelope } from "../shared/messages.js";

const requestButton = document.querySelector("#request-microphone");
const statusElement = document.querySelector("#permission-status");
const sessionId = new URLSearchParams(location.search).get("sessionId");

requestButton.addEventListener("click", () => {
  void requestMicrophonePermission();
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

  await chrome.runtime.sendMessage(createEnvelope(
    MessageType.RUNTIME_MICROPHONE_PERMISSION_RESULT,
    payload,
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
