const MICROPHONE_PERMISSION_PAGE = "permissions/microphone.html";

/**
 * Opens the visible extension page that requests microphone access.
 *
 * Chrome cannot show a meaningful first-time microphone prompt from the MV3
 * service worker or a hidden offscreen document. This client opens a small
 * extension window where `getUserMedia()` can trigger the standard Chrome
 * permission prompt for the extension origin.
 */
export function createMicrophonePermissionClient({
  chromeApi,
  permissionPage = MICROPHONE_PERMISSION_PAGE
}) {
  return {
    openPermissionWindow
  };

  /**
   * Opens a focused permission window tied to the active dictation session.
   *
   * The session's tab id travels through the page URL so the permission result
   * can carry it back. A service worker that was suspended while the user read
   * the Chrome prompt has no session left in memory, and that echoed tab id is
   * what lets it resume instead of dropping a granted permission.
   */
  async function openPermissionWindow(sessionId, tabId = null) {
    const parameters = new URLSearchParams({ sessionId });
    if (Number.isInteger(tabId)) {
      parameters.set("tabId", String(tabId));
    }

    const url = chromeApi.runtime.getURL(`${permissionPage}?${parameters}`);

    console.info("[In-Browser Dictation] Opening microphone permission window.", {
      sessionId,
      tabId
    });

    if (chromeApi.windows?.create) {
      return await chromeApi.windows.create({
        url,
        type: "popup",
        width: 440,
        height: 420,
        focused: true
      });
    }

    return await chromeApi.tabs.create({ url, active: true });
  }
}
