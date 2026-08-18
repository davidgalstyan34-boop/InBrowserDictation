import { normalizeRecordingError } from "../shared/audio-recording.js";

export const MICROPHONE_SETTINGS_URL = "chrome://settings/content/microphone";

// Resolves microphone access from the visible permission page. Chrome's
// Permissions API can report `granted` on macOS even when the operating system
// blocks Chrome itself, so a successful getUserMedia call is the final check.
export const MicrophoneAccessState = Object.freeze({
  GRANTED: "granted",
  DENIED: "denied",
  FAILED: "failed"
});

/**
 * Requests a test stream and returns a serializable access result.
 *
 * A known browser-level denial skips getUserMedia because Chrome cannot show
 * the prompt again. All other states still make the real media request so an
 * operating-system denial cannot be mistaken for granted access.
 */
export async function requestMicrophoneAccess({ mediaDevices, permissionsApi }) {
  const browserPermissionState = await queryMicrophonePermission(permissionsApi);

  if (browserPermissionState === "denied") {
    return createDeniedResult();
  }

  if (typeof mediaDevices?.getUserMedia !== "function") {
    return {
      state: MicrophoneAccessState.FAILED,
      error: {
        code: "MICROPHONE_UNAVAILABLE",
        message: "This browser context cannot request microphone access."
      }
    };
  }

  try {
    const stream = await mediaDevices.getUserMedia({ audio: true });
    return {
      state: MicrophoneAccessState.GRANTED,
      stream
    };
  } catch (error) {
    const normalizedError = normalizeRecordingError(error);
    return {
      state: normalizedError.code === "MICROPHONE_PERMISSION_DENIED"
        ? MicrophoneAccessState.DENIED
        : MicrophoneAccessState.FAILED,
      error: normalizedError
    };
  }
}

/**
 * Opens microphone settings in the last focused normal browser window.
 *
 * The permission request itself runs in a small popup window. Passing its
 * window implicitly to tabs.create would leave Chrome settings cramped inside
 * that popup, so the destination window is resolved explicitly.
 */
export async function openChromeMicrophoneSettings(chromeApi) {
  const normalWindow = typeof chromeApi.windows?.getLastFocused === "function"
    ? await chromeApi.windows.getLastFocused({ windowTypes: ["normal"] })
    : null;

  const tabOptions = {
    url: MICROPHONE_SETTINGS_URL,
    active: true
  };

  if (Number.isInteger(normalWindow?.id)) {
    tabOptions.windowId = normalWindow.id;
  }

  await chromeApi.tabs.create(tabOptions);

  if (Number.isInteger(normalWindow?.id) && typeof chromeApi.windows?.update === "function") {
    await chromeApi.windows.update(normalWindow.id, { focused: true });
  }
}

async function queryMicrophonePermission(permissionsApi) {
  if (typeof permissionsApi?.query !== "function") {
    return null;
  }

  try {
    const permission = await permissionsApi.query({ name: "microphone" });
    return permission?.state ?? null;
  } catch {
    // Some Chromium versions do not expose microphone through Permissions API.
    // The getUserMedia request below remains the authoritative check.
    return null;
  }
}

function createDeniedResult() {
  return {
    state: MicrophoneAccessState.DENIED,
    error: {
      code: "MICROPHONE_PERMISSION_DENIED",
      message: "Microphone access is denied. Enable it in Chrome or your system settings, then try again."
    }
  };
}
