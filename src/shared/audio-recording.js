export const AUDIO_MIME_TYPE_CANDIDATES = Object.freeze([
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4"
]);

export const MIN_RECORDING_BYTES = 512;

/**
 * Chooses the first MIME type that the current browser says MediaRecorder can
 * emit. Returning an empty string lets MediaRecorder pick its default format.
 */
export function selectSupportedAudioMimeType(mediaRecorder = globalThis.MediaRecorder) {
  if (typeof mediaRecorder?.isTypeSupported !== "function") {
    return "";
  }

  return AUDIO_MIME_TYPE_CANDIDATES.find((mimeType) => mediaRecorder.isTypeSupported(mimeType)) ?? "";
}

/**
 * Builds the constructor options object without passing an empty MIME type.
 */
export function createMediaRecorderOptions(mimeType) {
  return mimeType ? { mimeType } : {};
}

/**
 * Rejects recordings that are almost certainly empty before provider work.
 */
export function isUsableRecordingSize(sizeBytes, minimumBytes = MIN_RECORDING_BYTES) {
  return Number.isFinite(sizeBytes) && sizeBytes >= minimumBytes;
}

/**
 * Creates the stable audio metadata shape shared between recorder, session
 * state, overlays, and later STT provider code.
 */
export function createAudioMetadata({ mimeType, sizeBytes, durationMs, capturedAt = Date.now() }) {
  return {
    mimeType: mimeType || "",
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
    durationMs: Number.isFinite(durationMs) ? durationMs : 0,
    capturedAt
  };
}

/**
 * Formats captured audio metadata for compact overlay feedback.
 */
export function describeAudioMetadata(audio) {
  if (!audio) {
    return "No audio captured";
  }

  return `${formatDuration(audio.durationMs)} captured (${formatBytes(audio.sizeBytes)})`;
}

/**
 * Creates an Error with a stable extension-specific code.
 */
export function createRecordingError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

/**
 * Maps browser/recorder failures to user-facing error codes and messages.
 */
export function normalizeRecordingError(error) {
  if (error?.code && error?.message) {
    return {
      code: error.code,
      message: error.message
    };
  }

  const domExceptionMessages = {
    NotAllowedError: ["MICROPHONE_PERMISSION_DENIED", "Microphone permission was denied."],
    SecurityError: ["MICROPHONE_PERMISSION_DENIED", "Microphone permission was denied."],
    NotFoundError: ["MICROPHONE_UNAVAILABLE", "No microphone was found."],
    DevicesNotFoundError: ["MICROPHONE_UNAVAILABLE", "No microphone was found."],
    NotReadableError: ["MICROPHONE_UNAVAILABLE", "The microphone is already in use or unavailable."],
    AbortError: ["MICROPHONE_UNAVAILABLE", "The microphone could not be started."]
  };

  const [code, message] = domExceptionMessages[error?.name] ?? [
    "RECORDING_FAILED",
    error?.message || "Audio recording failed."
  ];

  return { code, message };
}

/**
 * Identifies failures that should be recovered by opening the visible
 * microphone permission page.
 */
export function isMicrophonePermissionError(error) {
  return error?.code === "MICROPHONE_PERMISSION_DENIED"
    || error?.name === "NotAllowedError"
    || error?.name === "SecurityError";
}

function formatDuration(durationMs) {
  const seconds = Math.max(0, Math.round((durationMs || 0) / 1000));
  return `${seconds}s`;
}

function formatBytes(sizeBytes) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 bytes";
  }

  if (sizeBytes < 1024) {
    return `${Math.round(sizeBytes)} bytes`;
  }

  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}
