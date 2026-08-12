export const PROTOCOL_VERSION = 1;

export const MessageType = Object.freeze({
  CONTENT_PREPARE_DICTATION: "content.prepareDictation",
  CONTENT_CANCEL_DICTATION: "content.cancelDictation",
  CONTENT_SHOW_STATE: "content.showState",
  RUNTIME_GET_STATE: "runtime.getState"
});

const MESSAGE_TYPES = new Set(Object.values(MessageType));

export function createEnvelope(type, payload = {}, sessionId = null) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type,
    sessionId,
    payload,
    sentAt: Date.now()
  };
}

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
