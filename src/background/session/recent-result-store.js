import { DictationStatus } from "../../shared/dictation-state.js";

const RECENT_RESULT_STORAGE_KEY = "recentResult";

/**
 * Stores only the latest recoverable dictation result for the popup.
 *
 * `chrome.storage.session` is temporary and service-worker-safe. The in-memory
 * copy lets the current worker retain its latest value after a transient read
 * failure.
 */
export function createRecentResultStore({
  storageArea = getDefaultSessionStorageArea()
} = {}) {
  const sessionStorage = requireSessionStorageArea(storageArea);
  let memoryResult = null;

  return {
    clear,
    load,
    save,
    saveFromSession
  };

  async function load() {
    try {
      const stored = await sessionStorage.get({ [RECENT_RESULT_STORAGE_KEY]: null });
      memoryResult = normalizeRecentResult(stored?.[RECENT_RESULT_STORAGE_KEY]);
    } catch {
      return memoryResult;
    }

    return memoryResult;
  }

  async function save(value) {
    const result = normalizeRecentResult(value);

    memoryResult = result;
    await sessionStorage.set({ [RECENT_RESULT_STORAGE_KEY]: result });

    return result;
  }

  async function saveFromSession(session) {
    const result = createRecentResultFromSession(session);
    if (!result) {
      return null;
    }

    return await save(result);
  }

  async function clear() {
    memoryResult = null;
    await sessionStorage.remove(RECENT_RESULT_STORAGE_KEY);
  }
}

/**
 * Builds a recoverable record from a session that has produced final text.
 *
 * INSERTING counts as well as SUCCESS: insertion is the step most likely to
 * fail irrecoverably (detached target plus a clipboard write the browser
 * refuses), and that is exactly when the user needs the popup to still hold the
 * text. Waiting for SUCCESS would save a record only when it is least needed.
 */
export function createRecentResultFromSession(session) {
  if (!hasRecoverableOutput(session)) {
    return null;
  }

  return normalizeRecentResult({
    rawTranscript: session.transcription?.transcript ?? "",
    finalText: session.outputText.text
  });
}

function hasRecoverableOutput(session) {
  const producedFinalText = session?.status === DictationStatus.INSERTING
    || session?.status === DictationStatus.SUCCESS;

  return producedFinalText && Boolean(session.outputText?.text);
}

function normalizeRecentResult(value) {
  if (!value || typeof value.finalText !== "string" || value.finalText.length === 0) {
    return null;
  }

  const rawTranscript = typeof value.rawTranscript === "string"
    ? value.rawTranscript
    : "";

  return {
    rawTranscript,
    finalText: value.finalText,
    finalTextLength: value.finalText.length
  };
}

function getDefaultSessionStorageArea() {
  return globalThis.chrome?.storage?.session;
}

function requireSessionStorageArea(storageArea) {
  if (typeof storageArea?.get !== "function"
    || typeof storageArea.set !== "function"
    || typeof storageArea.remove !== "function") {
    throw new Error("chrome.storage.session is unavailable.");
  }

  return storageArea;
}
