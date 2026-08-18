import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageType, PROTOCOL_VERSION, createEnvelope, parseMessageEnvelope } from "../src/shared/messages.js";

describe("message contracts", () => {
  it("creates valid protocol envelopes", () => {
    const message = createEnvelope(MessageType.CONTENT_PREPARE_DICTATION, { source: "test" }, "session-1");

    assert.equal(message.protocolVersion, PROTOCOL_VERSION);
    assert.equal(message.type, MessageType.CONTENT_PREPARE_DICTATION);
    assert.equal(message.sessionId, "session-1");
    assert.equal(message.payload.source, "test");
    assert.deepEqual(parseMessageEnvelope(message), message);
  });

  it("rejects unknown message types", () => {
    assert.equal(parseMessageEnvelope({
      protocolVersion: PROTOCOL_VERSION,
      type: "unknown",
      payload: {}
    }), null);
  });

  it("accepts recorder lifecycle messages", () => {
    const permission = createEnvelope(
      MessageType.RUNTIME_MICROPHONE_PERMISSION_RESULT,
      { granted: true },
      "session-2"
    );
    const state = createEnvelope(MessageType.OFFSCREEN_GET_RECORDING_STATE, {}, "session-2");
    const start = createEnvelope(MessageType.OFFSCREEN_START_RECORDING, {}, "session-2");
    const stop = createEnvelope(MessageType.OFFSCREEN_STOP_RECORDING, {}, "session-2");
    const clipboard = createEnvelope(
      MessageType.OFFSCREEN_WRITE_CLIPBOARD,
      { text: "private" },
      "session-2"
    );
    const dismiss = createEnvelope(MessageType.CONTENT_DISMISS_OVERLAY, {}, "session-2");
    const insert = createEnvelope(MessageType.CONTENT_INSERT_TEXT, { text: "private" }, "session-2");
    const popup = createEnvelope(MessageType.RUNTIME_GET_POPUP_STATE, {}, null);
    const retry = createEnvelope(MessageType.RUNTIME_RETRY_RECENT_IMPROVEMENT, {}, null);
    const toggle = createEnvelope(MessageType.RUNTIME_TOGGLE_DICTATION, {}, null);

    assert.equal(parseMessageEnvelope(permission).type, MessageType.RUNTIME_MICROPHONE_PERMISSION_RESULT);
    assert.equal(parseMessageEnvelope(state).type, MessageType.OFFSCREEN_GET_RECORDING_STATE);
    assert.equal(parseMessageEnvelope(start).type, MessageType.OFFSCREEN_START_RECORDING);
    assert.equal(parseMessageEnvelope(stop).type, MessageType.OFFSCREEN_STOP_RECORDING);
    assert.equal(parseMessageEnvelope(clipboard).type, MessageType.OFFSCREEN_WRITE_CLIPBOARD);
    assert.equal(parseMessageEnvelope(dismiss).type, MessageType.CONTENT_DISMISS_OVERLAY);
    assert.equal(parseMessageEnvelope(insert).type, MessageType.CONTENT_INSERT_TEXT);
    assert.equal(parseMessageEnvelope(popup).type, MessageType.RUNTIME_GET_POPUP_STATE);
    assert.equal(parseMessageEnvelope(retry).type, MessageType.RUNTIME_RETRY_RECENT_IMPROVEMENT);
    assert.equal(parseMessageEnvelope(toggle).type, MessageType.RUNTIME_TOGGLE_DICTATION);
  });
});
