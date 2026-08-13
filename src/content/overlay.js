let overlayHost = null;
let overlayElements = null;
let autoDismissTimer = null;

const SUCCESS_AUTO_DISMISS_MS = 3500;
const ERROR_AUTO_DISMISS_MS = 8000;
const OVERLAY_HOST_ID = "in-browser-dictation-overlay";

/**
 * Creates or updates the in-page dictation status overlay.
 *
 * The overlay is deliberately tiny and page-independent because it appears on
 * arbitrary websites whose CSS should not affect extension feedback.
 */
export function renderDictationOverlay({ title, detail, tone = "default", status = null }) {
  clearAutoDismissTimer();
  mountOverlay();
  overlayElements.title.textContent = title || "Dictation";
  overlayElements.detail.textContent = detail || "";
  overlayElements.panel.dataset.tone = tone;

  const autoDismissDelay = getAutoDismissDelay({ status, tone });
  if (autoDismissDelay) {
    autoDismissTimer = setTimeout(removeOverlay, autoDismissDelay);
  }
}

/**
 * Removes the overlay immediately when the background starts a replacement
 * terminal session or explicitly clears page feedback.
 */
export function dismissDictationOverlay() {
  removeOverlay();
}

/**
 * Mounts the Shadow DOM overlay once and caches handles for later updates.
 */
function mountOverlay() {
  removeDuplicateOverlayHosts();

  if (overlayElements && document.documentElement.contains(overlayHost)) {
    return;
  }

  overlayHost = document.createElement("div");
  overlayHost.id = OVERLAY_HOST_ID;
  overlayHost.style.position = "fixed";
  overlayHost.style.inset = "16px 16px auto auto";
  overlayHost.style.zIndex = "2147483647";

  // A closed shadow root protects the status UI from page CSS. The extension
  // owns all styling for this small overlay.
  const overlayRoot = overlayHost.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
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

    [data-panel][data-tone="success"] {
      border-color: rgba(22, 101, 52, 0.28);
      color: #14532d;
    }

    [data-panel][data-tone="error"] {
      border-color: rgba(185, 28, 28, 0.32);
      color: #7f1d1d;
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

    [data-panel][data-tone="success"] [data-detail] {
      color: #166534;
    }

    [data-panel][data-tone="error"] [data-detail] {
      color: #991b1b;
    }
  `;

  const panel = document.createElement("div");
  panel.dataset.panel = "";
  panel.dataset.tone = "default";
  panel.setAttribute("role", "status");
  panel.setAttribute("aria-live", "polite");

  const titleElement = document.createElement("span");
  titleElement.dataset.title = "";
  titleElement.textContent = "Dictation";

  const detailElement = document.createElement("span");
  detailElement.dataset.detail = "";

  panel.append(titleElement, detailElement);
  overlayRoot.append(style, panel);
  overlayElements = {
    panel,
    title: titleElement,
    detail: detailElement
  };

  document.documentElement.append(overlayHost);
}

/**
 * Terminal feedback should be visible briefly, then get out of the page's way.
 * Errors stay up longer because they often contain the next corrective action.
 */
function getAutoDismissDelay({ status, tone }) {
  if (status === "SUCCESS" || tone === "success") {
    return SUCCESS_AUTO_DISMISS_MS;
  }

  if (status === "ERROR" || tone === "error") {
    return ERROR_AUTO_DISMISS_MS;
  }

  return null;
}

function clearAutoDismissTimer() {
  if (!autoDismissTimer) {
    return;
  }

  clearTimeout(autoDismissTimer);
  autoDismissTimer = null;
}

function removeOverlay() {
  clearAutoDismissTimer();
  overlayHost?.remove();
  overlayHost = null;
  overlayElements = null;
}

function removeDuplicateOverlayHosts() {
  for (const host of document.querySelectorAll(`#${OVERLAY_HOST_ID}`)) {
    if (host !== overlayHost) {
      host.remove();
    }
  }
}
