/**
 * Shared message protocol for communication between extension contexts.
 *
 * Every message crosses a Chrome runtime boundary, so callers use a consistent
 * envelope instead of sending ad hoc objects between the service worker,
 * content script, and offscreen recorder.
 */
export const PROTOCOL_VERSION = 1;

export const MessageType = Object.freeze({
  CONTENT_PREPARE_DICTATION: "content.prepareDictation",
  CONTENT_CANCEL_DICTATION: "content.cancelDictation",
  CONTENT_DISMISS_OVERLAY: "content.dismissOverlay",
  CONTENT_INSERT_TEXT: "content.insertText",
  CONTENT_SHOW_STATE: "content.showState",
  RUNTIME_GET_STATE: "runtime.getState",
  RUNTIME_MICROPHONE_PERMISSION_RESULT: "runtime.microphonePermissionResult",
  OFFSCREEN_GET_RECORDING_STATE: "offscreen.getRecordingState",
  OFFSCREEN_START_RECORDING: "offscreen.startRecording",
  OFFSCREEN_STOP_RECORDING: "offscreen.stopRecording"
});

const MESSAGE_TYPES = new Set(Object.values(MessageType));

/**
 * Wraps a typed payload in the extension protocol envelope.
 *
 * `sessionId` is nullable because some runtime requests, such as "get current
 * state", are not tied to a single dictation session.
 */
export function createEnvelope(type, payload = {}, sessionId = null) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type,
    sessionId,
    payload,
    sentAt: Date.now()
  };
}

/**
 * Validates and normalizes a message received from another extension context.
 *
 * Invalid, unknown, or version-mismatched messages return null so receivers can
 * ignore them without throwing in Chrome's event dispatch path.
 */
export function parseMessageEnvelope(value) {
  if (!value || value.protocolVersion !== PROTOCOL_VERSION) {
    return null;
  }

  if (typeof value.type !== "string" || !MESSAGE_TYPES.has(value.type)) {
    return null;
  }

  return {
    ...value,
    payload: value.payload ?? {}
  };
}
