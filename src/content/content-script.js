// Static content-script entrypoint, running in every frame of the page.
//
// Chrome loads this non-module file directly from the manifest. It imports the
// real module through a web-accessible extension URL so the rest of the content
// logic can use ES modules.
//
// Because the script runs in every frame, this file also owns the frame-claim
// protocol. `chrome.tabs.sendMessage` delivers a broadcast to every frame, but
// only one response reaches the service worker, and which one is undefined. So
// exactly one frame must answer a message that carries a result: all others
// return false and stay silent, which the service worker sees as a closed port.
//
// That decision has to be synchronous, because returning true is what commits
// this frame to responding. It therefore cannot wait for the module import, and
// is kept here as a small, self-contained check.
let contentAppModule = null;
let ownedSessionId = null;

const CONTENT_PREPARE_DICTATION = "content.prepareDictation";
const CONTENT_INSERT_TEXT = "content.insertText";
const CONTENT_DISMISS_OVERLAY = "content.dismissOverlay";

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  if (!shouldHandleInThisFrame(rawMessage)) {
    return false;
  }

  if (rawMessage?.type === CONTENT_PREPARE_DICTATION) {
    ownedSessionId = rawMessage.sessionId ?? null;
  }

  if (rawMessage?.type === CONTENT_DISMISS_OVERLAY && rawMessage.sessionId === ownedSessionId) {
    ownedSessionId = null;
  }

  loadContentAppModule()
    .then(({ handleRuntimeMessage }) => {
      handleRuntimeMessage({ rawMessage, sender, sendResponse });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: {
          code: "CONTENT_MODULE_LOAD_FAILED",
          message: error.message,
          moduleUrl: chrome.runtime.getURL("content/content-app.js")
        }
      });
    });

  return true;
});

/**
 * Decides synchronously whether this frame should answer a message.
 *
 * Messages that carry no result for the service worker (overlay updates,
 * dismissals) are handled everywhere they are delivered. Messages whose
 * response matters are answered by exactly one frame.
 */
function shouldHandleInThisFrame(rawMessage) {
  if (rawMessage?.type === CONTENT_PREPARE_DICTATION) {
    // A retry aimed at a specific frame asks it to claim the session even
    // though no frame volunteered on the first pass.
    return rawMessage.payload?.requireClaim === true || shouldClaimDictationTarget();
  }

  if (rawMessage?.type === CONTENT_INSERT_TEXT) {
    return rawMessage.sessionId === ownedSessionId;
  }

  return true;
}

/**
 * Reports whether the focused editable target lives in this frame.
 *
 * Focus is unique across a frame tree, and `document.hasFocus()` is true for
 * the focused document *and* all of its ancestors. The ancestors are excluded
 * by their active element being the frame that holds focus, which leaves
 * exactly one claimant. When nothing in the tab holds focus the top frame
 * claims, so a page with no editable target behaves as it always has.
 */
function shouldClaimDictationTarget() {
  if (holdsFrameElement(getDeepActiveElement())) {
    return false;
  }

  if (!document.hasFocus()) {
    return window.top === window;
  }

  return true;
}

/**
 * Descends through open shadow roots to the element that really has focus.
 *
 * This repeats the traversal in `target-capture.js` rather than importing it.
 * The claim decision has to be synchronous, and the module that owns capture is
 * loaded asynchronously; a frame that waited for it would already have had to
 * commit to answering.
 */
function getDeepActiveElement() {
  let element = document.activeElement;

  while (element?.shadowRoot?.activeElement) {
    element = element.shadowRoot.activeElement;
  }

  return element;
}

function holdsFrameElement(element) {
  return element instanceof HTMLIFrameElement || element instanceof HTMLFrameElement;
}

/**
 * Loads the ES module content app on demand.
 *
 * A failed import is not cached. That matters during unpacked-extension
 * development because Chrome pages can keep old content-script instances after
 * the extension is reloaded.
 */
async function loadContentAppModule() {
  if (!contentAppModule) {
    contentAppModule = import(chrome.runtime.getURL("content/content-app.js"))
      .catch((error) => {
        contentAppModule = null;
        throw error;
      });
  }

  return await contentAppModule;
}
