import {
  MAX_RECORDING_MS,
  createAudioMetadata,
  createMediaRecorderOptions,
  createRecordingError,
  isUsableRecordingSize,
  normalizeRecordingError,
  selectSupportedAudioMimeType
} from "../shared/audio-recording.js";
import { MessageType, createEnvelope, parseMessageEnvelope } from "../shared/messages.js";
import { writeTextToClipboard } from "./clipboard.js";

// The offscreen document owns live microphone objects and clipboard writes
// because the MV3 service worker cannot rely on DOM/media APIs. It returns only
// serializable metadata and recording results to the background controller.
let activeRecording = null;

// Audio from a recording that ended on its own, waiting to be collected.
//
// The duration cap can fire while the service worker is suspended, so the
// finished payload is held here until the worker asks for it. Dropping it would
// throw away audio the user already spoke.
let finishedRecording = null;

const messageHandlers = Object.freeze({
  [MessageType.OFFSCREEN_GET_RECORDING_STATE]: getRecordingState,
  [MessageType.OFFSCREEN_START_RECORDING]: startRecording,
  [MessageType.OFFSCREEN_STOP_RECORDING]: stopRecording,
  [MessageType.OFFSCREEN_WRITE_CLIPBOARD]: writeClipboard
});

chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
  const message = parseMessageEnvelope(rawMessage);
  const handler = message ? messageHandlers[message.type] : null;

  if (!handler) {
    return false;
  }

  respondWithOffscreenResult(handler(message), sendResponse);
  return true;
});

/**
 * Requests microphone access and starts MediaRecorder for one session.
 *
 * The function stores the recorder and its completion promise in module state
 * because Chrome messages are stateless and start/stop arrive separately.
 */
async function startRecording(message) {
  if (activeRecording) {
    throw createRecordingError(
      "RECORDING_ALREADY_ACTIVE",
      "A recording is already active."
    );
  }

  // A new session supersedes audio nobody collected.
  finishedRecording = null;

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
      tabId: Number.isInteger(message.payload?.tabId) ? message.payload.tabId : null,
      recorder,
      startedAt,
      completion,
      durationCapId: null
    };

    recorder.start(250);
    activeRecording.durationCapId = setTimeout(
      () => void finishRecordingAtDurationCap(message.sessionId, completion),
      MAX_RECORDING_MS
    );

    return {
      recording: {
        startedAt,
        tabId: activeRecording.tabId,
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
 * Copies final fallback text from the extension origin.
 */
async function writeClipboard(message) {
  return {
    clipboard: writeTextToClipboard(message.payload?.text)
  };
}

/**
 * Stops the active recorder and waits for the final audio blob conversion.
 *
 * A recording that already ended at the duration cap is collected here too, so
 * pressing stop after the cap still returns the audio instead of reporting that
 * nothing was recording.
 */
async function stopRecording(message) {
  const recording = activeRecording;

  if (!recording) {
    return collectFinishedRecording(message.sessionId);
  }

  if (recording.sessionId !== message.sessionId) {
    throw createRecordingError(
      "RECORDING_SESSION_MISMATCH",
      "The active recording belongs to a different dictation session."
    );
  }

  clearDurationCap(recording);

  if (recording.recorder.state !== "inactive") {
    recording.recorder.stop();
  }

  return await recording.completion;
}

/**
 * Ends a recording that reached the maximum length, keeping its audio.
 *
 * The service worker is told so the transcription pipeline continues without
 * the user pressing stop. If it is suspended and never hears, the payload waits
 * here and the next command collects it.
 */
async function finishRecordingAtDurationCap(sessionId, completion) {
  const recording = activeRecording;
  if (recording?.sessionId !== sessionId) {
    return;
  }

  clearDurationCap(recording);

  if (recording.recorder.state !== "inactive") {
    recording.recorder.stop();
  }

  try {
    const result = await completion;
    finishedRecording = {
      sessionId,
      tabId: recording.tabId,
      startedAt: recording.startedAt,
      mimeType: result.audio?.mimeType ?? "",
      result
    };
  } catch (error) {
    finishedRecording = null;
    console.warn("[In-Browser Dictation] Capped recording could not be finalized.", error);
    return;
  }

  await notifyBackgroundOfDurationCap(sessionId);
}

async function notifyBackgroundOfDurationCap(sessionId) {
  try {
    await chrome.runtime.sendMessage(createEnvelope(
      MessageType.OFFSCREEN_RECORDING_DURATION_CAPPED,
      {},
      sessionId
    ));
  } catch {
    // No listener right now. The audio stays here for the next command.
  }
}

function collectFinishedRecording(sessionId) {
  if (finishedRecording?.sessionId !== sessionId) {
    throw createRecordingError(
      "RECORDING_NOT_ACTIVE",
      "No recording is active."
    );
  }

  const { result } = finishedRecording;
  finishedRecording = null;
  return result;
}

function clearDurationCap(recording) {
  if (recording.durationCapId !== null) {
    clearTimeout(recording.durationCapId);
    recording.durationCapId = null;
  }
}

/**
 * Reports lightweight recorder metadata for service-worker recovery.
 *
 * A recording that ended at the duration cap is reported the same way as a live
 * one. The worker recovers it into a stoppable session and collects the audio
 * on its next stop, which is what keeps a capped recording from being lost to a
 * suspension.
 */
async function getRecordingState() {
  if (activeRecording) {
    return {
      recording: {
        sessionId: activeRecording.sessionId,
        tabId: activeRecording.tabId,
        startedAt: activeRecording.startedAt,
        mimeType: activeRecording.recorder.mimeType || ""
      }
    };
  }

  if (finishedRecording) {
    return {
      recording: {
        sessionId: finishedRecording.sessionId,
        tabId: finishedRecording.tabId,
        startedAt: finishedRecording.startedAt,
        mimeType: finishedRecording.mimeType,
        durationCapped: true
      }
    };
  }

  return { recording: null };
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
function respondWithOffscreenResult(resultPromise, sendResponse) {
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
