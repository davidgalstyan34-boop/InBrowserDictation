const inputTextTypes = new Set([
  "",
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week"
]);

export function captureActiveTarget() {
  const element = document.activeElement;

  if (!element || element === document.body || element === document.documentElement) {
    return {
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

  return {
    kind: "none",
    reason: "Focused element is not editable"
  };
}

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

function captureContentEditableTarget(element) {
  const editableRoot = element.closest?.("[contenteditable=''], [contenteditable='true']");
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

export function describeCapturedTarget(target) {
  const kind = target?.kind ?? "none";
  const descriptionActions = {
    none: () => "No editable target captured",
    blocked: () => target.reason
  };

  const action = descriptionActions[kind];
  return action ? action() : `${kind} target captured`;
}

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
