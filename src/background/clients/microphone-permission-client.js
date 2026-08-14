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
   */
  async function openPermissionWindow(sessionId) {
    const url = chromeApi.runtime.getURL(`${permissionPage}?sessionId=${encodeURIComponent(sessionId)}`);

    console.info("[In-Browser Dictation] Opening microphone permission window.", {
      sessionId
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
