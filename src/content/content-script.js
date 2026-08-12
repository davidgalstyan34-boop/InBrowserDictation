(function initializeDictationContentScript() {
  const PROTOCOL_VERSION = 1;
  const MessageType = Object.freeze({
    CONTENT_PREPARE_DICTATION: "content.prepareDictation",
    CONTENT_CANCEL_DICTATION: "content.cancelDictation",
    CONTENT_SHOW_STATE: "content.showState",
    RUNTIME_GET_STATE: "runtime.getState"
  });

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

  let activeSession = null;
  let overlayHost = null;
  let overlayRoot = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isMessage(message)) {
      return false;
    }

    if (message.type === MessageType.CONTENT_SHOW_STATE) {
      showOverlay(message.payload);
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === MessageType.CONTENT_PREPARE_DICTATION) {
      const target = captureTarget();
      activeSession = {
        id: message.sessionId,
        target,
        capturedAt: Date.now()
      };

      showOverlay({
        title: "Ready",
        detail: describeTarget(target)
      });

      sendResponse({ ok: true, target: toPublicTarget(target) });
      return false;
    }

    if (message.type === MessageType.CONTENT_CANCEL_DICTATION) {
      if (!message.sessionId || activeSession?.id === message.sessionId) {
        activeSession = null;
        showOverlay({
          title: message.payload?.title || "Cancelled",
          detail: message.payload?.detail || "Dictation stopped",
          tone: "muted"
        });
      }

      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  function isMessage(value) {
    return Boolean(
      value &&
        value.protocolVersion === PROTOCOL_VERSION &&
        typeof value.type === "string" &&
        Object.values(MessageType).includes(value.type)
    );
  }

  function captureTarget() {
    const element = document.activeElement;

    if (!element || element === document.body || element === document.documentElement) {
      return {
        kind: "none",
        reason: "No editable target is focused"
      };
    }

    if (element instanceof HTMLInputElement) {
      return captureInputTarget(element);
    }

    if (element instanceof HTMLTextAreaElement) {
      return captureTextAreaTarget(element);
    }

    const editableRoot = element.closest?.("[contenteditable=''], [contenteditable='true']");
    if (editableRoot instanceof HTMLElement) {
      return captureContentEditableTarget(editableRoot);
    }

    return {
      kind: "none",
      reason: "Focused element is not editable"
    };
  }

  function captureInputTarget(element) {
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

    return {
      kind: "input",
      element,
      descriptor: describeElement(element),
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
      valueLength: element.value.length
    };
  }

  function captureTextAreaTarget(element) {
    if (element.disabled || element.readOnly) {
      return {
        kind: "blocked",
        reason: "Focused textarea is disabled or read-only"
      };
    }

    return {
      kind: "textarea",
      element,
      descriptor: describeElement(element),
      selectionStart: element.selectionStart,
      selectionEnd: element.selectionEnd,
      valueLength: element.value.length
    };
  }

  function captureContentEditableTarget(element) {
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const ownsSelection = range ? element.contains(range.commonAncestorContainer) : false;

    return {
      kind: "contenteditable",
      element,
      descriptor: describeElement(element),
      hasSelection: Boolean(range),
      ownsSelection,
      range: ownsSelection ? range.cloneRange() : null
    };
  }

  function toPublicTarget(target) {
    const base = {
      kind: target.kind,
      reason: target.reason ?? null,
      descriptor: target.descriptor ?? null
    };

    if (target.kind === "input" || target.kind === "textarea") {
      return {
        ...base,
        selectionStart: target.selectionStart,
        selectionEnd: target.selectionEnd,
        valueLength: target.valueLength
      };
    }

    if (target.kind === "contenteditable") {
      return {
        ...base,
        hasSelection: target.hasSelection,
        ownsSelection: target.ownsSelection
      };
    }

    return base;
  }

  function describeTarget(target) {
    if (!target || target.kind === "none") {
      return "No editable target captured";
    }

    if (target.kind === "blocked") {
      return target.reason;
    }

    return `${target.kind} target captured`;
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

  function showOverlay({ title, detail, tone = "default" }) {
    ensureOverlay();
    overlayRoot.querySelector("[data-title]").textContent = title || "Dictation";
    overlayRoot.querySelector("[data-detail]").textContent = detail || "";
    overlayRoot.querySelector("[data-panel]").dataset.tone = tone;
  }

  function ensureOverlay() {
    if (overlayRoot && document.documentElement.contains(overlayHost)) {
      return;
    }

    overlayHost = document.createElement("div");
    overlayHost.id = "in-browser-dictation-overlay";
    overlayHost.style.position = "fixed";
    overlayHost.style.inset = "16px 16px auto auto";
    overlayHost.style.zIndex = "2147483647";

    overlayRoot = overlayHost.attachShadow({ mode: "closed" });
    overlayRoot.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        [data-panel] {
          box-sizing: border-box;
          min-width: 184px;
          max-width: min(320px, calc(100vw - 32px));
          border: 1px solid rgba(24, 32, 28, 0.16);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.96);
          color: #17211c;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 12px 14px;
        }

        [data-panel][data-tone="muted"] {
          color: #47524d;
        }

        [data-title] {
          display: block;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.25;
          letter-spacing: 0;
        }

        [data-detail] {
          display: block;
          margin-top: 4px;
          font-size: 12px;
          line-height: 1.35;
          color: #4b5a53;
          overflow-wrap: anywhere;
        }
      </style>
      <div data-panel data-tone="default" role="status" aria-live="polite">
        <span data-title>Dictation</span>
        <span data-detail></span>
      </div>
    `;

    document.documentElement.append(overlayHost);
  }
})();
