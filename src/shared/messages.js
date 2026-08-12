export const PROTOCOL_VERSION = 1;

export const MessageType = Object.freeze({
  CONTENT_PREPARE_DICTATION: "content.prepareDictation",
  CONTENT_CANCEL_DICTATION: "content.cancelDictation",
  CONTENT_SHOW_STATE: "content.showState",
  RUNTIME_GET_STATE: "runtime.getState"
});

export function createEnvelope(type, payload = {}, sessionId = null) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type,
    sessionId,
    payload,
    sentAt: Date.now()
  };
}

export function isMessage(value) {
  return Boolean(
    value &&
      value.protocolVersion === PROTOCOL_VERSION &&
      typeof value.type === "string" &&
      Object.values(MessageType).includes(value.type)
  );
}
