// Static content-script entrypoint.
//
// Chrome loads this non-module file directly from the manifest. It imports the
// real module through a web-accessible extension URL so the rest of the content
// logic can use ES modules.
let contentAppModule = null;

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
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
