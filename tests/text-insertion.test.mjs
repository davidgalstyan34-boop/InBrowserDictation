import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { insertTextIntoCapturedTarget } from "../src/content/text-insertion.js";

describe("content text insertion", () => {
  it("inserts into the captured text-control selection and dispatches input events", async () => {
    const events = [];
    const element = createTextControl({
      value: "hello world",
      events
    });

    const result = await insertTextIntoCapturedTarget({
      kind: "input",
      element,
      selectionStart: 6,
      selectionEnd: 11,
      valueAtCapture: "hello world",
      valueLength: 11
    }, "there");

    assert.deepEqual(result, {
      method: "target",
      targetKind: "input",
      textLength: 5
    });
    assert.equal(element.value, "hello there");
    assert.deepEqual(element.selection, [11, 11]);
    assert.deepEqual(events.map((event) => event.type), ["beforeinput", "input"]);
    assert.equal(element.focused, true);
  });

  it("reports a stale target when the captured text control changed before insertion", async () => {
    const element = createTextControl({
      value: "changed"
    });

    await assert.rejects(
      insertTextIntoCapturedTarget({
        kind: "textarea",
        element,
        selectionStart: 0,
        selectionEnd: 3,
        valueAtCapture: "old",
        valueLength: 3
      }, "final text"),
      { code: "INSERTION_TARGET_STALE" }
    );

    assert.equal(element.value, "changed");
  });

  it("detects a changed target even when its length stayed the same", async () => {
    const element = createTextControl({ value: "world" });

    await assert.rejects(
      insertTextIntoCapturedTarget({
        kind: "input",
        element,
        selectionStart: 5,
        selectionEnd: 5,
        valueAtCapture: "hello",
        valueLength: 5
      }, "final text"),
      { code: "INSERTION_TARGET_STALE" }
    );

    assert.equal(element.value, "world");
  });

  it("keeps successful text-control insertion when caret APIs are unavailable", async () => {
    const events = [];
    const element = createTextControl({
      value: "hello",
      events
    });
    element.setSelectionRange = () => {
      throw new DOMException("Selection is unavailable.", "InvalidStateError");
    };

    const result = await insertTextIntoCapturedTarget({
      kind: "input",
      element,
      selectionStart: 5,
      selectionEnd: 5,
      valueAtCapture: "hello",
      valueLength: 5
    }, " world");

    assert.deepEqual(result, {
      method: "target",
      targetKind: "input",
      textLength: 6
    });
    assert.equal(element.value, "hello world");
    assert.deepEqual(events.map((event) => event.type), ["beforeinput", "input"]);
  });

  it("uses the editor insertText command for contenteditable targets when available", async () => {
    const selectedRanges = [];
    const commands = [];
    const commonAncestor = {};
    const element = {
      isConnected: true,
      contains: (node) => node === commonAncestor,
      dispatchEvent: () => true,
      focus() {}
    };
    const range = {
      commonAncestorContainer: commonAncestor
    };

    const result = await insertTextIntoCapturedTarget({
      kind: "contenteditable",
      element,
      range
    }, "edited text", {
      documentRef: {
        createTextNode: (text) => ({ textContent: text }),
        queryCommandSupported: (command) => command === "insertText",
        execCommand(command, _showUi, value) {
          commands.push([command, value]);
          return true;
        }
      },
      windowRef: {
        getSelection: () => ({
          removeAllRanges: () => selectedRanges.push(null),
          addRange: (nextRange) => selectedRanges.push(nextRange)
        })
      }
    });

    assert.deepEqual(result, {
      method: "target",
      strategy: "exec-command",
      targetKind: "contenteditable",
      textLength: 11
    });
    assert.deepEqual(commands, [["insertText", "edited text"]]);
    assert.equal(selectedRanges.includes(range), true);
  });

  it("falls back to captured contenteditable range insertion", async () => {
    const commonAncestor = {};
    const insertedNodes = [];
    const selectedRanges = [];
    const events = [];
    const element = {
      isConnected: true,
      focused: false,
      contains: (node) => node === commonAncestor,
      dispatchEvent: (event) => {
        events.push(event);
        return true;
      },
      focus() {
        this.focused = true;
      }
    };
    const range = {
      commonAncestorContainer: commonAncestor,
      deleted: false,
      movedAfter: null,
      deleteContents() {
        this.deleted = true;
      },
      insertNode(node) {
        insertedNodes.push(node);
      },
      setStartAfter(node) {
        this.movedAfter = node;
      },
      setEndAfter(node) {
        this.movedAfter = node;
      }
    };

    const result = await insertTextIntoCapturedTarget({
      kind: "contenteditable",
      element,
      range
    }, "edited text", {
      documentRef: {
        createTextNode: (text) => ({ textContent: text })
      },
      windowRef: {
        getSelection: () => ({
          removeAllRanges: () => selectedRanges.push(null),
          addRange: (nextRange) => selectedRanges.push(nextRange)
        })
      }
    });

    assert.deepEqual(result, {
      method: "target",
      strategy: "range",
      targetKind: "contenteditable",
      textLength: 11
    });
    assert.equal(element.focused, true);
    assert.equal(range.deleted, true);
    assert.equal(insertedNodes[0].textContent, "edited text");
    assert.equal(range.movedAfter, insertedNodes[0]);
    assert.deepEqual(events.map((event) => event.type), ["beforeinput", "input"]);
    assert.equal(selectedRanges.includes(range), true);
  });

  it("normalizes a DOMException thrown during target insertion", async () => {
    const element = createTextControl({ value: "hello" });
    element.dispatchEvent = () => {
      // DOMException carries a legacy numeric `code` (InvalidStateError is 11),
      // which must not survive into the reported fallback reason.
      throw new DOMException("The element is in an invalid state.", "InvalidStateError");
    };

    await assert.rejects(
      insertTextIntoCapturedTarget({
        kind: "input",
        element,
        selectionStart: 5,
        selectionEnd: 5,
        valueAtCapture: "hello",
        valueLength: 5
      }, "final text"),
      { code: "INSERTION_FAILED" }
    );
  });

  it("rejects text captured against a blocked field", async () => {
    await assert.rejects(
      insertTextIntoCapturedTarget({
        kind: "blocked",
        reason: "password inputs are never dictation targets"
      }, "secret text"),
      { code: "INSERTION_TARGET_BLOCKED" }
    );
  });

  it("reports a missing target when no editable target was focused", async () => {
    await assert.rejects(
      insertTextIntoCapturedTarget({ kind: "none" }, "text"),
      { code: "INSERTION_TARGET_MISSING" }
    );
  });
});

function createTextControl({ value, events = [] }) {
  return {
    value,
    events,
    isConnected: true,
    disabled: false,
    readOnly: false,
    focused: false,
    selection: null,
    focus() {
      this.focused = true;
    },
    setSelectionRange(start, end) {
      this.selection = [start, end];
    },
    dispatchEvent(event) {
      events.push(event);
      return true;
    }
  };
}
