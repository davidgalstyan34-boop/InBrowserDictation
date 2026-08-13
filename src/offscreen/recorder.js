import {
  createAudioMetadata,
  createMediaRecorderOptions,
  createRecordingError,
  isUsableRecordingSize,
  normalizeRecordingError,
  selectSupportedAudioMimeType
} from "../shared/audio-recording.js";
import { MessageType, parseMessageEnvelope } from "../shared/messages.js";

// The offscreen document owns live microphone objects because the MV3 service
// worker cannot rely on DOM/media APIs. It returns only serializable recording
// results to the background controller.
let activeRecording = null;

const messageHandlers = Object.freeze({
  [MessageType.OFFSCREEN_GET_RECORDING_STATE]: getRecordingState,
  [MessageType.OFFSCREEN_START_RECORDING]: startRecording,
  [MessageType.OFFSCREEN_STOP_RECORDING]: stopRecording
});

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  const message = parseMessageEnvelope(rawMessage);
  const handler = message ? messageHandlers[message.type] : null;

  if (!handler) {
    return false;
  }

  respondWithRecordingResult(handler(message), sendResponse);
  return true;
});

/**
 * Requests microphone access and starts MediaRecorder for one session.
 *
 * The function stores the recorder, stream, and collected chunks in module
 * state because Chrome messages are stateless and start/stop arrive as
 * separate events.
 */
async function startRecording(message) {
  if (activeRecording) {
    throw createRecordingError(
      "RECORDING_ALREADY_ACTIVE",
      "A recording is already active."
    );
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw createRecordingError(
      "MICROPHONE_UNAVAILABLE",
      "This browser context cannot request microphone access."
    );
  }

  if (typeof MediaRecorder !== "function") {
    throw createRecordingError(
      "MEDIA_RECORDER_UNSUPPORTED",
      "This browser does not support MediaRecorder."
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  try {
    const requestedMimeType = selectSupportedAudioMimeType();
    const recorder = new MediaRecorder(stream, createMediaRecorderOptions(requestedMimeType));
    const chunks = [];
    const startedAt = Date.now();
    const completion = attachRecorderLifecycleHandlers({ recorder, stream, chunks, startedAt });

    activeRecording = {
      sessionId: message.sessionId,
      recorder,
      stream,
      chunks,
      startedAt,
      completion
    };

    recorder.start(250);

    return {
      recording: {
        startedAt,
        mimeType: recorder.mimeType || requestedMimeType || ""
      }
    };
  } catch (error) {
    stopMediaTracks(stream);
    activeRecording = null;
    throw normalizeRecordingError(error);
  }
}

/**
 * Stops the active recorder and waits for the final audio blob conversion.
 */
async function stopRecording(message) {
  const recording = activeRecording;

  if (!recording) {
    throw createRecordingError(
      "RECORDING_NOT_ACTIVE",
      "No recording is active."
    );
  }

  if (recording.sessionId !== message.sessionId) {
    throw createRecordingError(
      "RECORDING_SESSION_MISMATCH",
      "The active recording belongs to a different dictation session."
    );
  }

  if (recording.recorder.state !== "inactive") {
    recording.recorder.stop();
  }

  return await recording.completion;
}

/**
 * Reports lightweight active-recorder metadata for service-worker recovery.
 */
async function getRecordingState() {
  return {
    recording: activeRecording
      ? {
          sessionId: activeRecording.sessionId,
          startedAt: activeRecording.startedAt,
          mimeType: activeRecording.recorder.mimeType || ""
        }
      : null
  };
}

/**
 * Attaches MediaRecorder event handlers before recording starts and returns
 * the promise resolved by the later stop event.
 */
function attachRecorderLifecycleHandlers({ recorder, stream, chunks, startedAt }) {
  return new Promise((resolve, reject) => {
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size > 0) {
        chunks.push(event.data);
      }
    });

    recorder.addEventListener("error", (event) => {
      stopMediaTracks(stream);
      activeRecording = null;
      reject(normalizeRecordingError(event.error));
    }, { once: true });

    recorder.addEventListener("stop", async () => {
      try {
        const durationMs = Date.now() - startedAt;
        const blob = new Blob(chunks, {
          type: recorder.mimeType || chunks[0]?.type || "audio/webm"
        });

        stopMediaTracks(stream);
        activeRecording = null;

        if (!isUsableRecordingSize(blob.size)) {
          throw createRecordingError(
            "RECORDING_EMPTY",
            "Recording was too short or contained no usable audio."
          );
        }

        resolve({
          audio: {
            ...createAudioMetadata({
              mimeType: blob.type,
              sizeBytes: blob.size,
              durationMs
            }),
            dataUrl: await blobToDataUrl(blob)
          }
        });
      } catch (error) {
        reject(normalizeRecordingError(error));
      }
    }, { once: true });
  });
}

/**
 * Releases all microphone tracks so Chrome does not keep the mic active while
 * the extension is idle.
 */
function stopMediaTracks(stream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/**
 * Encodes the blob as a data URL because extension messaging should not depend
 * on structured-cloning Blob objects across every Chrome context.
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

/**
 * Normalizes async handler success/failure into the extension message shape.
 */
function respondWithRecordingResult(resultPromise, sendResponse) {
  resultPromise
    .then((result) => {
      sendResponse({
        ok: true,
        ...result
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: normalizeRecordingError(error)
      });
    });
}
