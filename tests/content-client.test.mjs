import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createContentClient } from "../src/background/clients/content-client.js";
import { MessageType } from "../src/shared/messages.js";

describe("content client frame routing", () => {
  it("sends overlay state to the top frame only", async () => {
    const { client, sent } = createClient();

    await client.showState(7, "session-1", { status: "RECORDING" });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].message.type, MessageType.CONTENT_SHOW_STATE);
    assert.deepEqual(sent[0].options, { frameId: 0 });
  });

  it("broadcasts dismissal so every frame releases captured state", async () => {
    const { client, sent } = createClient();

    await client.safeDismissOverlay(7, "session-1");

    assert.equal(sent.length, 1);
    assert.equal(sent[0].message.type, MessageType.CONTENT_DISMISS_OVERLAY);
    assert.equal(sent[0].options, undefined);
  });

  it("broadcasts target capture so the focused frame can claim it", async () => {
    const { client, sent } = createClient({
      respond: () => ({ ok: true, target: { kind: "textarea" } })
    });

    const response = await client.prepareDictation(7, "session-1");

    assert.equal(response.target.kind, "textarea");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].options, undefined);
    assert.equal(sent[0].message.payload.requireClaim, undefined);
  });

  it("asks the top frame to claim when no frame answers the broadcast", async () => {
    // Chrome reports an unanswered broadcast as a closed port, which is not the
    // same as having no content script at all.
    const { client, sent } = createClient({
      respond: ({ options }) => {
        if (!options) {
          throw new Error("The message port closed before a response was received.");
        }

        return { ok: true, target: { kind: "none" } };
      }
    });

    const response = await client.prepareDictation(7, "session-1");

    assert.equal(response.target.kind, "none");
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1].options, { frameId: 0 });
    assert.equal(sent[1].message.payload.requireClaim, true);
  });

  it("injects the content script when the tab has no receiver at all", async () => {
    const injected = [];
    const { client, sent } = createClient({
      injected,
      respond: ({ attempt }) => {
        if (attempt === 1) {
          throw new Error("Could not establish connection. Receiving end does not exist.");
        }

        return { ok: true, target: { kind: "input" } };
      }
    });

    const response = await client.prepareDictation(7, "session-1");

    assert.equal(response.target.kind, "input");
    assert.deepEqual(injected, [7]);
    assert.equal(sent.length, 2);
  });

  it("broadcasts insertion so the claiming frame answers", async () => {
    const { client, sent } = createClient({
      respond: () => ({ ok: true, insertion: { method: "target" } })
    });

    await client.insertText(7, "session-1", "final text");

    assert.equal(sent.length, 1);
    assert.equal(sent[0].message.type, MessageType.CONTENT_INSERT_TEXT);
    assert.equal(sent[0].options, undefined);
  });

  it("does not retry a real messaging failure as an unclaimed broadcast", async () => {
    const { client, sent } = createClient({
      respond: () => {
        throw new Error("Tab was discarded.");
      }
    });

    await assert.rejects(client.prepareDictation(7, "session-1"), /discarded/);
    assert.equal(sent.length, 1);
  });
});

function createClient({ respond = () => ({ ok: true }), injected = [] } = {}) {
  const sent = [];

  const client = createContentClient({
    chromeApi: {
      tabs: {
        query: async () => [{ id: 7 }],
        sendMessage: async (tabId, message, options) => {
          sent.push({ tabId, message, options });
          return respond({ tabId, message, options, attempt: sent.length });
        }
      },
      scripting: {
        executeScript: async ({ target }) => {
          injected.push(target.tabId);
        }
      }
    }
  });

  return { client, sent, injected };
}
