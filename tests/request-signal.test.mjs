import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequestSignal } from "../src/background/providers/request-signal.js";

describe("request signal", () => {
  it("reports a timeout so the provider can name the failure", async () => {
    const requestSignal = createRequestSignal({ parentSignal: null, timeoutMs: 1 });

    assert.equal(requestSignal.timedOut(), false);
    await once(requestSignal.signal, "abort");

    // Providers branch on this to choose STT_TIMEOUT over a generic failure.
    assert.equal(requestSignal.timedOut(), true);
    assert.equal(requestSignal.signal.aborted, true);
    requestSignal.cleanup();
  });

  it("aborts immediately when the parent is already aborted", () => {
    const parent = new AbortController();
    parent.abort();

    const requestSignal = createRequestSignal({ parentSignal: parent.signal, timeoutMs: 60_000 });

    assert.equal(requestSignal.signal.aborted, true);
    assert.equal(requestSignal.timedOut(), false);
    requestSignal.cleanup();
  });

  it("follows a parent aborted later without claiming a timeout", () => {
    const parent = new AbortController();
    const requestSignal = createRequestSignal({ parentSignal: parent.signal, timeoutMs: 60_000 });

    assert.equal(requestSignal.signal.aborted, false);
    parent.abort();

    assert.equal(requestSignal.signal.aborted, true);
    assert.equal(requestSignal.timedOut(), false);
    requestSignal.cleanup();
  });

  it("stops following the parent after cleanup", () => {
    const parent = new AbortController();
    const requestSignal = createRequestSignal({ parentSignal: parent.signal, timeoutMs: 60_000 });

    requestSignal.cleanup();
    parent.abort();

    // A finished request must not be aborted by a later session cancellation.
    assert.equal(requestSignal.signal.aborted, false);
  });

  it("never fires a cleared timeout", async () => {
    const requestSignal = createRequestSignal({ parentSignal: null, timeoutMs: 1 });
    requestSignal.cleanup();

    await delay(10);

    assert.equal(requestSignal.signal.aborted, false);
    assert.equal(requestSignal.timedOut(), false);
  });

  it("runs without a timeout when none is configured", () => {
    const requestSignal = createRequestSignal({ parentSignal: null, timeoutMs: 0 });

    assert.equal(requestSignal.signal.aborted, false);
    requestSignal.cleanup();
  });
});

function once(target, eventName) {
  return new Promise((resolve) => {
    target.addEventListener(eventName, resolve, { once: true });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
