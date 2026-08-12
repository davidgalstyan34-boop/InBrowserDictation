const inBrowserDictationModule = import(chrome.runtime.getURL("content/content-app.js"));

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  inBrowserDictationModule
    .then(({ handleRuntimeMessage }) => handleRuntimeMessage({ rawMessage, sender, sendResponse }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: {
          code: "CONTENT_MODULE_LOAD_FAILED",
          message: error.message
        }
      });
    });

  return true;
});
