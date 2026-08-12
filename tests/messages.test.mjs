import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MessageType, PROTOCOL_VERSION, createEnvelope, isMessage } from "../src/shared/messages.js";

describe("message contracts", () => {
  it("creates valid protocol envelopes", () => {
    const message = createEnvelope(MessageType.CONTENT_PREPARE_DICTATION, { source: "test" }, "session-1");

    assert.equal(message.protocolVersion, PROTOCOL_VERSION);
    assert.equal(message.type, MessageType.CONTENT_PREPARE_DICTATION);
    assert.equal(message.sessionId, "session-1");
    assert.equal(message.payload.source, "test");
    assert.equal(isMessage(message), true);
  });

  it("rejects unknown message types", () => {
    assert.equal(isMessage({
      protocolVersion: PROTOCOL_VERSION,
      type: "unknown",
      payload: {}
    }), false);
  });
});
