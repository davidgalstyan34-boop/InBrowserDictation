/**
 * Inserts final dictation output into the target captured at session start.
 *
 * Live elements and Ranges are content-script-only data. This module never
 * reaches back into the service worker for target state, and it falls back to
 * clipboard writes when a previously captured DOM target is no longer safe.
 */

/**
 * Attempts target insertion first, then clipboard fallback.
 */
export async function insertTextIntoCapturedTarget(target, text, {
  clipboard = getDefaultClipboard(),
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  EventCtor = globalThis.Event,
  InputEventCtor = globalThis.InputEvent
} = {}) {
  const insertionText = normalizeInsertionText(text);
  let targetError = null;

  try {
    return insertIntoCapturedTarget(target, insertionText, {
      documentRef,
      windowRef,
      EventCtor,
      InputEventCtor
    });
  } catch (error) {
    targetError = normalizeInsertionError(error);
  }

  try {
    const strategy = await writeTextToClipboard(insertionText, {
      clipboard,
      documentRef
    });

    return {
      method: "clipboard",
      strategy,
      targetKind: target?.kind ?? "none",
      textLength: insertionText.length,
      fallbackReason: targetError.code
    };
  } catch (clipboardError) {
    throw createInsertionError(
      "INSERTION_AND_CLIPBOARD_FAILED",
      "Text could not be inserted or copied to the clipboard.",
      {
        targetError,
        clipboardError: normalizeInsertionError(clipboardError)
      }
    );
  }
}

function insertIntoCapturedTarget(target, text, environment) {
  if (!target || target.kind === "none" || target.kind === "blocked") {
    throw createInsertionError(
      "INSERTION_TARGET_MISSING",
      "No editable target is available for insertion."
    );
  }

  if (target.kind === "input" || target.kind === "textarea") {
    return insertIntoTextControl(target, text, environment);
  }

  if (target.kind === "contenteditable") {
    return insertIntoContentEditable(target, text, environment);
  }

  throw createInsertionError(
    "INSERTION_TARGET_UNSUPPORTED",
    "The captured target does not support insertion."
  );
}

function insertIntoTextControl(target, text, environment) {
  const element = target.element;
  assertUsableElement(element);

  if (element.disabled || element.readOnly) {
    throw createInsertionError(
      "INSERTION_TARGET_READONLY",
      "The captured target is disabled or read-only."
    );
  }

  if (typeof element.value !== "string") {
    throw createInsertionError(
      "INSERTION_TARGET_INVALID",
      "The captured text control is no longer valid."
    );
  }

  if (Number.isInteger(target.valueLength) && target.valueLength !== element.value.length) {
    throw createInsertionError(
      "INSERTION_TARGET_STALE",
      "The captured target changed before insertion."
    );
  }

  const start = clampIndex(target.selectionStart, element.value.length);
  const end = clampIndex(target.selectionEnd, element.value.length);
  const selectionStart = Math.min(start, end);
  const selectionEnd = Math.max(start, end);

  element.focus?.();
  dispatchBeforeInput(element, text, environment);

  setTextControlValue(element, [
    element.value.slice(0, selectionStart),
    text,
    element.value.slice(selectionEnd)
  ].join(""));

  const caret = selectionStart + text.length;
  moveTextControlCaret(element, caret);
  dispatchInput(element, text, environment);

  return {
    method: "target",
    targetKind: target.kind,
    textLength: text.length
  };
}

function insertIntoContentEditable(target, text, environment) {
  const element = target.element;
  const range = target.range;
  assertUsableElement(element);

  if (!range || typeof range.deleteContents !== "function" || typeof range.insertNode !== "function") {
    throw createInsertionError(
      "INSERTION_RANGE_MISSING",
      "The captured editor selection is no longer available."
    );
  }

  if (typeof element.contains === "function" && !element.contains(range.commonAncestorContainer)) {
    throw createInsertionError(
      "INSERTION_RANGE_STALE",
      "The captured editor selection is no longer inside the target."
    );
  }

  const textNode = environment.documentRef?.createTextNode?.(text);
  if (!textNode) {
    throw createInsertionError(
      "INSERTION_DOCUMENT_UNAVAILABLE",
      "The page document is unavailable for insertion."
    );
  }

  element.focus?.();
  restoreRangeSelection(range, environment.windowRef);
  dispatchBeforeInput(element, text, environment);

  range.deleteContents();
  range.insertNode(textNode);
  moveRangeAfterNode(range, textNode);
  restoreRangeSelection(range, environment.windowRef);
  dispatchInput(element, text, environment);

  return {
    method: "target",
    targetKind: "contenteditable",
    textLength: text.length
  };
}

function assertUsableElement(element) {
  if (!element || element.isConnected === false) {
    throw createInsertionError(
      "INSERTION_TARGET_DETACHED",
      "The captured target is no longer attached to the page."
    );
  }

  if (typeof element.dispatchEvent !== "function") {
    throw createInsertionError(
      "INSERTION_TARGET_INVALID",
      "The captured target is no longer valid."
    );
  }
}

function dispatchBeforeInput(element, text, environment) {
  const event = createInputLikeEvent("beforeinput", text, {
    ...environment,
    cancelable: true
  });

  if (element.dispatchEvent(event) === false) {
    throw createInsertionError(
      "INSERTION_BEFOREINPUT_CANCELLED",
      "The page rejected the insertion before it changed."
    );
  }
}

function dispatchInput(element, text, environment) {
  element.dispatchEvent(createInputLikeEvent("input", text, environment));
}

function createInputLikeEvent(type, text, {
  EventCtor,
  InputEventCtor,
  cancelable = false
}) {
  const options = {
    bubbles: true,
    cancelable,
    inputType: "insertText",
    data: text
  };

  if (typeof InputEventCtor === "function") {
    try {
      return new InputEventCtor(type, options);
    } catch {
      // Some test or browser contexts expose InputEvent but reject construction.
    }
  }

  if (typeof EventCtor === "function") {
    const event = new EventCtor(type, {
      bubbles: true,
      cancelable
    });
    defineOptionalEventData(event, options);
    return event;
  }

  return {
    type,
    ...options
  };
}

function defineOptionalEventData(event, values) {
  for (const [key, value] of Object.entries(values)) {
    if (key in event) {
      continue;
    }

    try {
      Object.defineProperty(event, key, {
        value,
        enumerable: true
      });
    } catch {
      // Event objects can be non-extensible in some browser/test contexts.
    }
  }
}

function restoreRangeSelection(range, windowRef) {
  const selection = windowRef?.getSelection?.();
  if (!selection) {
    return;
  }

  selection.removeAllRanges?.();
  selection.addRange?.(range);
}

function moveRangeAfterNode(range, node) {
  if (typeof range.setStartAfter === "function" && typeof range.setEndAfter === "function") {
    range.setStartAfter(node);
    range.setEndAfter(node);
  }
}

function setTextControlValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, "value") : null;
  if (typeof descriptor?.set === "function") {
    descriptor.set.call(element, value);
    return;
  }

  element.value = value;
}

function moveTextControlCaret(element, caret) {
  if (typeof element.setSelectionRange !== "function") {
    return;
  }

  try {
    element.setSelectionRange(caret, caret);
  } catch {
    // Some input types reject selection APIs even when a value update worked.
    // The insertion itself should not be duplicated through clipboard fallback.
  }
}

async function writeTextToClipboard(text, { clipboard, documentRef }) {
  if (typeof clipboard?.writeText === "function") {
    await clipboard.writeText(text);
    return "async-clipboard";
  }

  if (legacyCopyText(text, documentRef)) {
    return "exec-command";
  }

  throw createInsertionError(
    "CLIPBOARD_UNAVAILABLE",
    "Clipboard fallback is unavailable on this page."
  );
}

function legacyCopyText(text, documentRef) {
  if (!documentRef?.body || typeof documentRef.execCommand !== "function") {
    return false;
  }

  const textarea = documentRef.createElement?.("textarea");
  if (!textarea) {
    return false;
  }

  textarea.value = text;
  textarea.setAttribute?.("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  documentRef.body.appendChild(textarea);
  textarea.select?.();

  try {
    return documentRef.execCommand("copy") === true;
  } finally {
    textarea.remove?.();
  }
}

function clampIndex(value, length) {
  return Number.isInteger(value) && value >= 0 && value <= length
    ? value
    : length;
}

function normalizeInsertionText(text) {
  if (typeof text !== "string" || text.length === 0) {
    throw createInsertionError(
      "INSERTION_TEXT_MISSING",
      "No text is available for insertion."
    );
  }

  return text;
}

function getDefaultClipboard() {
  return globalThis.navigator?.clipboard;
}

function createInsertionError(code, message, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function normalizeInsertionError(error) {
  if (error?.code && error?.message) {
    return error;
  }

  return createInsertionError(
    "INSERTION_FAILED",
    error?.message || "Text insertion failed.",
    error
  );
}
