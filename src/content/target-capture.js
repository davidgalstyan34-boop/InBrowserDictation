// Selection APIs are only reliable for these freeform text input types.
const inputTextTypes = new Set([
  "",
  "email",
  "search",
  "tel",
  "text",
  "url"
]);
const CONTENTEDITABLE_SELECTOR = "[contenteditable]:not([contenteditable='false'])";

/**
 * Captures the currently focused editable target for a dictation session.
 *
 * The return value may include live DOM references, so callers must keep the
 * full object inside the content script and send only `summarizeCapturedTarget`
 * across extension messaging.
 */
export function captureActiveTarget() {
  const element = getDeepActiveElement();
  const selectedEditorTarget = captureSelectedContentEditableTarget();

  if (!element || element === document.body || element === document.documentElement) {
    return selectedEditorTarget ?? {
      kind: "none",
      reason: "No editable target is focused"
    };
  }

  const targetCaptureActions = [
    captureInputTarget,
    captureTextAreaTarget,
    captureContentEditableTarget
  ];

  for (const action of targetCaptureActions) {
    const target = action(element);
    if (target) {
      return target;
    }
  }

  return selectedEditorTarget ?? {
    kind: "none",
    reason: "Focused element is not editable"
  };
}

/**
 * Resolves the focused element through open shadow roots.
 *
 * `document.activeElement` stops at the shadow host, so a web-component editor
 * reports the custom element rather than the input inside it. Each shadow root
 * tracks its own `activeElement`, so the real target is found by descending
 * while hosts keep delegating focus inward. Closed shadow roots expose no
 * `shadowRoot`, so descent simply stops there.
 */
function getDeepActiveElement(root = document) {
  let element = root.activeElement;

  while (element?.shadowRoot?.activeElement) {
    element = element.shadowRoot.activeElement;
  }

  return element;
}

/**
 * Returns capture details for supported text-like input elements.
 */
function captureInputTarget(element) {
  if (!(element instanceof HTMLInputElement)) {
    return null;
  }

  const type = element.type.toLowerCase();

  if (type === "password" || type === "hidden") {
    return {
      kind: "blocked",
      reason: `${type} inputs are never dictation targets`
    };
  }

  if (!inputTextTypes.has(type)) {
    return {
      kind: "blocked",
      reason: `${type} inputs are not supported`
    };
  }

  if (element.disabled || element.readOnly) {
    return {
      kind: "blocked",
      reason: "Focused input is disabled or read-only"
    };
  }

  return captureTextControl(element, "input");
}

/**
 * Returns capture details for textarea elements.
 */
function captureTextAreaTarget(element) {
  if (!(element instanceof HTMLTextAreaElement)) {
    return null;
  }

  if (element.disabled || element.readOnly) {
    return {
      kind: "blocked",
      reason: "Focused textarea is disabled or read-only"
    };
  }

  return captureTextControl(element, "textarea");
}

/**
 * Captures a contenteditable root and its current selection range when safe.
 */
function captureContentEditableTarget(element) {
  const editableRoot = findEditableRoot(element);
  if (!(editableRoot instanceof HTMLElement)) {
    return null;
  }

  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const ownsSelection = range ? editableRoot.contains(range.commonAncestorContainer) : false;

  return {
    kind: "contenteditable",
    element: editableRoot,
    descriptor: describeElement(editableRoot),
    hasSelection: Boolean(range),
    ownsSelection,
    // Keep the DOM Range local to the content script; the worker only receives
    // the serializable summary returned by summarizeCapturedTarget.
    range: ownsSelection ? range.cloneRange() : null
  };
}

function captureSelectedContentEditableTarget() {
  const selection = window.getSelection?.();
  const selectedElement = getElementFromNode(selection?.anchorNode);
  const editableRoot = findEditableRoot(selectedElement);

  return editableRoot ? captureContentEditableTarget(editableRoot) : null;
}

function findEditableRoot(element) {
  return element instanceof HTMLElement
    ? element.closest?.(CONTENTEDITABLE_SELECTOR)
    : null;
}

function getElementFromNode(node) {
  if (node instanceof HTMLElement) {
    return node;
  }

  return node?.parentElement ?? null;
}

/**
 * Records caret/selection positions for input-like controls.
 */
function captureTextControl(element, kind) {
  return {
    kind,
    element,
    descriptor: describeElement(element),
    selectionStart: element.selectionStart,
    selectionEnd: element.selectionEnd,
    valueLength: element.value.length
  };
}

/**
 * Converts a captured target into the serializable shape sent to background.
 */
export function summarizeCapturedTarget(target) {
  const base = {
    kind: target.kind,
    reason: target.reason ?? null,
    descriptor: target.descriptor ?? null
  };

  const summaryActions = {
    input: summarizeTextControl,
    textarea: summarizeTextControl,
    contenteditable: summarizeContentEditable
  };

  const action = summaryActions[target.kind];
  return action ? action(target, base) : base;
}

function summarizeTextControl(target, base) {
  return {
    ...base,
    selectionStart: target.selectionStart,
    selectionEnd: target.selectionEnd,
    valueLength: target.valueLength
  };
}

function summarizeContentEditable(target, base) {
  return {
    ...base,
    hasSelection: target.hasSelection,
    ownsSelection: target.ownsSelection
  };
}

/**
 * Builds short overlay text for a captured target.
 */
export function describeCapturedTarget(target) {
  const kind = target?.kind ?? "none";
  const descriptionActions = {
    none: () => "No editable target captured",
    blocked: () => target.reason
  };

  const action = descriptionActions[kind];
  return action ? action() : `${kind} target captured`;
}

/**
 * Creates a compact, human-readable element descriptor for diagnostics/UI.
 */
function describeElement(element) {
  const parts = [element.tagName.toLowerCase()];

  if (element.id) {
    parts.push(`#${element.id}`);
  }

  if (element.getAttribute("name")) {
    parts.push(`[name="${element.getAttribute("name")}"]`);
  }

  if (element.getAttribute("aria-label")) {
    parts.push(`[aria-label="${element.getAttribute("aria-label")}"]`);
  }

  return parts.join("");
}
