import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

// target-capture.js reads live browser globals, so the smallest honest way to
// test it is to install stand-ins for the exact globals it touches: the element
// classes it uses for `instanceof`, plus `document` and `window`.
class FakeElement {
  constructor({ tagName = "div", attributes = {} } = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.id = attributes.id ?? "";
    this.shadowRoot = null;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  closest(selector) {
    return selector.includes("contenteditable") && this.contentEditableRoot
      ? this.contentEditableRoot
      : null;
  }

  contains() {
    return true;
  }
}

class FakeHTMLElement extends FakeElement {}
class FakeInput extends FakeHTMLElement {
  constructor({ type = "text", value = "", selectionStart = 0, selectionEnd = 0, ...rest } = {}) {
    super({ tagName: "input", ...rest });
    this.type = type;
    this.value = value;
    this.selectionStart = selectionStart;
    this.selectionEnd = selectionEnd;
    this.disabled = false;
    this.readOnly = false;
  }
}
class FakeTextArea extends FakeHTMLElement {}
class FakeIFrame extends FakeHTMLElement {}

let captureActiveTarget;
let summarizeCapturedTarget;
const originalGlobals = {};

before(async () => {
  for (const name of ["HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "document", "window"]) {
    originalGlobals[name] = globalThis[name];
  }

  globalThis.HTMLElement = FakeHTMLElement;
  globalThis.HTMLInputElement = FakeInput;
  globalThis.HTMLTextAreaElement = FakeTextArea;
  globalThis.document = { activeElement: null, body: new FakeElement(), documentElement: new FakeElement() };
  globalThis.window = { getSelection: () => null };

  ({ captureActiveTarget, summarizeCapturedTarget } = await import("../src/content/target-capture.js"));
});

after(() => {
  for (const [name, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      delete globalThis[name];
      continue;
    }

    globalThis[name] = value;
  }
});

describe("target capture", () => {
  it("captures a plain focused input", () => {
    const input = new FakeInput({ value: "hello", selectionStart: 5, selectionEnd: 5 });
    globalThis.document.activeElement = input;

    const target = captureActiveTarget();

    assert.equal(target.kind, "input");
    assert.equal(target.element, input);
    assert.equal(target.valueAtCapture, "hello");
    assert.equal(target.valueLength, 5);

    const summary = summarizeCapturedTarget(target);
    assert.equal(Object.hasOwn(summary, "valueAtCapture"), false);
  });

  it("descends through an open shadow root to the real editor", () => {
    // A web-component editor: document.activeElement stops at the custom
    // element, and the input the user is typing in lives inside its shadow root.
    const innerInput = new FakeInput({ value: "shadow text", selectionStart: 2, selectionEnd: 4 });
    const host = new FakeHTMLElement({ tagName: "my-editor" });
    host.shadowRoot = { activeElement: innerInput };
    globalThis.document.activeElement = host;

    const target = captureActiveTarget();

    assert.equal(target.kind, "input");
    assert.equal(target.element, innerInput);
    assert.deepEqual([target.selectionStart, target.selectionEnd], [2, 4]);
  });

  it("descends through nested shadow roots", () => {
    const innerInput = new FakeInput({ value: "deep" });
    const innerHost = new FakeHTMLElement({ tagName: "inner-editor" });
    innerHost.shadowRoot = { activeElement: innerInput };
    const outerHost = new FakeHTMLElement({ tagName: "outer-editor" });
    outerHost.shadowRoot = { activeElement: innerHost };
    globalThis.document.activeElement = outerHost;

    assert.equal(captureActiveTarget().element, innerInput);
  });

  it("still refuses password fields reached through a shadow root", () => {
    const password = new FakeInput({ type: "password" });
    const host = new FakeHTMLElement({ tagName: "login-form" });
    host.shadowRoot = { activeElement: password };
    globalThis.document.activeElement = host;

    const target = captureActiveTarget();

    assert.equal(target.kind, "blocked");
    assert.match(target.reason, /password/i);
  });

  it("reports no target when focus rests on a frame element", () => {
    // The claiming frame answers instead; this frame has nothing to offer.
    globalThis.document.activeElement = new FakeIFrame({ tagName: "iframe" });

    assert.equal(captureActiveTarget().kind, "none");
  });
});
